"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { computePctProgress, isAchieved, isGatingTriggered } from "@/lib/m3/scoring";
import { getActualForMetric } from "@/lib/m3/adapters";
import { getConfig } from "@/lib/config";

/** Simpan / update definisi KR (Director + Head propose). */
export async function saveKrTarget(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.set_target");
  const admin = createAdminClient();

  const idRaw = formData.get("kr_id");
  const role         = String(formData.get("role") ?? "").trim();
  const metric       = String(formData.get("metric") ?? "").trim();
  const targetRaw    = formData.get("target");
  const periodType   = String(formData.get("period_type") ?? "quartal");
  const periodStart  = String(formData.get("period_start") ?? "").trim();
  const periodEnd    = String(formData.get("period_end") ?? "").trim() || null;
  const aggRule      = String(formData.get("aggregation_rule") ?? "pribadi");
  const objectiveRef = String(formData.get("objective_ref") ?? "").trim() || null;
  const segment      = String(formData.get("segment") ?? "").trim() || null;
  const filterJsonRaw = String(formData.get("filter_json") ?? "").trim();

  if (!role || !metric || !targetRaw || !periodStart) {
    throw new Error("role, metric, target, dan period_start wajib diisi");
  }
  const target = parseFloat(String(targetRaw));
  if (isNaN(target) || target < 0) throw new Error("target harus angka ≥ 0");

  let filterJson: Record<string, unknown> | null = null;
  if (filterJsonRaw) {
    try { filterJson = JSON.parse(filterJsonRaw); }
    catch { throw new Error("filter_json harus JSON valid"); }
  }

  const payload = {
    role, metric, target, period_type: periodType as "quartal" | "bulan",
    period_start: periodStart, period_end: periodEnd, aggregation_rule: aggRule,
    objective_ref: objectiveRef, segment, filter_json: filterJson,
    set_by: actor.id, active: true, updated_at: new Date().toISOString(),
  };

  let krId: number;
  if (idRaw) {
    const { error } = await admin.from("okr_key_results").update(payload).eq("id", Number(idRaw));
    if (error) throw new Error(`Gagal update KR: ${error.message}`);
    krId = Number(idRaw);
  } else {
    const { data, error } = await admin.from("okr_key_results").insert(payload).select("id").single();
    if (error) throw new Error(`Gagal simpan KR: ${error.message}`);
    krId = data.id;
  }

  await writeAudit({
    actorId: actor.id, action: "m3.set_kr_target", entityType: "okr_key_results",
    entityId: String(krId), after: payload, type: "approval",
  });
  revalidatePath("/okr");
  revalidatePath("/okr/director");
}

/** Simpan / update reward tier per role (Director only). */
export async function saveRewardTier(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.set_reward");
  const admin = createAdminClient();

  const idRaw          = formData.get("tier_id");
  const role           = String(formData.get("role") ?? "").trim();
  const krCount        = parseInt(String(formData.get("kr_achieved_count") ?? ""), 10);
  const amountRaw      = formData.get("reward_amount");
  const periodStartRaw = formData.get("period_start");
  const notes          = String(formData.get("notes") ?? "").trim() || null;

  if (!role || isNaN(krCount)) throw new Error("role dan kr_achieved_count wajib diisi");
  const rewardAmount = amountRaw === "" || amountRaw === null ? null : parseFloat(String(amountRaw));

  const payload = {
    role, kr_achieved_count: krCount, reward_amount: rewardAmount,
    period_start: periodStartRaw ? String(periodStartRaw) : null, notes,
  };

  let tierId: number;
  if (idRaw) {
    await admin.from("reward_tiers").update(payload).eq("id", Number(idRaw));
    tierId = Number(idRaw);
  } else {
    const { data, error } = await admin.from("reward_tiers").insert(payload).select("id").single();
    if (error) throw new Error(`Gagal simpan tier: ${error.message}`);
    tierId = data.id;
  }

  await writeAudit({
    actorId: actor.id, action: "m3.set_reward_tier", entityType: "reward_tiers",
    entityId: String(tierId), after: payload, type: "approval",
  });
  revalidatePath("/okr/director");
}

/** Director memutuskan gating event: gugur atau tidak_gugur. */
export async function decidGating(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.gating_decision");
  const admin = createAdminClient();

  const eventId  = Number(formData.get("event_id"));
  const decision = String(formData.get("decision"));
  if (!eventId || !["gugur", "tidak_gugur"].includes(decision)) {
    throw new Error("event_id dan decision (gugur/tidak_gugur) wajib");
  }

  const { data: evt } = await admin
    .from("okr_gating_events").select("id, kr_id, subject_id, director_decision")
    .eq("id", eventId).maybeSingle();
  if (!evt) throw new Error(`Gating event #${eventId} tidak ditemukan`);
  if (evt.director_decision !== "pending") throw new Error("Event ini sudah diputuskan");

  await admin.from("okr_gating_events").update({
    director_decision: decision as "gugur" | "tidak_gugur",
    decided_at: new Date().toISOString(),
  }).eq("id", eventId);

  await writeAudit({
    actorId: actor.id, action: "m3.gating_decision", entityType: "okr_gating_events",
    entityId: String(eventId),
    before: { director_decision: "pending" },
    after: { director_decision: decision },
    type: "approval",
  });
  revalidatePath("/okr/director");
  revalidatePath("/okr");
}

