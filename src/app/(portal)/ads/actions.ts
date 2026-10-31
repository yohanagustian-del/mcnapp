"use server";

import { revalidatePath } from "next/cache";
import { requireMember, requirePermission, hasPermission, MANAGEMENT_ROLES, type TeamMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseRupiah } from "@/lib/utils/rupiah";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import {
  fundingNeedsPaymentMethod,
  fundingProducesInvoice,
  isFundingType,
  isPaymentMethod,
  type FundingType,
  type PaymentMethod,
} from "@/lib/m10/funding-spec";
import {
  budgetMonthOf,
  canAccRequest,
  financeGate,
  initialRequestStatus,
  meaBudgetMessage,
  transition,
  validateRequestInput,
  type RequestAction,
  type RequestStatus,
} from "@/lib/m10/request";
import { loadMeaBudgetContext, MIGRATION_0100_MISSING } from "@/lib/m10/request-data";
import { issueInvoiceForRequest } from "@/lib/m10/invoice-data";

/**
 * Server action Request Ads (D-2026-10-31). Pola: tidak pernah throw ke klien —
 * hasil discriminated union (pesan Bahasa Indonesia). Semua tulisan lewat service
 * role + requirePermission + audit_logs. Status HANYA berubah lewat `transition()`.
 */
export type AdsActionResult = { ok: true; id?: number; message?: string } | { ok: false; error: string };

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
function int(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PATHS = ["/ads", "/finance", "/schedule", "/projects"];
function revalidateAll(id?: number) {
  for (const p of PATHS) revalidatePath(p);
  if (id) revalidatePath(`/ads/${id}`);
}

async function applyTransition(
  admin: ReturnType<typeof createAdminClient>,
  id: number,
  action: RequestAction,
  patch: Record<string, unknown>,
  actor: TeamMember,
  auditAction: string,
  auditType: "auto" | "approval" = "auto"
): Promise<AdsActionResult> {
  const { data: row, error } = await admin.from("ads_briefs").select("id, status").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: isMissingRelationError(error) ? MIGRATION_0100_MISSING : error.message };
  if (!row) return { ok: false, error: "[request ads tidak ditemukan]" };
  const t = transition(row.status as RequestStatus, action);
  if (!t.ok) return t;
  const { error: upErr } = await admin
    .from("ads_briefs")
    .update({ ...patch, status: t.to, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", row.status); // optimistic: status tidak berubah sejak dibaca
  if (upErr) return { ok: false, error: upErr.message };
  await writeAudit({
    actorId: actor.id, action: auditAction, entityType: "ads_briefs", entityId: String(id),
    before: { status: row.status }, after: { status: t.to, ...patch }, type: auditType,
  });
  return { ok: true, id };
}

// ---------- Buat request (CM / BizDev / Campaign Ops) ----------

export async function createAdsRequestAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.brief_create");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const admin = createAdminClient();

  const slotId = int(fd, "schedule_slot_id");
  const projectId = int(fd, "project_id");
  const fundingRaw = str(fd, "funding_type");
  const paymentRaw = str(fd, "payment_method");
  const fundingType = isFundingType(fundingRaw) ? fundingRaw : null;
  const paymentMethod = isPaymentMethod(paymentRaw) ? paymentRaw : null;
  const budgetRequested = parseRupiah(str(fd, "budget_requested"));
  const payerName = str(fd, "payer_name");
  const objective = str(fd, "objective");
  const notes = str(fd, "notes");
  const periodStart = str(fd, "period_start");
  const periodEnd = str(fd, "period_end");
  let creatorId = str(fd, "creator_id");

  const v = validateRequestInput({
    fundingType, paymentMethod: fundingType && fundingNeedsPaymentMethod(fundingType) ? paymentMethod : null,
    budgetRequested, ownerSlotId: slotId, ownerProjectId: projectId,
  });
  if (!v.ok) return v;
  const ft = fundingType as FundingType;
  const pm = fundingNeedsPaymentMethod(ft) ? paymentMethod : null;
  if (fundingNeedsPaymentMethod(ft) && !payerName) {
    return { ok: false, error: "[nama kreator/brand yang membayar wajib diisi untuk creator/brand budget]" };
  }
  for (const d of [periodStart, periodEnd]) {
    if (d && !DATE_RE.test(d)) return { ok: false, error: "[format tanggal periode ads tidak valid (YYYY-MM-DD)]" };
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return { ok: false, error: "[tanggal mulai periode ads harus sebelum tanggal selesai]" };
  }

  // Pemilik: slot Jadwal Live → kreator & tanggal dari slot; project → kreator peserta (opsional).
  let ownerDate: string | null = null;
  let slotBrand: string | null = null;
  if (slotId != null) {
    const { data: slot, error } = await admin
      .from("live_schedule_slots")
      .select("id, creator_id, schedule_date, status, brand_name")
      .eq("id", slotId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!slot) return { ok: false, error: "[slot jadwal live tidak ditemukan]" };
    if (slot.status === "off" || slot.status === "cancelled") {
      return { ok: false, error: "[slot OFF / tidak jadi live tidak bisa diberi request ads]" };
    }
    creatorId = slot.creator_id;
    ownerDate = slot.schedule_date;
    slotBrand = slot.brand_name;
    const { data: open } = await admin
      .from("ads_briefs")
      .select("id")
      .eq("schedule_slot_id", slotId)
      .not("status", "in", "(batal,ditolak,selesai)")
      .limit(1);
    if (open && open.length > 0) {
      return { ok: false, error: `[slot ini sudah punya request ads #${open[0].id} yang masih berjalan]` };
    }
  } else if (projectId != null) {
    const { data: project, error } = await admin
      .from("special_projects")
      .select("id, name, status, start_date, end_date")
      .eq("id", projectId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!project) return { ok: false, error: "[special project tidak ditemukan]" };
    if (project.status === "selesai" || project.status === "dibatalkan") {
      return { ok: false, error: "[project sudah selesai/dibatalkan — tidak bisa menambah request ads]" };
    }
    ownerDate = periodStart ?? (project.start_date as string | null) ?? null;
    if (creatorId) {
      const { data: part } = await admin
        .from("project_participants")
        .select("creator_id")
        .eq("project_id", projectId)
        .eq("creator_id", creatorId)
        .maybeSingle();
      if (!part) return { ok: false, error: "[kreator ini bukan peserta project tersebut]" };
    }
  }
  if (ft === "mea_budget" && !creatorId) {
    return { ok: false, error: "[budget MEA adalah jatah per kreator — pilih kreator peserta untuk request ini]" };
  }

  // Scope CPM: hanya kreator miliknya.
  if (creatorId) {
    try {
      await assertCreatorInScope(admin, actor, creatorId, "mengajukan request ads untuk");
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
    }
  }

  // Jatah MEA bulan tanggal live/project (D-2026-10-31-4).
  let budgetMonth: string | null = null;
  let meaCheck = null;
  if (ft === "mea_budget" && creatorId) {
    budgetMonth = budgetMonthOf(ownerDate ?? new Date().toISOString().slice(0, 10));
    try {
      meaCheck = await loadMeaBudgetContext(creatorId, budgetMonth, budgetRequested);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Gagal memeriksa jatah budget MEA" };
    }
  }
  const status = initialRequestStatus({ fundingType: ft, meaCheck });

  const { data: row, error } = await admin
    .from("ads_briefs")
    .insert({
      source: MANAGEMENT_ROLES.includes(actor.role) || actor.role === "cm_lead" || actor.role === "cpm" ? "cm" : "bizdev",
      creator_id: creatorId,
      project_id: projectId,
      schedule_slot_id: slotId,
      funding_type: ft,
      payment_method: pm,
      payer_name: payerName,
      budget_requested: budgetRequested,
      budget_month: budgetMonth,
      objective: objective ?? (slotBrand ? `Live ${slotBrand}` : null),
      notes,
      period_start: periodStart ?? ownerDate,
      period_end: periodEnd ?? (slotId != null ? ownerDate : null),
      status,
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: isMissingRelationError(error) ? MIGRATION_0100_MISSING : error.message };

  await writeAudit({
    actorId: actor.id, action: "m10.request_create", entityType: "ads_briefs", entityId: String(row.id),
    after: {
      funding_type: ft, payment_method: pm, budget_requested: budgetRequested, status,
      schedule_slot_id: slotId, project_id: projectId, creator_id: creatorId, budget_month: budgetMonth,
      mea_budget: meaCheck ? { budget: meaCheck.budget, used: meaCheck.used } : null,
    },
    type: status === "menunggu_approval_director" ? "approval" : "auto",
  });
  revalidateAll(row.id);
  return {
    ok: true,
    id: row.id,
    message: status === "menunggu_approval_director" && meaCheck ? meaBudgetMessage(meaCheck) : undefined,
  };
}

// ---------- Director: lewat jatah MEA ----------

export async function decideDirectorAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.budget_approve");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  const decision = str(fd, "decision");
  if (!id || !decision || !["approve", "reject"].includes(decision)) return { ok: false, error: "[keputusan tidak valid]" };
  const admin = createAdminClient();
  const note = str(fd, "note");
  if (decision === "reject" && !note) return { ok: false, error: "[alasan penolakan wajib diisi]" };
  const { data: row } = await admin.from("ads_briefs").select("budget_requested").eq("id", id).maybeSingle();
  const res = await applyTransition(
    admin, id, decision === "approve" ? "director_approve" : "director_reject",
    decision === "approve"
      ? { budget_approved: row?.budget_requested ?? null, notes_director: undefined, finance_note: note ?? null }
      : { finance_note: note, finance_status: "ditolak" },
    actor, "m10.budget_approve", "approval"
  );
  if (res.ok) revalidateAll(id);
  return res;
}

// ---------- Finance / Head CM: ACC & tolak ----------

export async function accRequestAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("finance.ads_review");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  if (!id) return { ok: false, error: "[request tidak valid]" };
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("ads_briefs")
    .select("id, status, funding_type, payment_method, payer_name, budget_requested, budget_approved, cash_received_at, creator_id, creators(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: isMissingRelationError(error) ? MIGRATION_0100_MISSING : error.message };
  if (!row) return { ok: false, error: "[request ads tidak ditemukan]" };
  const ft = row.funding_type as FundingType | null;
  const pm = (row.payment_method as PaymentMethod | null) ?? null;
  if (!ft) return { ok: false, error: "[brief lama tanpa tipe pendanaan — lengkapi dulu lewat request baru]" };
  if (!canAccRequest(actor.role, ft, pm)) {
    return { ok: false, error: pm === "cash_upfront"
      ? "[ACC pembayaran cash hanya oleh Finance]"
      : "[ACC request ini hanya oleh Head CM atau Finance]" };
  }
  // Cash: Finance boleh mengisi tanggal uang masuk sekaligus di form ACC.
  const cashReceivedAt = str(fd, "cash_received_at") ?? (row.cash_received_at as string | null);
  if (cashReceivedAt && !DATE_RE.test(cashReceivedAt)) return { ok: false, error: "[tanggal uang masuk tidak valid]" };
  const gate = financeGate({ fundingType: ft, paymentMethod: pm, cashReceivedAt });
  if (!gate.ok) return gate;

  const budgetApproved = parseRupiah(str(fd, "budget_approved")) ?? row.budget_approved ?? row.budget_requested;
  const note = str(fd, "note");
  const payerName = str(fd, "payer_name") ?? (row.payer_name as string | null);
  const now = new Date().toISOString();

  const res = await applyTransition(admin, id, "finance_acc", {
    finance_status: "disetujui",
    finance_checked_by: actor.id,
    finance_checked_at: now,
    finance_note: note,
    cash_received_at: cashReceivedAt,
    budget_approved: budgetApproved,
    payer_name: payerName,
  }, actor, "finance.ads_acc", "approval");
  if (!res.ok) return res;

  // Invoice terbit saat ACC untuk pendanaan lewat invoice (D-2026-10-31-3/6).
  if (fundingProducesInvoice(ft, pm)) {
    const creator = row.creators as unknown as { name?: string } | null;
    const inv = await issueInvoiceForRequest({
      requestId: id,
      fundingType: ft,
      billToName: payerName ?? creator?.name ?? "",
      billToDetail: str(fd, "bill_to_detail"),
      dpp: Number(budgetApproved ?? 0),
      actorId: actor.id,
    }, admin);
    if (!inv.ok) return { ok: false, error: `Request di-ACC tetapi invoice gagal terbit: ${inv.error}` };
    await writeAudit({
      actorId: actor.id, action: "finance.invoice_issue", entityType: "ads_invoices", entityId: inv.id,
      after: { request_id: id, dpp: budgetApproved }, type: "auto",
    });
    revalidateAll(id);
    return { ok: true, id, message: `Request di-ACC. Invoice ${inv.id} terbit.` };
  }
  revalidateAll(id);
  return { ok: true, id };
}

export async function rejectRequestAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("finance.ads_review");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  const note = str(fd, "note");
  if (!id) return { ok: false, error: "[request tidak valid]" };
  if (!note) return { ok: false, error: "[alasan penolakan wajib diisi]" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("ads_briefs").select("funding_type, payment_method").eq("id", id).maybeSingle();
  if (row?.funding_type && !canAccRequest(actor.role, row.funding_type as FundingType, (row.payment_method as PaymentMethod | null) ?? null)) {
    return { ok: false, error: "[Anda tidak berwenang menolak request dengan tipe pendanaan ini]" };
  }
  const res = await applyTransition(admin, id, "finance_reject", {
    finance_status: "ditolak", finance_checked_by: actor.id, finance_checked_at: new Date().toISOString(), finance_note: note,
  }, actor, "finance.ads_reject", "approval");
  if (res.ok) revalidateAll(id);
  return res;
}

/** Finance mencatat uang masuk (cash di awal) tanpa langsung ACC — ACC bisa dilakukan setelahnya. */
export async function recordCashReceivedAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("finance.invoice_manage");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  const date = str(fd, "cash_received_at");
  if (!id || !date || !DATE_RE.test(date)) return { ok: false, error: "[tanggal uang masuk wajib diisi]" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("ads_briefs").select("cash_received_at, payment_method").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "[request ads tidak ditemukan]" };
  if (row.payment_method !== "cash_upfront") return { ok: false, error: "[request ini bukan pembayaran cash di awal]" };
  const { error } = await admin.from("ads_briefs").update({ cash_received_at: date, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    actorId: actor.id, action: "finance.cash_received", entityType: "ads_briefs", entityId: String(id),
    before: { cash_received_at: row.cash_received_at }, after: { cash_received_at: date }, type: "auto",
  });
  revalidateAll(id);
  return { ok: true, id };
}

