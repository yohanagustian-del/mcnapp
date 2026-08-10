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
interface OkrSettingInput {
  okrName: string;
  objectiveIdRaw: string;
  objectiveNew: string;
  keyResult: string;
  target: number;
  targetUnit: TargetUnit;
}

/**
 * Validasi field OKR Setting yang dipakai bersama form tambah & form edit.
 * Mengembalikan pesan siap tampil (string) kalau ada yang salah.
 */
function readOkrSettingInput(formData: FormData): OkrSettingInput | string {
  const okrName        = String(formData.get("okr_name") ?? "").trim();
  const objectiveIdRaw = String(formData.get("objective_id") ?? "").trim();
  const objectiveNew   = String(formData.get("objective_new") ?? "").trim();
  const keyResult      = String(formData.get("key_result") ?? "").trim();
  const targetRaw      = String(formData.get("target") ?? "").trim();
  const unitRaw        = String(formData.get("target_unit") ?? "angka").trim();

  if (!okrName) return "Nama OKR wajib diisi (mis. \"OKR divisi CM\").";
  if (okrName.length > 120) return "Nama OKR maksimal 120 karakter.";
  if (!objectiveIdRaw && !objectiveNew) return "Pilih Objective yang sudah ada, atau tulis Objective baru.";
  if (!keyResult) return "Key Result wajib diisi.";
  if (objectiveNew.length > 2000 || keyResult.length > 2000) {
    return "Objective / Key Result maksimal 2000 karakter.";
  }
  if (!targetRaw) return "Target wajib diisi (mis. 85000000).";

  // Toleran terhadap "Rp100.000.000" / "100.000.000" / "85000000,5" (CLAUDE.md #7).
  const target = parseRupiah(targetRaw);
  if (target === null) return `Target "${targetRaw}" bukan angka yang valid.`;
  if (target < 0) return "Target tidak boleh negatif.";

  const targetUnit: TargetUnit = (TARGET_UNITS as readonly string[]).includes(unitRaw)
    ? (unitRaw as TargetUnit)
    : "angka";
  if (targetUnit === "persen" && target > 100) return "Target persen maksimal 100.";

  return { okrName, objectiveIdRaw, objectiveNew, keyResult, target, targetUnit };
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Nama OKR dikanonikalkan ke ejaan yang sudah tersimpan bila hanya beda huruf
 * besar/kecil — supaya "OKR divisi CM" dan "okr divisi cm" tidak jadi dua grup
 * terpisah di tabel (masalah varian ejaan, CLAUDE.md #6).
 */
async function canonicalOkrName(admin: AdminClient, okrName: string): Promise<string> {
  const key = okrName.trim().toLowerCase();
  const { data } = await admin.from("okr_objectives").select("okr_name");
  return (data ?? []).find((r) => String(r.okr_name).trim().toLowerCase() === key)?.okr_name ?? okrName;
}

/**
 * Cari (atau buat) Objective untuk pasangan nama OKR + paragraf Objective.
 * Dipakai form tambah maupun form edit, jadi keduanya tidak bisa lahir aturan
 * pencocokan yang berbeda. Mengembalikan id, atau string pesan error.
 */
async function resolveObjective(
  admin: AdminClient,
  input: OkrSettingInput,
  okrNameFinal: string,
  actorId: string
): Promise<number | string> {
  if (input.objectiveNew) {
    // Objective baru: kalau paragraf yang sama sudah ada di nama OKR ini, pakai
    // yang lama (unique index okr_objectives_uniq) — jangan bikin kembar.
    const { data: existing } = await admin
      .from("okr_objectives")
      .select("id")
      .eq("okr_name", okrNameFinal)
      .eq("objective", input.objectiveNew)
      .maybeSingle();
    if (existing) return existing.id;

    const { data, error } = await admin
      .from("okr_objectives")
      .insert({ okr_name: okrNameFinal, objective: input.objectiveNew, created_by: actorId })
      .select("id")
      .single();
    if (error) return `Gagal simpan Objective: ${error.message}`;

    await writeAudit({
      actorId, action: "m3.create_okr_objective", entityType: "okr_objectives",
      entityId: String(data.id),
      after: { okr_name: okrNameFinal, objective: input.objectiveNew },
      type: "approval",
    });
    return data.id;
  }

  // Objective pilihan dropdown harus benar-benar ada dan cocok dengan nama OKR
  // yang tertulis — mencegah KR nempel ke OKR divisi lain karena nama diedit
  // setelah dropdown dipilih.
  const { data: obj } = await admin
    .from("okr_objectives")
    .select("id, okr_name")
    .eq("id", Number(input.objectiveIdRaw))
    .maybeSingle();
  if (!obj) return "Objective yang dipilih tidak ditemukan.";
  if (obj.okr_name !== okrNameFinal) {
    return `Objective ini milik "${obj.okr_name}". Ganti nama OKR atau tulis Objective baru.`;
  }
  return obj.id;
}

export async function saveOkrSetting(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const input = readOkrSettingInput(formData);
  if (typeof input === "string") return { ok: false, error: input };

  const admin = createAdminClient();
  const okrNameFinal = await canonicalOkrName(admin, input.okrName);
  const objectiveId = await resolveObjective(admin, input, okrNameFinal, actorId);
  if (typeof objectiveId === "string") return { ok: false, error: objectiveId };

  const { data: krRow, error: krError } = await admin
    .from("okr_objective_key_results")
    .insert({
      objective_id: objectiveId,
      key_result: input.keyResult,
      target: input.target,
      target_unit: input.targetUnit,
      created_by: actorId,
    })
    .select("id")
    .single();
  if (krError) return { ok: false, error: `Gagal simpan Key Result: ${krError.message}` };

  await writeAudit({
    actorId, action: "m3.set_okr_setting", entityType: "okr_objective_key_results",
    entityId: String(krRow.id),
    after: {
      okr_name: okrNameFinal, objective_id: objectiveId,
      key_result: input.keyResult, target: input.target, target_unit: input.targetUnit,
    },
    type: "approval",
  });

  revalidatePath("/okr/director");
  return { ok: true };
}

/**
 * Edit satu baris OKR Setting.
 *
 * Perubahan nama OKR / Objective berlaku UNTUK BARIS INI SAJA: KR-nya dipindah
 * ke Objective dengan pasangan (nama OKR, Objective) yang baru — dibuat kalau
 * belum ada. Jadi mengedit satu baris tidak pernah ikut mengubah teks KR lain
 * yang menumpang Objective yang sama, dan Objective lama tetap ada di dropdown.
 */
export async function updateOkrSetting(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const krId = Number(formData.get("kr_id"));
  if (!krId) return { ok: false, error: "Baris yang diedit tidak dikenali." };

  const input = readOkrSettingInput(formData);
  if (typeof input === "string") return { ok: false, error: input };

  const admin = createAdminClient();

  const { data: before } = await admin
    .from("okr_objective_key_results")
    .select("id, objective_id, key_result, target, target_unit")
    .eq("id", krId)
    .maybeSingle();
  if (!before) return { ok: false, error: `Key Result #${krId} tidak ditemukan.` };

  const okrNameFinal = await canonicalOkrName(admin, input.okrName);
  const objectiveId = await resolveObjective(admin, input, okrNameFinal, actorId);
  if (typeof objectiveId === "string") return { ok: false, error: objectiveId };

  const after = {
    objective_id: objectiveId,
    key_result: input.keyResult,
    target: input.target,
    target_unit: input.targetUnit,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("okr_objective_key_results").update(after).eq("id", krId);
  if (error) return { ok: false, error: `Gagal simpan perubahan: ${error.message}` };

  await writeAudit({
    actorId, action: "m3.update_okr_setting", entityType: "okr_objective_key_results",
    entityId: String(krId), before, after: { ...after, okr_name: okrNameFinal }, type: "approval",
  });

  revalidatePath("/okr/director");
  return { ok: true };
}

/** Hapus satu baris Key Result naskah OKR (Objective-nya tetap ada di dropdown). */
export async function deleteOkrSettingKr(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const admin = createAdminClient();
  const krId = Number(formData.get("kr_id"));
  if (!krId) return { ok: false, error: "Baris yang dihapus tidak dikenali." };

  const { data: before } = await admin
    .from("okr_objective_key_results")
    .select("id, objective_id, key_result, target, target_unit")
    .eq("id", krId)
    .maybeSingle();
  if (!before) return { ok: false, error: `Key Result #${krId} tidak ditemukan.` };

  const { error } = await admin.from("okr_objective_key_results").delete().eq("id", krId);
  if (error) return { ok: false, error: `Gagal hapus Key Result: ${error.message}` };

  await writeAudit({
    actorId, action: "m3.delete_okr_setting", entityType: "okr_objective_key_results",
    entityId: String(krId), before, type: "approval",
  });
  revalidatePath("/okr/director");
  return { ok: true };
}

/**
 * Hapus Objective yang sudah tidak punya Key Result (membersihkan pilihan
 * dropdown). Objective yang masih dipakai ditolak — hapus KR-nya dulu supaya
 * tidak ada baris yang lenyap tanpa disadari lewat cascade.
 */
export async function deleteOkrObjective(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const admin = createAdminClient();
  const objectiveId = Number(formData.get("objective_id"));
  if (!objectiveId) return { ok: false, error: "Objective yang dihapus tidak dikenali." };

  const { data: before } = await admin
    .from("okr_objectives")
    .select("id, okr_name, objective")
    .eq("id", objectiveId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Objective tidak ditemukan." };

  const { count } = await admin
    .from("okr_objective_key_results")
    .select("id", { count: "exact", head: true })
    .eq("objective_id", objectiveId);
  if ((count ?? 0) > 0) {
    return { ok: false, error: `Objective ini masih punya ${count} Key Result — hapus KR-nya dulu.` };
  }

  const { error } = await admin.from("okr_objectives").delete().eq("id", objectiveId);
  if (error) return { ok: false, error: `Gagal hapus Objective: ${error.message}` };

  await writeAudit({
    actorId, action: "m3.delete_okr_objective", entityType: "okr_objectives",
    entityId: String(objectiveId), before, type: "approval",
  });
  revalidatePath("/okr/director");
  return { ok: true };
}

/**
 * Assign OKR: tugaskan satu nama OKR ke beberapa anggota tim sekaligus (bulk
 * lewat centang). Anggota yang sudah punya OKR ini dilewati — insert-nya
 * idempoten (unique index okr_assignments_uniq), jadi mencentang ulang tidak
 * menggandakan penugasan dan tidak menghasilkan error.
 */
export async function assignOkrToMembers(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const okrName = String(formData.get("okr_name") ?? "").trim();
  const memberIds = [...new Set(formData.getAll("member_ids").map((v) => String(v).trim()).filter(Boolean))];

  if (!okrName) return { ok: false, error: "Pilih nama OKR yang mau di-assign." };
  if (memberIds.length === 0) return { ok: false, error: "Centang minimal satu anggota tim." };

  const admin = createAdminClient();

  // Nama OKR harus benar-benar ada di naskah OKR — assign ke nama yang salah
  // ketik akan jadi penugasan tanpa Objective/KR apa pun.
  const okrNameFinal = await canonicalOkrName(admin, okrName);
  const { count: objectiveCount } = await admin
    .from("okr_objectives")
    .select("id", { count: "exact", head: true })
    .eq("okr_name", okrNameFinal);
  if ((objectiveCount ?? 0) === 0) {
    return { ok: false, error: `"${okrName}" belum ada di OKR Setting — isi Objective-nya dulu.` };
  }

  const { data: members } = await admin
    .from("team_members")
    .select("id")
    .in("id", memberIds);
  const validIds = new Set((members ?? []).map((m) => m.id));
  const unknown = memberIds.filter((id) => !validIds.has(id));
  if (unknown.length > 0) {
    return { ok: false, error: `${unknown.length} anggota tim tidak ditemukan — muat ulang halaman.` };
  }

  const { data: already } = await admin
    .from("okr_assignments")
    .select("member_id")
    .eq("okr_name", okrNameFinal)
    .in("member_id", memberIds);
  const alreadySet = new Set((already ?? []).map((a) => a.member_id));
  const toInsert = memberIds.filter((id) => !alreadySet.has(id));

  if (toInsert.length === 0) {
    return { ok: false, error: "Semua anggota terpilih sudah dapat OKR ini." };
  }

  const { error } = await admin.from("okr_assignments").insert(
    toInsert.map((memberId) => ({ okr_name: okrNameFinal, member_id: memberId, assigned_by: actorId }))
  );
  if (error) return { ok: false, error: `Gagal assign OKR: ${error.message}` };

  await writeAudit({
    actorId, action: "m3.assign_okr", entityType: "okr_assignments",
    entityId: okrNameFinal,
    after: { okr_name: okrNameFinal, member_ids: toInsert, skipped_already_assigned: [...alreadySet] },
    type: "approval",
  });

  revalidatePath("/okr/director");
  revalidatePath("/okr");
  return { ok: true };
}

/** Batalkan satu penugasan OKR (nama OKR ↔ anggota tim). */
export async function unassignOkr(formData: FormData): Promise<ActionResult> {
  let actorId: string;
  try {
    const actor = await requirePermission("m3.set_target");
    actorId = actor.id;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const admin = createAdminClient();
  const assignmentId = Number(formData.get("assignment_id"));
  if (!assignmentId) return { ok: false, error: "Penugasan yang dihapus tidak dikenali." };

  const { data: before } = await admin
    .from("okr_assignments")
    .select("id, okr_name, member_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!before) return { ok: false, error: "Penugasan tidak ditemukan." };

  const { error } = await admin.from("okr_assignments").delete().eq("id", assignmentId);
  if (error) return { ok: false, error: `Gagal batalkan penugasan: ${error.message}` };

  await writeAudit({
    actorId, action: "m3.unassign_okr", entityType: "okr_assignments",
    entityId: String(assignmentId), before, type: "approval",
  });

  revalidatePath("/okr/director");
  revalidatePath("/okr");
  return { ok: true };
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
