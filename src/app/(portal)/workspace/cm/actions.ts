"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { genId } from "@/lib/utils/id";
import { parseRupiah } from "@/lib/utils/rupiah";
import { adsNeedsDirectorApproval, isPerfDrop, latestTwoPeriods, type PeriodSummaryPoint } from "@/lib/m8/routing";
import { assertComplaintMutationAllowed, type ComplaintCore, type ComplaintStatus, type Severity } from "@/lib/m9/portal";

/** CPM hanya untuk creator yang di-handle sendiri; CM Lead/management lintas (§2F). */
function assertCreatorScope(actor: TeamMember, ownerCpmId: string | null) {
  if (actor.role === "cpm" && ownerCpmId !== actor.id) {
    throw new Error("Akses ditolak: creator ini di-handle CPM lain");
  }
}

/** Assign/re-assign creator ke CPM (§2A.1) — CM Lead/Head; perubahan owner ter-audit. */
export async function assignCreator(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.assign_creator");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const newOwnerId = String(formData.get("owner_cpm_id") ?? "").trim();
  if (!creatorId || !newOwnerId) throw new Error("Creator & CPM tujuan wajib dipilih");

  const admin = createAdminClient();
  const [{ data: creator }, { data: owner }] = await Promise.all([
    admin.from("creators").select("id, owner_cpm_id").eq("id", creatorId).maybeSingle(),
    admin.from("team_members").select("id, role, active").eq("id", newOwnerId).maybeSingle(),
  ]);
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);
  if (!owner || !owner.active || !["cpm", "cm_lead"].includes(owner.role)) {
    throw new Error("Tujuan assignment harus CPM/CM Lead aktif");
  }

  const { error } = await admin
    .from("creators").update({ owner_cpm_id: newOwnerId }).eq("id", creatorId);
  if (error) throw new Error(`Gagal assign: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.assign_creator", entityType: "creators", entityId: creatorId,
    before: { owner_cpm_id: creator.owner_cpm_id }, after: { owner_cpm_id: newOwnerId },
    type: "auto",
  });
  revalidatePath("/workspace/cm");
}

/**
 * Scan growth mingguan (§2A.2, LOCKED §6.1): GMV turun > m8.perf_drop
 * periode-ke-periode → platform_alert perf_drop ke CPM owner (event, bukan
 * approval); pulih → auto-resolve. Basis = creator_period_summary (Module 0.5
 * Fase 2 — satu baris per creator per periode, bukan platform_metrics_raw
 * per-hari; menyamakan pola dengan growth column di workspace/cm/page.tsx).
 */
export async function refreshGrowthAlerts(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.growth_scan");
  void formData;
  const threshold = await getConfig<number>("m8.perf_drop");
  const admin = createAdminClient();

  const scoped = actor.role === "cpm"
    ? (q: ReturnType<ReturnType<typeof admin.from>["select"]>) => q.eq("owner_cpm_id", actor.id)
    : (q: ReturnType<ReturnType<typeof admin.from>["select"]>) => q;
  const creators = await fetchAll<{ id: string; name: string; owner_cpm_id: string | null }>(
    admin, "creators", "id, name, owner_cpm_id", scoped);
  if (creators.length === 0) { revalidatePath("/workspace/cm"); return; }

  const ids = creators.map((c) => c.id);
  const rows = await fetchAll<{ creator_id: string; period_start: string; period_end: string; upload_batch: string; affiliate_gmv: number | null; created_at: string }>(
    admin, "creator_period_summary",
    "creator_id, period_start, period_end, upload_batch, affiliate_gmv, created_at",
    (q) => q.in("creator_id", ids));

  // Group per creator; latestTwoPeriods dedupes multi-batch periods (latest
  // batch by created_at wins) and returns the two most recent periods.
  const byCreator = new Map<string, PeriodSummaryPoint[]>();
  for (const r of rows) {
    const list = byCreator.get(r.creator_id) ?? [];
    list.push({
      periodStart: r.period_start, periodEnd: r.period_end, uploadBatch: r.upload_batch,
      affiliateGmv: Number(r.affiliate_gmv ?? 0), createdAt: r.created_at,
    });
    byCreator.set(r.creator_id, list);
  }

  for (const creator of creators) {
    const point = latestTwoPeriods(byCreator.get(creator.id) ?? []);
    const dropped = point?.previous != null && isPerfDrop(point.current, point.previous, threshold);

    const { data: open } = await admin
      .from("platform_alerts").select("id")
      .eq("alert_type", "perf_drop").eq("entity_id", creator.id).eq("resolved", false)
      .limit(1).maybeSingle();

    if (dropped && point && point.previous !== null) {
      if (open) continue;
      const dropPct = (point.previous - point.current) / point.previous;
      const { error } = await admin.from("platform_alerts").insert({
        alert_type: "perf_drop", entity_type: "creators", entity_id: creator.id,
        message: `GMV ${creator.name} turun ${(dropPct * 100).toFixed(0)}% periode-ke-periode (${point.periodStart}–${point.periodEnd} vs sebelumnya) — cek report M2`,
        payload: { owner_cpm_id: creator.owner_cpm_id, current: point.current, previous: point.previous, week: point.periodStart },
        week: point.periodStart,
      });
      if (error) throw new Error(`Gagal menulis alert: ${error.message}`);
      await writeAudit({
        actorId: null, action: "m8.perf_drop", entityType: "creators", entityId: creator.id,
        after: { current: point.current, previous: point.previous, drop_pct: dropPct },
        type: "platform_alert",
      });
    } else if (!dropped && open) {
      await admin.from("platform_alerts").update({ resolved: true }).eq("id", open.id);
    }
  }
  revalidatePath("/workspace/cm");
}

/**
 * Req creator sample/ads/HSL (§2A.4): sample tak terbatas; HSL per sesi (acc di
 * brand); ads dicek terhadap creators.ads_budget_cap — lewat cap / tak
 * terverifikasi → approval Director (LOCKED §6.4, CLAUDE.md #2).
 */
export async function createCreatorRequest(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.creator_request");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const targetBrand = String(formData.get("target_brand") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const amount = parseRupiah(String(formData.get("amount") ?? ""));
  if (!creatorId || !["sample", "ads", "hsl"].includes(type)) {
    throw new Error("Creator & jenis req wajib diisi");
  }

  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("creators").select("id, owner_cpm_id, ads_budget_cap").eq("id", creatorId).maybeSingle();
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);
  assertCreatorScope(actor, creator.owner_cpm_id);

  const needsApproval = type === "ads" &&
    adsNeedsDirectorApproval(amount, creator.ads_budget_cap === null ? null : Number(creator.ads_budget_cap));

  const { data: req, error } = await admin
    .from("creator_requests")
    .insert({
      creator_id: creatorId, type, target_brand: targetBrand, amount, notes,
      status: "diajukan", requested_by: actor.id,
      approval_status: needsApproval ? "menunggu" : "n_a",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal membuat req: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.creator_request", entityType: "creator_requests",
    entityId: String(req.id),
    after: { creator_id: creatorId, type, target_brand: targetBrand, amount, needs_director_approval: needsApproval },
    type: needsApproval ? "approval" : "auto",
  });
  revalidatePath("/workspace/cm");
  revalidatePath("/workspace/bizdev");
}

/** Approval Director untuk req ads melewati cap (§6.4). Ditolak → req ditutup. */
export async function approveAdsRequest(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.ads_approve");
  const reqId = Number(formData.get("req_id"));
  const decision = String(formData.get("decision"));
  if (!reqId || (decision !== "approved" && decision !== "ditolak")) {
    throw new Error("Keputusan approval tidak valid");
  }

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("creator_requests").select("id, approval_status, status").eq("id", reqId).maybeSingle();
  if (!req) throw new Error(`Req #${reqId} tidak ditemukan`);
  if (req.approval_status !== "menunggu") throw new Error("Req tidak sedang menunggu approval Director");

  const patch = decision === "approved"
    ? { approval_status: "approved", approved_by: actor.id, updated_at: new Date().toISOString() }
    : { approval_status: "ditolak", approved_by: actor.id, status: "selesai", updated_at: new Date().toISOString() };
  const { error } = await admin.from("creator_requests").update(patch).eq("id", reqId);
  if (error) throw new Error(`Gagal approval: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.ads_approve", entityType: "creator_requests",
    entityId: String(reqId), before: { approval_status: req.approval_status },
    after: { approval_status: patch.approval_status }, type: "approval",
  });
  revalidatePath("/workspace/cm");
  revalidatePath("/workspace/bizdev");
}

/**
 * Tracker shop potensial CM→BizDev (§2A.5): lead manual pelengkap lead otomatis
 * M4 — masuk pipeline bd_leads dengan source manual_cm.
 */
export async function submitShopLead(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.lead_manual");
  const shopId = String(formData.get("shop_id") ?? "").trim();
  if (!shopId || !/^\d+$/.test(shopId)) throw new Error("Shop ID wajib numeric");

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("bd_leads").select("id, source").eq("shop_id", shopId).maybeSingle();
  if (existing) throw new Error(`Shop ${shopId} sudah ada di pipeline lead (source ${existing.source})`);

  const week = new Date().toISOString().slice(0, 10);
  const { data: lead, error } = await admin
    .from("bd_leads")
    .insert({ shop_id: shopId, source: "manual_cm", status: "baru", first_seen_week: week })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal mencatat lead: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.shop_lead_manual", entityType: "bd_leads",
    entityId: String(lead.id), after: { shop_id: shopId, source: "manual_cm" }, type: "auto",
  });
  revalidatePath("/workspace/cm");
  revalidatePath("/workspace/bizdev");
}

// ============ E-sign kontrak TC/Celeb (§2A.7, §3.3) ============
// Provider (Privy/Mekari Sign) masih BLOCKER di BUILD_PLAN — alur status
// draft→sent→signed/expired berjalan penuh + audit; pemanggilan API provider
// menyusul saat provider dipilih (kolom provider sudah tersimpan).

export async function createContract(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.esign");
  const creatorId = String(formData.get("creator_id") ?? "").trim();
  const contractDoc = String(formData.get("contract_doc") ?? "").trim() || null;
  const expiresAt = String(formData.get("expires_at") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!creatorId) throw new Error("Creator wajib dipilih");

  const admin = createAdminClient();
  const { data: creator } = await admin
    .from("creators").select("id, segment, owner_cpm_id").eq("id", creatorId).maybeSingle();
  if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);
  assertCreatorScope(actor, creator.owner_cpm_id);
  // Kontrak tertulis khusus segmen TC & Celebrity (§2A.7); creator lain tidak wajib.
  if (!["tc", "celeb"].includes(creator.segment ?? "")) {
    throw new Error("Kontrak e-sign hanya untuk segmen Top Creator / Celebrity");
  }

  const { data: contract, error } = await admin
    .from("creator_contracts")
    .insert({
      creator_id: creatorId, segment: creator.segment, contract_doc: contractDoc,
      esign_status: "draft", expires_at: expiresAt, notes, created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal membuat draft kontrak: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.contract_draft", entityType: "creator_contracts",
    entityId: String(contract.id), after: { creator_id: creatorId, segment: creator.segment },
    type: "auto",
  });
  revalidatePath("/workspace/cm");
}

const CONTRACT_TRANSITIONS: Record<string, { from: string; action: string; patch: () => Record<string, unknown> }> = {
  send: {
    from: "draft", action: "m8.contract_send",
    patch: () => ({ esign_status: "sent", sent_at: new Date().toISOString(), provider: process.env.ESIGN_PROVIDER ?? null }),
  },
  signed: {
    from: "sent", action: "m8.contract_signed",
    patch: () => ({ esign_status: "signed", signed_at: new Date().toISOString() }),
  },
  expired: {
    from: "sent", action: "m8.contract_expired",
    patch: () => ({ esign_status: "expired" }),
  },
};

export async function transitionContract(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.esign");
  const contractId = Number(formData.get("contract_id"));
  const step = String(formData.get("step"));
  const transition = CONTRACT_TRANSITIONS[step];
  if (!contractId || !transition) throw new Error("Transisi kontrak tidak valid");

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from("creator_contracts")
    .select("id, esign_status, creator_id, creators(owner_cpm_id)")
    .eq("id", contractId)
    .maybeSingle();
  if (!contract) throw new Error(`Kontrak #${contractId} tidak ditemukan`);
  assertCreatorScope(actor, (contract.creators as unknown as { owner_cpm_id: string | null } | null)?.owner_cpm_id ?? null);
  if (contract.esign_status !== transition.from) {
    throw new Error(`Transisi tidak valid: kontrak berstatus ${contract.esign_status}, butuh ${transition.from}`);
  }

  const patch = transition.patch();
  const { error } = await admin.from("creator_contracts").update(patch).eq("id", contractId);
  if (error) throw new Error(`Gagal update kontrak: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: transition.action, entityType: "creator_contracts",
    entityId: String(contractId), before: { esign_status: contract.esign_status },
    after: patch, type: "auto",
  });
  revalidatePath("/workspace/cm");
}

/**
 * CM self-sourced deal (QA feedback): CM mencarikan deals/sample/komisi special
 * untuk kreatornya TANPA lewat BizDev. Tercatat sourced_by_role='cm' sehingga
 * kontribusi CM terlihat di list deal & OKR. Validasi inti sama dengan form BizDev.
 */
export async function registerCmDeal(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.creator_request"); // CPM/CM Lead

  const brandName = String(formData.get("brand_name") ?? "").trim();
  const shopId = String(formData.get("shop_id") ?? "").trim();
  const niche = String(formData.get("niche") ?? "").trim();
  const expDate = String(formData.get("exp_date") ?? "").trim();
  const campaignType = String(formData.get("campaign_type") ?? "paid");
  const komisiKreator = Number(String(formData.get("komisi_kreator") ?? "").trim());
  const creatorId = String(formData.get("creator_id") ?? "").trim() || null;

  if (!brandName) throw new Error("Nama brand wajib (sesuai display platform)");
  if (!/^\d+$/.test(shopId)) throw new Error("Shop ID harus angka");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expDate)) throw new Error("Exp date wajib dari date picker");
  if (!["paid", "sample", "extra_commission"].includes(campaignType)) {
    throw new Error("Tipe campaign tidak valid");
  }
  if (!Number.isFinite(komisiKreator) || komisiKreator < 0 || komisiKreator > 100) {
    throw new Error("Komisi kreator harus angka 0-100");
  }

  const admin = createAdminClient();
  const { data: dupe } = await admin
    .from("brand_deals").select("id").eq("shop_id", shopId).maybeSingle();
  if (dupe) throw new Error(`Shop ID ${shopId} sudah terdaftar di deal ${dupe.id}`);

  const id = genId("DEAL");
  const { error } = await admin.from("brand_deals").insert({
    id,
    brand_name: brandName,
    shop_id: shopId,
    niche,
    exp_date: expDate,
    deal_end: expDate,
    komisi_kreator_raw: `${komisiKreator}%`,
    komisi_kreator_pct: komisiKreator,
    campaign_type: campaignType,
    sourced_by_role: "cm",
    sourced_by: actor.id,
    status: "running",
    notes: creatorId ? `Deal dicarikan CM untuk ${creatorId}` : null,
    created_by: actor.id,
  });
  if (error) throw new Error(`Gagal menyimpan deal: ${error.message}`);

  // Sinkron exp_date → cooperating_shops (alert kadaluarsa M4), pola sama BizDev.
  await admin.from("cooperating_shops").upsert(
    {
      shop_id: shopId,
      deal_id: id,
      deal_end: expDate,
      active_flag: expDate >= new Date().toISOString().slice(0, 10),
    },
    { onConflict: "shop_id" }
  );

  await writeAudit({
    actorId: actor.id,
    action: "m8.cm_self_sourced_deal",
    entityType: "brand_deals",
    entityId: id,
    after: { brand_name: brandName, shop_id: shopId, campaign_type: campaignType, sourced_by_role: "cm", for_creator: creatorId },
    type: "auto",
  });
  revalidatePath("/workspace/cm");
  revalidatePath("/deals");
}

// ============ M9 Komplain Kreator surfaced di CM Workspace ============
// Read side (list + scope) lives in page.tsx; these are the only mutations —
// reply (append-only) and status transition. Never throw across the action
// boundary (Next prod censors it — see leak-actions.ts pattern); return
// {ok,error} instead so the UI can show the real message.

export interface ComplaintActionState {
  ok: boolean;
  error?: string;
}

async function loadComplaintForMutation(complaintId: number) {
  const admin = createAdminClient();
  const { data: complaint } = await admin
    .from("creator_complaints")
    .select("id, creator_id, category, severity, body, status, target_cpm_id")
    .eq("id", complaintId)
    .maybeSingle();
  if (!complaint) throw new Error(`Komplain #${complaintId} tidak ditemukan`);
  return { admin, complaint };
}

/** CPM hanya boleh mengelola komplain yang di-target ke dirinya; CM Lead/management lintas (§2F). */
function assertComplaintScope(actor: TeamMember, targetCpmId: string | null) {
  if (actor.role === "cpm" && targetCpmId !== actor.id) {
    throw new Error("Akses ditolak: komplain ini ditargetkan ke CPM lain");
  }
}

/** Balas komplain kreator (append-only — complaint_replies tidak bisa diedit/dihapus). */
export async function replyToComplaint(
  _prev: ComplaintActionState | null,
  formData: FormData
): Promise<ComplaintActionState> {
  try {
    const actor = await requirePermission("m9.complaint_manage");
    const complaintId = Number(formData.get("complaint_id"));
    const body = String(formData.get("body") ?? "").trim();
    if (!complaintId) throw new Error("Komplain tidak valid");
    if (!body) throw new Error("Isi balasan wajib diisi");

    const { admin, complaint } = await loadComplaintForMutation(complaintId);
    assertComplaintScope(actor, complaint.target_cpm_id);

    const { data: reply, error } = await admin
      .from("complaint_replies")
      .insert({
        complaint_id: complaintId,
        author_id: actor.id,
        author_role: actor.role,
        body,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Gagal mengirim balasan: ${error.message}`);

    await writeAudit({
      actorId: actor.id,
      action: "m9.complaint_reply",
      entityType: "complaint_replies",
      entityId: String(reply.id),
      after: { complaint_id: complaintId, author_role: actor.role },
      type: "auto",
    });
    revalidatePath("/workspace/cm");
    revalidatePath("/portal/complaints");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

const COMPLAINT_STATUS_TRANSITIONS: ComplaintStatus[] = ["dalam-penyelesaian", "selesai"];

/**
 * Update status komplain (§2.7). 'selesai' set closed_at/closed_by. Body/creator/
 * severity/category immutable — dijaga assertComplaintMutationAllowed (mirror trigger SQL).
 */
export async function updateComplaintStatus(
  _prev: ComplaintActionState | null,
  formData: FormData
): Promise<ComplaintActionState> {
  try {
    const actor = await requirePermission("m9.complaint_manage");
    const complaintId = Number(formData.get("complaint_id"));
    const status = String(formData.get("status") ?? "");
    if (!complaintId) throw new Error("Komplain tidak valid");
    if (!COMPLAINT_STATUS_TRANSITIONS.includes(status as ComplaintStatus)) {
      throw new Error("Status tidak valid");
    }

    const { admin, complaint } = await loadComplaintForMutation(complaintId);
    assertComplaintScope(actor, complaint.target_cpm_id);

    const before: ComplaintCore & { status: ComplaintStatus } = {
      body: complaint.body,
      creator_id: complaint.creator_id,
      severity: complaint.severity as Severity,
      category: complaint.category,
      status: complaint.status as ComplaintStatus,
    };
    const after: ComplaintCore & { status: ComplaintStatus } = { ...before, status: status as ComplaintStatus };
    assertComplaintMutationAllowed(before, after); // body/creator/severity/category tak berubah — no-op check, defense-in-depth

    const patch: Record<string, unknown> = { status };
    if (status === "selesai") {
      patch.closed_at = new Date().toISOString();
      patch.closed_by = actor.id;
    }

    const { error } = await admin.from("creator_complaints").update(patch).eq("id", complaintId);
    if (error) throw new Error(`Gagal update status: ${error.message}`);

    await writeAudit({
      actorId: actor.id,
      action: "m9.complaint_status",
      entityType: "creator_complaints",
      entityId: String(complaintId),
      before: { status: before.status },
      after: patch,
      type: "auto",
    });
    revalidatePath("/workspace/cm");
    revalidatePath("/portal/complaints");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}
