"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { hasPermission, requireMember, requirePermission, type TeamMember } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseRupiah } from "@/lib/utils/rupiah";
import { canManageProjectParticipants, isAssignedManpower } from "@/lib/m7/access";
import { likePatternForUsername, normalizeUsername, pickExactUsername } from "@/lib/creators/username";
import { checkProfitability, trackDaily, type CurveShape } from "@/lib/m7/tracking";
import { isManpowerRole, isProjectType } from "@/lib/m7/project-type";
import { slugifyProjectName } from "@/lib/m7/slug";
import { suggestParticipantTargetGmv } from "@/lib/m7/participant-target";
import { genId } from "@/lib/utils/id";

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Discriminated-union return (never throw across the server-action boundary): Next.js
 * censors a server action's thrown Error message in production, so every rejection here
 * is caught and returned as `error` (Bahasa Indonesia) instead. Same pattern as
 * src/app/(portal)/schedule/actions.ts.
 */
export type ProjectJoinDecisionResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Sama seperti di atas: form peserta diisi manusia dan salah ketik username itu
 * wajar, jadi penolakannya harus sampai ke layar apa adanya — bukan error generik
 * hasil sensor Next.js di production.
 */
export type AddParticipantResult =
  | { ok: true }
  | { ok: false; error: string };

/** Create project (Planning). PRD §3.1 — target dipecah harian via kurva (lib m7). */
export async function createProject(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");

  const name = String(formData.get("name") ?? "").trim();
  // R1: type is now enum project_type_t (NOT NULL); anything unrecognized falls
  // back to 'other' rather than rejecting the submit (form always sends a valid value).
  const typeRaw = String(formData.get("type") ?? "").trim();
  const type = isProjectType(typeRaw) ? typeRaw : "other";
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "");
  const targetGmv = parseRupiah(String(formData.get("target_gmv") ?? ""));
  const adsCap = parseRupiah(String(formData.get("ads_budget_cap") ?? ""));
  const targetCreatorsRaw = String(formData.get("target_creators") ?? "").trim();
  const targetCreators = targetCreatorsRaw ? Number(targetCreatorsRaw) : null;
  if (targetCreators !== null && (!Number.isInteger(targetCreators) || targetCreators < 1)) {
    throw new Error("Target creator harus bilangan bulat ≥ 1");
  }
  const shape: CurveShape = formData.get("curve_shape") === "flat" ? "flat" : "ramp";

  if (!name) throw new Error("Nama project wajib diisi");
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
    throw new Error("Periode project tidak valid (start ≤ end)");
  }
  if (targetGmv === null || targetGmv <= 0) throw new Error("Target GMV wajib diisi");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("special_projects")
    .insert({
      name, type, start_date: startDate, end_date: endDate,
      target_gmv: targetGmv, ads_budget_cap: adsCap, target_creators: targetCreators,
      daily_target_curve: { shape },
      status: "planning", created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal membuat project: ${error.message}`);

  // R3: slug butuh id (unik by construction) → dibuat setelah insert, bukan di dalamnya.
  const slug = slugifyProjectName(name, data.id);
  const { error: slugError } = await admin.from("special_projects").update({ slug }).eq("id", data.id);
  if (slugError) throw new Error(`Gagal membuat slug: ${slugError.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.create_project", entityType: "special_projects",
    entityId: String(data.id), after: { name, type, startDate, endDate, targetGmv, adsCap, shape, slug },
    type: "auto",
  });
  revalidatePath("/projects");
}

