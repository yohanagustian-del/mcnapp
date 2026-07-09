"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseRupiah } from "@/lib/utils/rupiah";
import { checkProfitability, trackDaily, type CurveShape } from "@/lib/m7/tracking";

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Discriminated-union return (never throw across the server-action boundary): Next.js
 * censors a server action's thrown Error message in production, so every rejection here
 * is caught and returned as `error` (Bahasa Indonesia) instead. Same pattern as
 * src/app/(portal)/schedule/actions.ts.
 */
export type ProjectJoinDecisionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Create project (Planning). PRD §3.1 — target dipecah harian via kurva (lib m7). */
export async function createProject(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim() || null;
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

  await writeAudit({
    actorId: actor.id, action: "m7.create_project", entityType: "special_projects",
    entityId: String(data.id), after: { name, type, startDate, endDate, targetGmv, adsCap, shape },
    type: "auto",
  });
  revalidatePath("/projects");
}

/** Status transition planning → aktif → selesai; closing stores the result summary (PRD §2.6). */
export async function setProjectStatus(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const status = String(formData.get("status") ?? "");
  if (!projectId || !["planning", "aktif", "selesai"].includes(status)) {
    throw new Error("Transisi status tidak valid");
  }

  const admin = createAdminClient();
  const { data: project, error } = await admin
    .from("special_projects")
    .select("id, name, status, start_date, end_date, target_gmv, ads_budget_cap, daily_target_curve")
    .eq("id", projectId)
    .single();
  if (error || !project) throw new Error("Project tidak ditemukan");

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

/** Add participant. External wajib flag binding TikTok (PRD §2.3/§6.6) + audit. */
export async function addParticipant(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const isExternal = formData.get("is_external") === "on";
  const liveType = String(formData.get("live_type") ?? "solo") === "cohost" ? "cohost" : "solo";
  const binding = formData.get("binding_bound") === "on" ? "bound" : "pending";
  if (!projectId || !creatorId) throw new Error("Project & creator wajib dipilih");

  const admin = createAdminClient();
  const { data: creator } = await admin.from("creators").select("id").eq("id", creatorId).maybeSingle();
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);

  const { data: project } = await admin
    .from("special_projects").select("status").eq("id", projectId).single();
  if (project?.status === "aktif" && isExternal && binding !== "bound") {
    throw new Error("Project sudah aktif — peserta external wajib sudah binding TikTok");
  }

  const targetGmv = parseRupiah(String(formData.get("target_gmv") ?? ""));
  const { error } = await admin.from("project_participants").upsert({
    project_id: projectId, creator_id: creatorId, is_external: isExternal,
    tiktok_binding_status: isExternal ? binding : "bound",
    live_type: liveType, target_gmv: targetGmv,
  }, { onConflict: "project_id,creator_id" });
  if (error) throw new Error(`Gagal menambah peserta: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.add_participant", entityType: "project_participants",
    entityId: `${projectId}:${creatorId}`,
    after: { is_external: isExternal, binding, live_type: liveType },
    type: "auto",
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Metrik GMV per kreator per hari (QA: monitor performa tiap kreator project). */
export async function upsertCreatorMetric(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.metrics");
  const projectId = Number(formData.get("project_id"));
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  if (!projectId || !creatorId || !isIsoDate(date)) {
    throw new Error("Project, creator & tanggal wajib diisi");
  }
  const gmv = parseRupiah(String(formData.get("gmv_actual") ?? "")) ?? 0;
  const itemsSold = Number(String(formData.get("items_sold") ?? "").trim() || 0);

  const admin = createAdminClient();
  const { data: participant } = await admin
    .from("project_participants")
    .select("creator_id")
    .eq("project_id", projectId)
    .eq("creator_id", creatorId)
    .maybeSingle();
  if (!participant) throw new Error(`${creatorId} bukan peserta project ini — tambah sebagai peserta dulu`);

  const { error } = await admin.from("project_creator_metrics").upsert(
    { project_id: projectId, creator_id: creatorId, date, gmv_actual: gmv, items_sold: itemsSold },
    { onConflict: "project_id,creator_id,date" }
  );
  if (error) throw new Error(`Gagal menyimpan metrik kreator: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.creator_metric", entityType: "project_creator_metrics",
    entityId: `${projectId}:${creatorId}:${date}`,
    after: { gmv, items_sold: itemsSold }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}`);
}

/** Assign man power in-charge (PRD §2.5) + audit. */
export async function assignManpower(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const memberId = String(formData.get("member_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim() || null;
  const involvement = String(formData.get("involvement") ?? "").trim() || null;
  if (!projectId || !memberId) throw new Error("Project & anggota tim wajib dipilih");

  const admin = createAdminClient();
  const { error } = await admin.from("project_manpower").upsert(
    { project_id: projectId, member_id: memberId, role, involvement },
    { onConflict: "project_id,member_id" }
  );
  if (error) throw new Error(`Gagal assign man power: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.assign_manpower", entityType: "project_manpower",
    entityId: `${projectId}:${memberId}`, after: { role, involvement }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}`);
}

/**
 * Daily metric entry (PRD §2.2/§2.4, update harian — LOCKED): gmv, ads spend,
 * komisi creator, revenue MEA per hari. After each write the profitability
 * engine re-checks: ads spend > revenue MEA → alert anti-rugi; ads > cap →
 * alert over-cap. Alerts are EVENTS (platform_alert), never approvals.
 */
export async function upsertDailyMetric(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.metrics");
  const projectId = Number(formData.get("project_id"));
  const date = String(formData.get("date") ?? "");
  if (!projectId || !isIsoDate(date)) throw new Error("Project & tanggal wajib diisi");

  const gmv = parseRupiah(String(formData.get("gmv_actual") ?? "")) ?? 0;
  const ads = parseRupiah(String(formData.get("ads_spend") ?? "")) ?? 0;
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
    gmv_actual: gmv, ads_spend: ads, creator_commission: creatorCommission, mea_revenue: meaRevenue,
  }, { onConflict: "project_id,date" });
  if (error) throw new Error(`Gagal menyimpan metrik harian: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.daily_metric", entityType: "project_daily_metrics",
    entityId: `${projectId}:${date}`,
    after: { gmv, ads, creator_commission: creatorCommission, mea_revenue: meaRevenue },
    type: "auto",
  });

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
      await admin.from("platform_alerts").update({ resolved: true }).eq("id", open.id);
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
    if (!Number.isFinite(requestId)) throw new Error("Pengajuan tidak valid");
    if (!["diterima", "ditolak"].includes(decision)) throw new Error("Keputusan tidak valid");

    const admin = createAdminClient();
    const { data: reqRow, error: fetchError } = await admin
      .from("project_join_requests")
      .select("id, project_id, creator_id, status")
      .eq("id", requestId)
      .maybeSingle();
    if (fetchError) throw new Error(`Gagal memuat pengajuan: ${fetchError.message}`);
    if (!reqRow) throw new Error("Pengajuan tidak ditemukan");
    if (reqRow.status !== "diajukan") throw new Error("Pengajuan ini sudah diproses");

    const { error } = await admin
      .from("project_join_requests")
      .update({ status: decision, decided_by: actor.id, decided_at: new Date().toISOString() })
      .eq("id", requestId);
    if (error) throw new Error(`Gagal menyimpan keputusan: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m9.project_join_decide", entityType: "project_join_requests",
      entityId: String(requestId), before: { status: reqRow.status },
      after: { status: decision, project_id: reqRow.project_id, creator_id: reqRow.creator_id },
      type: "approval",
    });

    // Auto-bind accepted creators as participants so M7 tracking picks them up.
    if (decision === "diterima") {
      const { error: upsertError } = await admin.from("project_participants").upsert(
        { project_id: reqRow.project_id, creator_id: reqRow.creator_id },
        { onConflict: "project_id,creator_id", ignoreDuplicates: true }
      );
      if (upsertError) throw new Error(`Gagal menambah peserta: ${upsertError.message}`);
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${reqRow.project_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}