// ---------- Executor (Creator Support) ----------

export async function claimRequestAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.brief_execute");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  if (!id) return { ok: false, error: "[request tidak valid]" };
  const admin = createAdminClient();
  const res = await applyTransition(admin, id, "claim", {
    executed_by: actor.id, executed_at: new Date().toISOString(), assigned_to: actor.id,
  }, actor, "m10.request_claim");
  if (res.ok) revalidateAll(id);
  return res;
}

/** Input realisasi (ads_spent = sumber tunggal, feed M7). Upsert per (request, periode). */
export async function inputResultAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.result_input");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  const period = str(fd, "period");
  const adsSpent = parseRupiah(str(fd, "ads_spent"));
  const gmv = parseRupiah(str(fd, "gmv")) ?? 0;
  const num = (k: string) => {
    const v = str(fd, k);
    return v ? Number(v.replace(",", ".")) : null;
  };
  if (!id || !period || !DATE_RE.test(period)) return { ok: false, error: "[periode hasil wajib diisi]" };
  if (adsSpent == null || adsSpent < 0) return { ok: false, error: "[nominal ads spent wajib diisi]" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("ads_briefs").select("status").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "[request ads tidak ditemukan]" };
  if (!["dikerjakan", "selesai", "baru"].includes(row.status)) {
    return { ok: false, error: "[hasil hanya bisa diinput untuk request yang sedang/selesai dikerjakan]" };
  }
  const status = str(fd, "status") === "final" ? "final" : "draft";
  const { data: result, error } = await admin
    .from("ads_campaign_results")
    .upsert({
      brief_id: id, period, ads_spent: adsSpent, gmv,
      cpm: num("cpm"), ctr: num("ctr"), cvr: num("cvr"), roas: num("roas"),
      status, created_by: actor.id,
    }, { onConflict: "brief_id,period" })
    .select("id, flagged")
    .single();
  if (error) return { ok: false, error: error.message };
  await writeAudit({
    actorId: actor.id, action: "m10.result_input", entityType: "ads_campaign_results", entityId: String(result.id),
    after: { request_id: id, period, ads_spent: adsSpent, gmv, status, flagged: result.flagged }, type: "auto",
  });
  revalidateAll(id);
  return { ok: true, id, message: result.flagged ? "Tersimpan. ROAS tidak cocok dengan GMV/ads spent — ditandai untuk review." : undefined };
}