/** Ambil snapshot baseline atau final seluruh data relevan untuk periode OKR. */
export async function snapshotQuarter(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.snapshot");
  const admin = createAdminClient();

  const kind        = String(formData.get("kind"));
  const periodStart = String(formData.get("period_start") ?? "").trim();
  if (!["baseline", "final"].includes(kind) || !periodStart) {
    throw new Error("kind (baseline/final) dan period_start wajib");
  }

  // Snapshot level creator saat ini (untuk KR level_up_count)
  const { data: creators } = await admin.from("creators").select("id, level, gmv");
  const creatorLevels: Record<string, number> = {};
  const creatorGmv: Record<string, number> = {};
  for (const c of creators ?? []) {
    creatorLevels[c.id] = c.level ?? 0;
    creatorGmv[c.id]    = Number(c.gmv ?? 0);
  }

  // Untuk final: ambil current actuals summary
  let actualsSummary: Record<string, unknown> = {};
  if (kind === "final") {
    const { data: actuals } = await admin
      .from("okr_actuals")
      .select("kr_id, subject_id, actual_value, pct_progress, achieved, computed_at")
      .order("computed_at", { ascending: false });
    actualsSummary = { actuals_sample_count: actuals?.length ?? 0 };
  }

  const { data: snap, error } = await admin.from("okr_snapshots").insert({
    period_start: periodStart, kind,
    payload: { creator_levels: creatorLevels, creator_gmv: creatorGmv, ...actualsSummary },
  }).select("id").single();
  if (error) throw new Error(`Gagal simpan snapshot: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: `m3.snapshot_${kind}`, entityType: "okr_snapshots",
    entityId: String(snap.id), after: { kind, period_start: periodStart }, type: "approval",
  });
  revalidatePath("/okr/director");
}

/** Hitung OKR mingguan: pull actuals dari adapter → tulis okr_actuals → cek gating. */
export async function scoreWeekly(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.score");
  const admin = createAdminClient();

  const periodStartOverride = formData.get("period_start") as string | null;
  const qStart = periodStartOverride ?? String((await getConfig("calendar.q3_start")) ?? "2026-07-01");

  // Load semua KR aktif
  const { data: krs } = await admin
    .from("okr_key_results")
    .select("id, role, segment, metric, target, period_start, filter_json, aggregation_rule, gating_rule, active")
    .eq("active", true);

  if (!krs?.length) return;

  // Load semua team members aktif (untuk mendistribusikan ke subject per role)
  const { data: members } = await admin
    .from("team_members")
    .select("id, role, team_group, platform_segment")
    .eq("active", true);

  const scored: number[] = [];
  const errors: string[] = [];
  void scored; // used in audit log at end

  for (const kr of krs) {
    const krPeriodStart = kr.period_start ? String(kr.period_start) : qStart;
    // Cari subjects: member dengan role yang cocok
    const subjects = (members ?? []).filter((m) => m.role === kr.role);
    if (!subjects.length) continue;

    for (const subject of subjects) {
      try {
        const result = await getActualForMetric(
          admin, kr.metric, subject.id, krPeriodStart, kr.filter_json as Record<string, unknown> | null
        );
        if (!result) {
          // Adapter belum implementasi metric ini — skip
          continue;
        }

        const pct = computePctProgress(result.value, kr.target);
        const achieved = isAchieved(pct);

        await admin.from("okr_actuals").insert({
          kr_id: kr.id, subject_id: subject.id,
          actual_value: result.value, pct_progress: pct, achieved,
          source_ref: result.sourceRef, computed_at: new Date().toISOString(),
        });
        scored.push(kr.id);

        // Cek gating rule
        const gatRule = kr.gating_rule as Record<string, unknown> | null;
        if (isGatingTriggered(gatRule, false)) {
          // gating hanya dari event spesifik (ads boncos, dll) — bukan dari aktual score
          // Flag ditambah lewat platform_alerts atau manual; di sini hanya basis aturan
        }
      } catch (e) {
        errors.push(`KR#${kr.id} subject=${subject.id}: ${(e as Error).message}`);
      }
    }
  }

  await writeAudit({
    actorId: actor.id, action: "m3.score_weekly", entityType: "okr_actuals",
    entityId: "batch", after: { scored_count: scored.length, error_count: errors.length }, type: "auto",
  });
  revalidatePath("/okr");
  revalidatePath("/okr/director");
  if (errors.length) {
    console.error("[m3.score_weekly] errors:", errors);
  }
}