/** Buka/tutup pendaftaran publik (R8/§3.4 langkah 3) + tenggat opsional. */
export async function setSignupOpen(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const open = formData.get("open_for_signup") === "on";
  const deadlineRaw = String(formData.get("signup_deadline") ?? "").trim();
  if (!projectId) throw new Error("Project tidak valid");

  const admin = createAdminClient();
  const { error } = await admin
    .from("special_projects")
    .update({ open_for_signup: open, signup_deadline: deadlineRaw ? new Date(deadlineRaw).toISOString() : null })
    .eq("id", projectId);
  if (error) throw new Error(`Gagal mengubah status pendaftaran: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.signup_toggle", entityType: "special_projects",
    entityId: String(projectId), after: { open_for_signup: open, signup_deadline: deadlineRaw || null }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Status transition planning → aktif → selesai; closing stores the result summary (PRD §2.6). */
export async function setProjectStatus(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const status = String(formData.get("status") ?? "");
  if (!projectId || !["planning", "aktif", "selesai", "dibatalkan"].includes(status)) {
    throw new Error("Transisi status tidak valid");
  }

  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("special_projects")
    .select("id, name, status, start_date, end_date, target_gmv, ads_budget_cap, daily_target_curve")
    .eq("id", projectId)
    .single();
  if (error || !project) throw new Error("Project tidak ditemukan");

  // R2 (LOCKED): koreksi "selesai → aktif" (upload terlambat) hanya Director/Head.
  if (project.status === "selesai" && status === "aktif" && !["director", "head"].includes(actor.role)) {
    throw new Error("Hanya Director/Head yang bisa mengaktifkan kembali project yang sudah selesai");
  }

  // External participants must be bound before the project goes active (PRD §2.7).
  if (status === "aktif") {
    const { count } = await admin
      .from("project_participants")
      .select("creator_id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("is_external", true)
      .neq("tiktok_binding_status", "bound");
    if ((count ?? 0) > 0) {
      throw new Error(`${count} peserta external belum binding TikTok — selesaikan binding sebelum aktivasi`);
    }
  }

  const patch: Record<string, unknown> = { status };
  if (status === "selesai") {
    const [metrics, tolerance] = await Promise.all([
      fetchAll<{ date: string; gmv_actual: number | null; ads_spend: number | null; creator_commission: number | null; mea_revenue: number | null }>(
        admin, "project_daily_metrics", "date, gmv_actual, ads_spend, creator_commission, mea_revenue",
        (q) => q.eq("project_id", projectId)),
      getConfig<number>("m7.status_tolerance"),
    ]);
    const shape = ((project.daily_target_curve as { shape?: CurveShape } | null)?.shape ?? "ramp") as CurveShape;
    const tracking = trackDaily(
      metrics.map((m) => ({ date: m.date, gmv: m.gmv_actual ?? 0 })),
      project.start_date, project.end_date, Number(project.target_gmv), tolerance, shape, project.end_date
    );
    const cumAds = metrics.reduce((s, m) => s + (m.ads_spend ?? 0), 0);
    const cumMea = metrics.reduce((s, m) => s + (m.mea_revenue ?? 0), 0);
    const cumGmv = tracking.cumActual;
    const liveContribution = null; // per-format daily split not captured in v1
    patch.result_summary = {
      achievement_pct: tracking.achievementPct,
      gmv_actual: cumGmv,
      target_gmv: Number(project.target_gmv),
      margin: cumMea - cumAds,
      ads_spend: cumAds,
      mea_revenue: cumMea,
      live_contribution: liveContribution,
      closed_at: new Date().toISOString(),
    };
  }

  const { error: updError } = await admin.from("special_projects").update(patch).eq("id", projectId);
  if (updError) throw new Error(`Gagal update status: ${updError.message}`);

  await writeAudit({
    actorId: actor.id, action: `m7.project_${status}`, entityType: "special_projects",
    entityId: String(projectId), before: { status: project.status },
    after: { status, ...(patch.result_summary ? { result_summary: patch.result_summary } : {}) },
    type: "auto",
  });
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Username (mis. "vikahere") → `creators.id`. Dicocokkan case-insensitive lewat
 * helper bersama; kalau yang diketik ternyata creator id yang terdaftar, itu tetap
 * diterima supaya kebiasaan lama & tautan lama tidak patah.
 */
async function resolveCreatorId(
  admin: ReturnType<typeof createAdminClient>,
  typed: string
): Promise<string> {
  const { data: rows, error } = await admin
    .from("creators")
    .select("id, username")
    .ilike("username", likePatternForUsername(typed))
    .limit(5);
  if (error) throw new Error(`Gagal mencari kreator: ${error.message}`);

  const match = pickExactUsername(rows ?? [], typed);
  if (match) return match.id;

  const { data: byId } = await admin.from("creators").select("id").eq("id", typed).maybeSingle();
  if (byId) return byId.id;

  throw new Error(
    `Kreator dengan username "${typed}" tidak ditemukan — pilih dari daftar username, atau daftarkan kreatornya dulu di menu Kreator`
  );
}

/**
 * Guard peserta project: pemegang `m7.manage` untuk semua project, ATAU anggota tim
 * yang sudah di-assign sebagai man power in-charge di project ini (M7 §2.5) — orang
 * yang menjalankan project boleh mengisi pesertanya sendiri tanpa harus jadi lead.
 * Dicek di server, bukan cuma disembunyikan di UI (CLAUDE.md: RBAC enforce di server).
 */
async function requireProjectParticipantAccess(projectId: number): Promise<TeamMember> {
  const member = await requireMember();
  const hasManage = hasPermission("m7.manage", member.role);
  const assigned = hasManage
    ? false // sudah lolos lewat permission global — tidak perlu query tambahan
    : await isAssignedManpower(createAdminClient(), projectId, member.id);
  if (!canManageProjectParticipants({ hasManagePermission: hasManage, isAssignedManpower: assigned })) {
    throw new Error(
      `Akses ditolak: role ${member.role} tidak punya izin m7.manage dan belum di-assign sebagai man power project ini`
    );
  }
  return member;
}

/**
 * Add participant. Kreator dipilih lewat USERNAME (bukan `creators.id`) — orang hafal
 * handle akun, bukan ID internal; ID tetap diterima supaya tautan/daftar lama tidak
 * rusak. External wajib flag binding TikTok (PRD §2.3/§6.6) + audit.
 */
export async function addParticipant(formData: FormData): Promise<AddParticipantResult> {
  try {
    const projectId = Number(formData.get("project_id"));
    if (!projectId) throw new Error("Project wajib dipilih");
    const actor = await requireProjectParticipantAccess(projectId);

    // Form mengirim username; `creator_id` tetap dibaca sebagai cadangan supaya
    // pemanggil lama (dan tempel-ID langsung) tidak patah.
    const typed = normalizeUsername(
      String(formData.get("creator_username") ?? "") || String(formData.get("creator_id") ?? "")
    );
    const isExternal = formData.get("is_external") === "on";
    const liveType = String(formData.get("live_type") ?? "solo") === "cohost" ? "cohost" : "solo";
    const binding = formData.get("binding_bound") === "on" ? "bound" : "pending";
    if (!typed) throw new Error("Username kreator wajib diisi");

    const admin = createAdminClient();
    const creatorId = await resolveCreatorId(admin, typed);

    const { data: project } = await admin
      .from("special_projects").select("status").eq("id", projectId).single();
    if (project?.status === "aktif" && isExternal && binding !== "bound") {
      throw new Error("Project sudah aktif — peserta external wajib sudah binding TikTok");
    }

    // R4 (LOCKED): target_gmv peserta wajib diisi — kolomnya NOT NULL sejak v2.
    // Form sudah mengisi saran otomatis (sisa target / sisa kuota); ini jaring terakhir.
    const targetGmv = parseRupiah(String(formData.get("target_gmv") ?? ""));
    if (targetGmv === null) throw new Error("Target GMV peserta wajib diisi");

    const { error } = await admin.from("project_participants").upsert({
      project_id: projectId, creator_id: creatorId, is_external: isExternal,
      tiktok_binding_status: isExternal ? binding : "bound",
      live_type: liveType, target_gmv: targetGmv, added_via: "manual",
    }, { onConflict: "project_id,creator_id" });
    if (error) throw new Error(`Gagal menambah peserta: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m7.add_participant", entityType: "project_participants",
      entityId: `${projectId}:${creatorId}`,
      after: { input: typed, is_external: isExternal, binding, live_type: liveType },
      type: "auto",
    });
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Assign man power in-charge (PRD §2.5) + audit. `role` is now the enum
 * manpower_role_t and `involvement_pct` a 0–100 integer (M7 v2 §6.2) — both
 * validated here since they're server-enforced, not just UI dropdowns/inputs.
 */