export async function finishRequestAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.brief_execute");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const id = int(fd, "request_id");
  if (!id) return { ok: false, error: "[request tidak valid]" };
  const admin = createAdminClient();
  const { count } = await admin.from("ads_campaign_results").select("id", { count: "exact", head: true }).eq("brief_id", id);
  if (!count) return { ok: false, error: "[isi minimal satu baris hasil (ads spent) sebelum menyelesaikan request]" };
  const res = await applyTransition(admin, id, "finish", {}, actor, "m10.request_finish");
  if (res.ok) revalidateAll(id);
  return res;
}

// ---------- Pembatalan (pembuat / management) ----------

export async function cancelRequestAction(fd: FormData): Promise<AdsActionResult> {
  const actor = await requireMember();
  const id = int(fd, "request_id");
  const reason = str(fd, "reason");
  if (!id) return { ok: false, error: "[request tidak valid]" };
  if (!reason) return { ok: false, error: "[alasan pembatalan wajib diisi]" };
  const admin = createAdminClient();
  const { data: row } = await admin.from("ads_briefs").select("created_by").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "[request ads tidak ditemukan]" };
  const allowed = row.created_by === actor.id || MANAGEMENT_ROLES.includes(actor.role) || hasPermission("finance.ads_review", actor.role);
  if (!allowed) return { ok: false, error: "[hanya pembuat request, management, atau Finance yang boleh membatalkan]" };
  const res = await applyTransition(admin, id, "cancel", { cancelled_reason: reason }, actor, "m10.request_cancel");
  if (res.ok) revalidateAll(id);
  return res;
}

