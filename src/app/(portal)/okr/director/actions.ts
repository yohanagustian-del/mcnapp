"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { computePctProgress, isAchieved, isGatingTriggered } from "@/lib/m3/scoring";
import { getActualForMetric } from "@/lib/m3/adapters";
import { getConfig } from "@/lib/config";
import { parseRupiah } from "@/lib/utils/rupiah";

export type ActionResult = { ok: true } | { ok: false; error: string };

const TARGET_UNITS = ["angka", "rupiah", "persen"] as const;
export type TargetUnit = (typeof TARGET_UNITS)[number];

/**
 * OKR Setting (tab Config OKR): simpan satu baris naskah OKR —
 * nama OKR + Objective + Key Result + Target (3 bulan).
 *
 * Objective boleh dipilih dari yang sudah ada (`objective_id`) ATAU ditulis baru
 * (`objective_new`); yang baru langsung tersimpan sehingga muncul di dropdown
 * pengisian berikutnya. Satu Objective bisa diisi berkali-kali dengan KR berbeda,
 * dan KR selalu menempel ke Objective yang dipilih.
 *
 * Mengembalikan {ok,error} (tidak melempar) — pesan error dilempar akan disensor
 * Next.js di production, sedangkan form ini butuh pesan yang bisa dibaca Director.
 */
export async function saveOkrSetting(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const okrName      = String(formData.get("okr_name") ?? "").trim();
  const objectiveIdRaw = String(formData.get("objective_id") ?? "").trim();
  const objectiveNew = String(formData.get("objective_new") ?? "").trim();
  const keyResult    = String(formData.get("key_result") ?? "").trim();
  const targetRaw    = String(formData.get("target") ?? "").trim();
  const unitRaw      = String(formData.get("target_unit") ?? "angka").trim();

  if (!okrName) return { ok: false, error: "Nama OKR wajib diisi (mis. \"OKR divisi CM\")." };
  if (okrName.length > 120) return { ok: false, error: "Nama OKR maksimal 120 karakter." };
  if (!objectiveIdRaw && !objectiveNew) {
    return { ok: false, error: "Pilih Objective yang sudah ada, atau tulis Objective baru." };
  }
  if (!keyResult) return { ok: false, error: "Key Result wajib diisi." };
  if (objectiveNew.length > 2000 || keyResult.length > 2000) {
    return { ok: false, error: "Objective / Key Result maksimal 2000 karakter." };
  }
  if (!targetRaw) return { ok: false, error: "Target wajib diisi (mis. 85000000)." };

  // Toleran terhadap "Rp100.000.000" / "100.000.000" / "85000000,5" (CLAUDE.md #7).
  const target = parseRupiah(targetRaw);
  if (target === null) return { ok: false, error: `Target "${targetRaw}" bukan angka yang valid.` };
  if (target < 0) return { ok: false, error: "Target tidak boleh negatif." };

  const targetUnit: TargetUnit = (TARGET_UNITS as readonly string[]).includes(unitRaw)
    ? (unitRaw as TargetUnit)
    : "angka";
  if (targetUnit === "persen" && target > 100) {
    return { ok: false, error: "Target persen maksimal 100." };
  }

  const admin = createAdminClient();

  // Nama OKR dikanonikalkan ke ejaan yang sudah tersimpan bila hanya beda
  // huruf besar/kecil — supaya "OKR divisi CM" dan "okr divisi cm" tidak jadi
  // dua grup terpisah di tabel (masalah varian ejaan, CLAUDE.md #6).
  const { data: existingNames } = await admin.from("okr_objectives").select("okr_name");
  const okrNameKey = okrName.toLowerCase();
  const okrNameFinal =
    (existingNames ?? []).find((r) => String(r.okr_name).trim().toLowerCase() === okrNameKey)?.okr_name ??
    okrName;

  let objectiveId: number;

  if (objectiveNew) {
    // Objective baru: kalau paragraf yang sama sudah ada di nama OKR ini, pakai
    // yang lama (unique index okr_objectives_uniq) — jangan bikin kembar.
    const { data: existing } = await admin
      .from("okr_objectives")
      .select("id")
      .eq("okr_name", okrNameFinal)
      .eq("objective", objectiveNew)
      .maybeSingle();

    if (existing) {
      objectiveId = existing.id;
    } else {
      const { data, error } = await admin
        .from("okr_objectives")
        .insert({ okr_name: okrNameFinal, objective: objectiveNew, created_by: actorId })
        .select("id")
        .single();
      if (error) return { ok: false, error: `Gagal simpan Objective: ${error.message}` };
      objectiveId = data.id;

      await writeAudit({
        actorId, action: "m3.create_okr_objective", entityType: "okr_objectives",
        entityId: String(objectiveId),
        after: { okr_name: okrNameFinal, objective: objectiveNew },
        type: "approval",
      });
    }
  } else {
    // Objective pilihan dropdown harus benar-benar ada dan cocok dengan nama OKR
    // yang tertulis — mencegah KR nempel ke OKR divisi lain karena nama diedit
    // setelah dropdown dipilih.
    const { data: obj } = await admin
      .from("okr_objectives")
      .select("id, okr_name")
      .eq("id", Number(objectiveIdRaw))
      .maybeSingle();
    if (!obj) return { ok: false, error: "Objective yang dipilih tidak ditemukan." };
    if (obj.okr_name !== okrNameFinal) {
      return {
        ok: false,
        error: `Objective ini milik "${obj.okr_name}". Ganti nama OKR atau tulis Objective baru.`,
      };
    }
    objectiveId = obj.id;
  }

  const { data: krRow, error: krError } = await admin
    .from("okr_objective_key_results")
    .insert({
      objective_id: objectiveId,
      key_result: keyResult,
      target,
      target_unit: targetUnit,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (krError) return { ok: false, error: `Gagal simpan Key Result: ${krError.message}` };

  await writeAudit({
    actorId, action: "m3.set_okr_setting", entityType: "okr_objective_key_results",
    entityId: String(krRow.id),
    after: { okr_name: okrNameFinal, objective_id: objectiveId, key_result: keyResult, target, target_unit: targetUnit },
    type: "approval",
  });

  revalidatePath("/okr/director");
  return { ok: true };
}

/** Hapus satu baris Key Result naskah OKR (Objective-nya tetap ada di dropdown). */
export async function deleteOkrSettingKr(formData: FormData): Promise<void> {
  const actor = await requirePermission("m3.set_target");
  const admin = createAdminClient();

  const krId = Number(formData.get("kr_id"));
  if (!krId) throw new Error("kr_id wajib");

  const { data: before } = await admin
    .from("okr_objective_key_results")
    .select("id, objective_id, key_result, target, target_unit")
    .eq("id", krId)
    .maybeSingle();
  if (!before) throw new Error(`Key Result #${krId} tidak ditemukan`);

  const { error } = await admin.from("okr_objective_key_results").delete().eq("id", krId);
  if (error) throw new Error(`Gagal hapus Key Result: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m3.delete_okr_setting", entityType: "okr_objective_key_results",
    entityId: String(krId), before, type: "approval",
  });
  revalidatePath("/okr/director");
}

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
