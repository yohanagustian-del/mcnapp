"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";

/** Akhir quartal kalender dari tanggal ISO (binding 20 Feb → 31 Mar). */
function quarterEnd(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const q = Math.ceil(m / 3);
  const endMonth = q * 3; // 3, 6, 9, 12
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return `${y}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
}

/**
 * Catat closing binding (§2C.1): creator + specialist + sumber lead
 * (inbound/outbound/platform) + tanggal binding. Creator prospek → status
 * binding (aksi menambah income → auto berlaku, tetap di audit_logs).
 * QA feedback: snapshot komisi kreator saat binding + GMV 30 hari terakhir
 * (log-only) + quarter_end untuk atribusi GMV quartal akuisisi.
 */
export async function recordAcquisition(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.acquisition");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const leadSource = String(formData.get("lead_source") ?? "");
  const bindingDate = String(formData.get("binding_date") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!creatorId || !["inbound", "outbound", "platform"].includes(leadSource)) {
    throw new Error("Creator & sumber lead wajib diisi");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bindingDate)) throw new Error("Tanggal binding wajib diisi");

  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("creators").select("id, status, commission_share").eq("id", creatorId).maybeSingle();
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);

  // GMV 30 hari terakhir sebelum binding (log-only, dari data platform).
  // Module 0.5 Fase 2: creator_period_summary — semantiknya persis "total GMV
  // creator per periode", satu baris per creator per periode/batch.
  const start30 = new Date(`${bindingDate}T00:00:00Z`);
  start30.setUTCDate(start30.getUTCDate() - 30);
  const rows30 = await fetchAll<{ affiliate_gmv: number | null }>(
    admin, "creator_period_summary", "affiliate_gmv",
    (q) => q.eq("creator_id", creatorId)
      .gte("period_start", start30.toISOString().slice(0, 10)).lte("period_start", bindingDate));
  const gmvLast30d = rows30.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

  // Specialist = actor sendiri (kinerja pribadi); Lead melihat agregat tim di dashboard.
  const { data: acq, error } = await admin
    .from("acquisitions")
    .insert({
      creator_id: creatorId, specialist_id: actor.id, lead_source: leadSource,
      binding_date: bindingDate, notes,
      commission_share_at_binding: creator.commission_share, // snapshot (sumber: sync platform, read-only)
      gmv_last_30d: gmvLast30d,
      quarter_end: quarterEnd(bindingDate),
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal mencatat akuisisi: ${error.message}`);

  if (creator.status === "prospek") {
    await admin.from("creators").update({ status: "binding" }).eq("id", creatorId);
  }

  await writeAudit({
    actorId: actor.id, action: "m8.acquisition_record", entityType: "acquisitions",
    entityId: String(acq.id),
    after: {
      creator_id: creatorId, lead_source: leadSource, binding_date: bindingDate,
      commission_share_at_binding: creator.commission_share, gmv_last_30d: gmvLast30d,
      quarter_end: quarterEnd(bindingDate),
    },
    type: "auto",
  });
  revalidatePath("/workspace/acquisition");
}

/**
 * Referral program ajak teman (§2C.2): catat perujuk + creator baru + sumber
 * (antar_creator vs platform — mekanisme/komisi beda, wajib dibedakan).
 */
export async function recordReferral(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.acquisition");
  const newCreatorId = String(formData.get("new_creator_id") ?? "").trim();
  const referrerId = String(formData.get("referrer_creator_id") ?? "").trim();
  const source = String(formData.get("referral_source") ?? "");
  if (!newCreatorId || !["antar_creator", "platform"].includes(source)) {
    throw new Error("Creator baru & sumber referral wajib diisi");
  }
  // Referral platform tidak punya perujuk creator; antar-creator wajib punya.
  if (source === "antar_creator" && !referrerId) {
    throw new Error("Referral antar-creator wajib mencantumkan creator perujuk (CRT-...)");
  }

  const admin = createAdminClient();
  const ids = [newCreatorId, ...(referrerId ? [referrerId] : [])];
  const { data: found } = await admin.from("creators").select("id").in("id", ids);
  const foundSet = new Set((found ?? []).map((c) => c.id));
  for (const id of ids) if (!foundSet.has(id)) throw new Error(`Creator ${id} tidak ditemukan`);

  const { data: ref, error } = await admin
    .from("referrals")
    .insert({
      new_creator_id: newCreatorId,
      referrer_creator_id: source === "antar_creator" ? referrerId : null,
      referral_source: source, recorded_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal mencatat referral: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.referral_record", entityType: "referrals",
    entityId: String(ref.id),
    after: { new_creator_id: newCreatorId, referrer_creator_id: referrerId || null, referral_source: source },
    type: "auto",
  });
  revalidatePath("/workspace/acquisition");
}