// ---------- Jatah budget MEA (Head) ----------

export async function setMeaBudgetAction(fd: FormData): Promise<AdsActionResult> {
  let actor: TeamMember;
  try {
    actor = await requirePermission("m10.mea_budget_set");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Akses ditolak" };
  }
  const creatorId = str(fd, "creator_id");
  const month = str(fd, "month");
  const budget = parseRupiah(str(fd, "budget"));
  const note = str(fd, "note");
  if (!creatorId) return { ok: false, error: "[kreator wajib dipilih]" };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { ok: false, error: "[bulan jatah tidak valid (YYYY-MM)]" };
  if (budget == null || budget < 0) return { ok: false, error: "[nominal jatah wajib diisi (boleh 0)]" };
  const monthIso = `${month}-01`;
  const admin = createAdminClient();
  const { data: creator } = await admin.from("creators").select("id").eq("id", creatorId).maybeSingle();
  if (!creator) return { ok: false, error: "[kreator tidak ditemukan]" };
  const { data: before } = await admin.from("creator_ads_monthly_budgets").select("budget").eq("creator_id", creatorId).eq("month", monthIso).maybeSingle();
  const { error } = await admin.from("creator_ads_monthly_budgets").upsert({
    creator_id: creatorId, month: monthIso, budget, note, set_by: actor.id, set_at: new Date().toISOString(),
  }, { onConflict: "creator_id,month" });
  if (error) return { ok: false, error: isMissingRelationError(error) ? MIGRATION_0100_MISSING : error.message };
  // Menurunkan jatah berpotensi menahan request yang sudah masuk — tetap aksi management, dicatat sebagai approval.
  await writeAudit({
    actorId: actor.id, action: "m10.mea_budget_set", entityType: "creator_ads_monthly_budgets", entityId: `${creatorId}:${monthIso}`,
    before: before ? { budget: Number(before.budget) } : null, after: { budget, note },
    type: before && budget < Number(before.budget) ? "approval" : "auto",
  });
  revalidatePath("/ads/jatah");
  revalidatePath("/ads");
  return { ok: true };
}