export async function assignManpower(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const memberId = String(formData.get("member_id") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? "").trim();
  const role = isManpowerRole(roleRaw) ? roleRaw : null;
  const involvementRaw = String(formData.get("involvement_pct") ?? "").trim();
  const involvementPct = involvementRaw === "" ? null : Number(involvementRaw);
  if (!projectId || !memberId) throw new Error("Project & anggota tim wajib dipilih");
  if (
    involvementPct !== null &&
    (!Number.isInteger(involvementPct) || involvementPct < 0 || involvementPct > 100)
  ) {
    throw new Error("Porsi keterlibatan harus bilangan bulat 0–100");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("project_manpower").upsert(
    { project_id: projectId, member_id: memberId, role, involvement_pct: involvementPct },
    { onConflict: "project_id,member_id" }
  );
  if (error) throw new Error(`Gagal assign man power: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.assign_manpower", entityType: "project_manpower",
    entityId: `${projectId}:${memberId}`, after: { role, involvement_pct: involvementPct }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Daily COST entry (PRD §2.2/§2.4, update harian): ads spend manual, komisi
 * creator, revenue MEA. GMV/items/orders are upload-only since M7 v2 B5 —
 * `project_daily_metrics.gmv_actual` etc. are written exclusively by
 * `recompute_project_daily()` from `project_creator_metrics` (CLAUDE.md #3: no
 * manual edit path for a platform-sourced number). After each write the SQL
 * pipeline recomputes ads_spend (manual + project_ads_spend_v) and the
 * profitability engine re-checks: ads spend > revenue MEA → alert anti-rugi;
 * ads > cap → alert over-cap. Alerts are EVENTS (platform_alert), never approvals.
 */
export async function upsertDailyMetric(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.metrics");
  const projectId = Number(formData.get("project_id"));
  const date = String(formData.get("date") ?? "");
  if (!projectId || !isIsoDate(date)) throw new Error("Project & tanggal wajib diisi");

  const adsManual = parseRupiah(String(formData.get("ads_spend_manual") ?? "")) ?? 0;
  const creatorCommission = parseRupiah(String(formData.get("creator_commission") ?? "")) ?? 0;
  const meaRevenue = parseRupiah(String(formData.get("mea_revenue") ?? "")) ?? 0;

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("special_projects")
    .select("id, name, ads_budget_cap")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("Project tidak ditemukan");

  const { error } = await admin.from("project_daily_metrics").upsert({
    project_id: projectId, date,
    ads_spend_manual: adsManual, creator_commission: creatorCommission, mea_revenue: meaRevenue,
  }, { onConflict: "project_id,date" });
  if (error) throw new Error(`Gagal menyimpan metrik harian: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.daily_metric", entityType: "project_daily_metrics",
    entityId: `${projectId}:${date}`,
    after: { ads_spend_manual: adsManual, creator_commission: creatorCommission, mea_revenue: meaRevenue },
    type: "auto",
  });

  // ads_spend (manual + project_ads_spend_v) is recomputed in SQL, not here in JS
  // (CLAUDE.md #1: aggregation is SQL, not an app loop) — this also folds in any
  // ads_briefs tied to this project for the profitability check right below.
  const { error: recomputeError } = await admin.rpc("recompute_project_daily", { p: projectId });
  if (recomputeError) throw new Error(`Gagal recompute metrik harian: ${recomputeError.message}`);
  const { error: summaryError } = await admin.rpc("recompute_project_summary", { p: projectId });
  if (summaryError) throw new Error(`Gagal recompute ringkasan project: ${summaryError.message}`);

  // ---- profitability re-check on cumulative numbers ----
  const metrics = await fetchAll<{ ads_spend: number | null; mea_revenue: number | null }>(
    admin, "project_daily_metrics", "ads_spend, mea_revenue", (q) => q.eq("project_id", projectId));
  const check = checkProfitability({
    cumAdsSpend: metrics.reduce((s, m) => s + (m.ads_spend ?? 0), 0),
    cumMeaRevenue: metrics.reduce((s, m) => s + (m.mea_revenue ?? 0), 0),
    adsBudgetCap: project.ads_budget_cap === null ? null : Number(project.ads_budget_cap),
  });

  for (const [flag, alertType, message] of [
    [check.rugi, "project_rugi",
      `Project "${project.name}": ads spend melebihi komisi/revenue MEA (margin ${Math.round(check.margin).toLocaleString("id-ID")}) — rem ads / dorong GMV`],
    [check.overCap, "project_over_cap",
      `Project "${project.name}": ads spend melewati budget cap — verifikasi belanja iklan`],
  ] as const) {
    const { data: open } = await admin
      .from("platform_alerts")
      .select("id")
      .eq("alert_type", alertType)
      .eq("entity_id", String(projectId))
      .eq("resolved", false)
      .limit(1)
      .maybeSingle();
    if (flag && !open) {
      const { error: alertError } = await admin.from("platform_alerts").insert({
        alert_type: alertType, entity_type: "special_projects", entity_id: String(projectId),
        message, payload: { margin: check.margin, date },
      });
      if (alertError) throw new Error(`Gagal menulis alert: ${alertError.message}`);
      await writeAudit({
        actorId: null, action: `m7.${alertType}`, entityType: "special_projects",
        entityId: String(projectId), after: { margin: check.margin, date }, type: "platform_alert",
      });
    } else if (!flag && open) {
      const { error: resolveError } = await admin
        .from("platform_alerts").update({ resolved: true }).eq("id", open.id);
      if (resolveError) throw new Error(`Gagal menutup alert: ${resolveError.message}`);
      await writeAudit({
        actorId: null, action: `m7.${alertType}_resolved`, entityType: "special_projects",
        entityId: String(projectId), before: { resolved: false }, after: { resolved: true, margin: check.margin, date },
        type: "platform_alert",
      });
    }
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/projects");
}

/**
 * Decide a creator's pending join request (M9 §2.6 / M7): the platform surfaces every
 * request, but who's accepted stays a human PM/lead call — never automatic. Gated by
 * m9.project_join_decide (management + relevant leads + campaign_ops per RBAC matrix).
 */
export async function decideProjectJoinRequest(formData: FormData): Promise<ProjectJoinDecisionResult> {
  try {
    const actor = await requirePermission("m9.project_join_decide");
    const requestId = Number(formData.get("request_id"));
    const decision = String(formData.get("decision") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const targetGmvRaw = String(formData.get("target_gmv") ?? "");
    if (!Number.isFinite(requestId)) throw new Error("Pengajuan tidak valid");
    if (!["diterima", "ditolak"].includes(decision)) throw new Error("Keputusan tidak valid");
    // R14: reject wajib reason.
    if (decision === "ditolak" && !reason) throw new Error("Alasan penolakan wajib diisi");
    let warning: string | undefined;

    const admin = createAdminClient();
    const { data: reqRow, error: fetchError } = await admin
      .from("project_join_requests")
      .select("id, project_id, creator_id, status")
      .eq("id", requestId)
      .maybeSingle();
    if (fetchError) throw new Error(`Gagal memuat pengajuan: ${fetchError.message}`);
    if (!reqRow) throw new Error("Pengajuan tidak ditemukan");
    // 'diundang' juga bisa diputuskan langsung oleh tim (tanpa menunggu respons
    // kreator di portal) — bukan cuma 'diajukan' (R11/R14).
    if (!["diajukan", "diundang"].includes(reqRow.status)) throw new Error("Pengajuan ini sudah diproses");

    const { error } = await admin
      .from("project_join_requests")
      .update({
        status: decision, decided_by: actor.id, decided_at: new Date().toISOString(),
        reason: decision === "ditolak" ? reason : null,
      })
      .eq("id", requestId);
    if (error) throw new Error(`Gagal menyimpan keputusan: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m9.project_join_decide", entityType: "project_join_requests",
      entityId: String(requestId), before: { status: reqRow.status },
      after: { status: decision, project_id: reqRow.project_id, creator_id: reqRow.creator_id, reason: reason || null },
      type: "approval",
    });

    // Auto-bind accepted creators as participants so M7 tracking picks them up.
    // R4: target_gmv is NOT NULL since v2 — system suggests sisa target / sisa
    // kuota, tim boleh ubah lewat form (target_gmv di formData); jatuh ke saran
    // kalau kosong/tidak valid.
    if (decision === "diterima") {
      const [{ data: project }, { data: existingParticipants }] = await Promise.all([
        admin.from("special_projects").select("target_gmv, target_creators").eq("id", reqRow.project_id).single(),
        admin.from("project_participants").select("target_gmv").eq("project_id", reqRow.project_id),
      ]);
      const suggestedTargetGmv = suggestParticipantTargetGmv({
        projectTargetGmv: Number(project?.target_gmv ?? 0),
        targetCreators: project?.target_creators ?? null,
        existingParticipantTargets: (existingParticipants ?? []).map((p) => Number(p.target_gmv ?? 0)),
      });
      const overrideTargetGmv = targetGmvRaw ? parseRupiah(targetGmvRaw) : null;
      const { error: upsertError } = await admin.from("project_participants").upsert(
        {
          project_id: reqRow.project_id, creator_id: reqRow.creator_id,
          target_gmv: overrideTargetGmv ?? suggestedTargetGmv, added_via: "portal",
        },
        { onConflict: "project_id,creator_id", ignoreDuplicates: true }
      );
      if (upsertError) throw new Error(`Gagal menambah peserta: ${upsertError.message}`);

      // R16: melebihi target_creators → warning, bukan blokir — tetap disimpan,
      // pesannya saja yang beda (bukan error).
      if (project?.target_creators) {
        const newCount = (existingParticipants?.length ?? 0) + 1;
        if (newCount > project.target_creators) {
          warning = `Peserta (${newCount}) melebihi target_creators (${project.target_creators}) — tetap ditambahkan.`;
        }
      }
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${reqRow.project_id}`);
    return warning ? { ok: true, warning } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Decide an external applicant from `/join/{slug}` (PRD §2.3/§6.6, R15). Approve
 * is ONE transaction: creates `creators` (`tim_akuisisi='special_project'`) then
 * `project_participants` — a portal account is NOT auto-created (R36 stays manual).
 * Reject wajib reason, sejajar dengan decideProjectJoinRequest (R14).
 */
export async function decideExternalApplicant(formData: FormData): Promise<ProjectJoinDecisionResult> {
  try {
    const actor = await requirePermission("m9.project_join_decide");
    const applicantId = Number(formData.get("applicant_id"));
    const decision = String(formData.get("decision") ?? "");
    const reason = String(formData.get("reason") ?? "").trim();
    const targetGmvRaw = String(formData.get("target_gmv") ?? "");
    if (!Number.isFinite(applicantId)) throw new Error("Pendaftar tidak valid");
    if (!["approved", "rejected"].includes(decision)) throw new Error("Keputusan tidak valid");
    if (decision === "rejected" && !reason) throw new Error("Alasan penolakan wajib diisi");

    const admin = createAdminClient();
    const { data: applicant, error: fetchError } = await admin
      .from("project_external_applicants")
      .select("id, project_id, full_name, username, platform, niche, status")
      .eq("id", applicantId)
      .maybeSingle();
    if (fetchError) throw new Error(`Gagal memuat pendaftar: ${fetchError.message}`);
    if (!applicant) throw new Error("Pendaftar tidak ditemukan");
    if (applicant.status !== "pending") throw new Error("Pendaftar ini sudah diproses");

    let createdCreatorId: string | null = null;

    if (decision === "approved") {
      let lastError = "";
      for (let attempt = 0; attempt < 3 && !createdCreatorId; attempt++) {
        const id = genId("CRT");
        const { error } = await admin.from("creators").insert({
          id, name: applicant.full_name, username: applicant.username,
          niche: applicant.niche, platform: applicant.platform === "shopee" ? "shopee" : "tiktok",
          tim_akuisisi: "special_project",
        });
        if (!error) createdCreatorId = id;
        else if (error.code === "23505") lastError = error.message; // id bentrok → coba id baru
        else { lastError = error.message; break; }
      }
      if (!createdCreatorId) throw new Error(`Gagal membuat kreator: ${lastError}`);

      const [{ data: project }, { data: existingParticipants }] = await Promise.all([
        admin.from("special_projects").select("target_gmv, target_creators").eq("id", applicant.project_id).single(),
        admin.from("project_participants").select("target_gmv").eq("project_id", applicant.project_id),
      ]);
      const suggestedTargetGmv = suggestParticipantTargetGmv({
        projectTargetGmv: Number(project?.target_gmv ?? 0),
        targetCreators: project?.target_creators ?? null,
        existingParticipantTargets: (existingParticipants ?? []).map((p) => Number(p.target_gmv ?? 0)),
      });
      const overrideTargetGmv = targetGmvRaw ? parseRupiah(targetGmvRaw) : null;
      const { error: participantError } = await admin.from("project_participants").insert({
        project_id: applicant.project_id, creator_id: createdCreatorId,
        is_external: true, tiktok_binding_status: "pending",
        target_gmv: overrideTargetGmv ?? suggestedTargetGmv, added_via: "external",
      });
      if (participantError) throw new Error(`Gagal menambah peserta: ${participantError.message}`);
    }

    const { error: updateError } = await admin
      .from("project_external_applicants")
      .update({
        status: decision, reviewed_by: actor.id, reviewed_at: new Date().toISOString(),
        review_note: reason || null, created_creator_id: createdCreatorId,
      })
      .eq("id", applicantId);
    if (updateError) throw new Error(`Gagal menyimpan keputusan: ${updateError.message}`);

    await writeAudit({
      actorId: actor.id,
      action: decision === "approved" ? "m7.external_approve" : "m7.external_reject",
      entityType: "project_external_applicants", entityId: String(applicantId),
      before: { status: applicant.status },
      after: { status: decision, created_creator_id: createdCreatorId, reason: reason || null },
      type: "approval",
    });

    revalidatePath("/projects");
    revalidatePath(`/projects/${applicant.project_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}