/** Tandai komisi referral dibayar (dimensi pembayaran — lead/finance/management). */
export async function markReferralPaid(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.referral_pay");
  const refId = Number(formData.get("referral_id"));
  if (!refId) throw new Error("referral_id tidak valid");

  const admin = createAdminClient();
  const { data: ref } = await admin
    .from("referrals").select("id, commission_status, referral_source").eq("id", refId).maybeSingle();
  if (!ref) throw new Error(`Referral #${refId} tidak ditemukan`);
  if (ref.commission_status === "dibayar") throw new Error("Komisi referral sudah dibayar");

  const { error } = await admin
    .from("referrals").update({ commission_status: "dibayar" }).eq("id", refId);
  if (error) throw new Error(`Gagal update: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.referral_paid", entityType: "referrals", entityId: String(refId),
    before: { commission_status: ref.commission_status }, after: { commission_status: "dibayar" },
    type: "auto",
  });
  revalidatePath("/workspace/acquisition");
}

/**
 * Handoff ke CM (§2C.3): creator ter-binding + sudah punya owner CPM →
 * status Aktif, handoff selesai. Assignment owner dilakukan CM Lead (M1 §3.4).
 */
export async function markHandoffDone(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.acquisition");
  const acqId = Number(formData.get("acquisition_id"));
  if (!acqId) throw new Error("acquisition_id tidak valid");

  const admin = createAdminClient();
  const { data: acq } = await admin
    .from("acquisitions")
    .select("id, creator_id, handoff_done, creators(status, owner_cpm_id)")
    .eq("id", acqId)
    .maybeSingle();
  if (!acq) throw new Error(`Akuisisi #${acqId} tidak ditemukan`);
  if (acq.handoff_done) throw new Error("Handoff sudah ditandai selesai");
  const creator = acq.creators as unknown as { status: string; owner_cpm_id: string | null } | null;
  if (!creator?.owner_cpm_id) {
    throw new Error("Creator belum di-assign ke CPM — minta CM Lead assign dulu di CM Workspace");
  }

  const { error } = await admin
    .from("acquisitions").update({ handoff_done: true }).eq("id", acqId);
  if (error) throw new Error(`Gagal menandai handoff: ${error.message}`);
  if (creator.status !== "aktif" && acq.creator_id) {
    await admin.from("creators").update({ status: "aktif" }).eq("id", acq.creator_id);
  }

  await writeAudit({
    actorId: actor.id, action: "m8.handoff_cm", entityType: "acquisitions", entityId: String(acqId),
    before: { handoff_done: false, creator_status: creator.status },
    after: { handoff_done: true, creator_status: "aktif" },
    type: "auto",
  });
  revalidatePath("/workspace/acquisition");
}

/**
 * Refresh GMV post-join (§2C.1 — KR: GMV 3 bulan setelah join, window
 * m8.gmv_post_join_days): deterministik dari creator_period_summary (Module
 * 0.5 Fase 2 — repoint dari platform_metrics_raw, sama sumber data platform,
 * grain per-periode bukan per-hari — LOCKED §6.6), per acquisition yang punya
 * binding_date.
 */
export async function refreshGmvPostJoin(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.acquisition");
  void formData;
  const windowDays = await getConfig<number>("m8.gmv_post_join_days");
  const admin = createAdminClient();

  const acquisitions = await fetchAll<{ id: number; creator_id: string | null; binding_date: string | null; quarter_end: string | null }>(
    admin, "acquisitions", "id, creator_id, binding_date, quarter_end",
    (q) => q.not("binding_date", "is", null).not("creator_id", "is", null));

  let updated = 0;
  for (const acq of acquisitions) {
    const start = acq.binding_date!;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + Number(windowDays));
    const endIso = end.toISOString().slice(0, 10);

    const rows = await fetchAll<{ affiliate_gmv: number | null; period_start: string }>(
      admin, "creator_period_summary", "affiliate_gmv, period_start",
      (q) => q.eq("creator_id", acq.creator_id!).gte("period_start", start).lt("period_start", endIso));
    const gmv = rows.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

    // Atribusi quartal (QA): total GMV binding_date → akhir quartal berjalan.
    const qEnd = acq.quarter_end ?? quarterEnd(start);
    const qRows = await fetchAll<{ affiliate_gmv: number | null }>(
      admin, "creator_period_summary", "affiliate_gmv",
      (q) => q.eq("creator_id", acq.creator_id!).gte("period_start", start).lte("period_start", qEnd));
    const gmvQuarter = qRows.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

    const { error } = await admin
      .from("acquisitions")
      .update({ gmv_post_join: gmv, gmv_quarter_actual: gmvQuarter, quarter_end: qEnd })
      .eq("id", acq.id);
    if (error) throw new Error(`Gagal update GMV post-join #${acq.id}: ${error.message}`);
    updated++;
  }

  await writeAudit({
    actorId: actor.id, action: "m8.gmv_post_join_refresh", entityType: "acquisitions",
    entityId: null, after: { updated, window_days: windowDays }, type: "auto",
  });
  revalidatePath("/workspace/acquisition");
}
