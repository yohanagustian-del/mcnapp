// Server-only pemuat data Request Ads (ads_briefs 0012 + 0100). Dipakai halaman /ads,
// /finance, Jadwal Live, dan Special Project — satu pemuat, bukan query per halaman.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import type { FundingType, PaymentMethod } from "./funding-spec";
import type { InvoiceStatus, RequestStatus } from "./request";
import { checkMeaBudget, type MeaBudgetCheck } from "./request";

export const MIGRATION_0100_MISSING =
  "Migrasi 0100 (Request Ads & Finance) belum di-apply di environment ini — kolom pendanaan, jatah budget MEA, dan invoice belum tersedia.";

export interface AdsRequestRow {
  id: number;
  status: RequestStatus;
  fundingType: FundingType | null;
  paymentMethod: PaymentMethod | null;
  payerName: string | null;
  budgetRequested: number | null;
  budgetApproved: number | null;
  budgetMonth: string | null;
  objective: string | null;
  notes: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  creatorId: string | null;
  creatorName: string | null;
  creatorOwnerCpmId: string | null;
  scheduleSlotId: number | null;
  slotDate: string | null;
  slotBrand: string | null;
  projectId: number | null;
  projectName: string | null;
  dealId: string | null;
  financeStatus: "belum_dicek" | "disetujui" | "ditolak";
  financeNote: string | null;
  financeCheckedByName: string | null;
  financeCheckedAt: string | null;
  cashReceivedAt: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  executedById: string | null;
  executedByName: string | null;
  executedAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  /** Σ ads_spent hasil (semua periode). */
  adsSpent: number;
  resultCount: number;
  invoice: { id: string; status: InvoiceStatus; total: number; dueDate: string; paidAt: string | null } | null;
}

const SELECT = [
  "id, status, source, funding_type, payment_method, payer_name, budget_requested, budget_approved, budget_month",
  "objective, notes, period_start, period_end, creator_id, schedule_slot_id, project_id, deal_id",
  "finance_status, finance_note, finance_checked_by, finance_checked_at, cash_received_at",
  "created_by, executed_by, executed_at, cancelled_reason, created_at",
  "creators(name, owner_cpm_id)",
  "live_schedule_slots(schedule_date, brand_name)",
  "special_projects(name)",
].join(", ");

type RawRow = Record<string, unknown> & {
  creators?: { name?: string | null; owner_cpm_id?: string | null } | null;
  live_schedule_slots?: { schedule_date?: string | null; brand_name?: string | null } | null;
  special_projects?: { name?: string | null } | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface LoadAdsRequestsOptions {
  /** Batasi ke request yang dibuat akun ini (CPM: miliknya sendiri). */
  requestedBy?: string | null;
  /** Batasi ke kreator milik CPM ini (creators.owner_cpm_id). */
  ownerCpmId?: string | null;
  statuses?: RequestStatus[];
  scheduleSlotIds?: number[];
  projectId?: number | null;
  limit?: number;
}

export type LoadAdsRequestsResult =
  | { ok: true; rows: AdsRequestRow[] }
  | { ok: false; migrationMissing: true; rows: AdsRequestRow[] }
  | { ok: false; migrationMissing: false; error: string; rows: AdsRequestRow[] };

export async function loadAdsRequests(opts: LoadAdsRequestsOptions = {}): Promise<LoadAdsRequestsResult> {
  const admin = createAdminClient();
  let q = admin.from("ads_briefs").select(SELECT).order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.requestedBy) q = q.eq("created_by", opts.requestedBy);
  if (opts.statuses?.length) q = q.in("status", opts.statuses);
  if (opts.scheduleSlotIds?.length) q = q.in("schedule_slot_id", opts.scheduleSlotIds);
  if (opts.projectId != null) q = q.eq("project_id", opts.projectId);

  const { data, error } = await q;
  if (error) {
    if (isMissingRelationError(error)) return { ok: false, migrationMissing: true, rows: [] };
    return { ok: false, migrationMissing: false, error: error.message, rows: [] };
  }
  let raw = (data ?? []) as unknown as RawRow[];
  if (opts.ownerCpmId) raw = raw.filter((r) => r.creators?.owner_cpm_id === opts.ownerCpmId);
  const rows = await hydrate(admin, raw);
  return { ok: true, rows };
}

export async function loadAdsRequest(id: number): Promise<AdsRequestRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("ads_briefs").select(SELECT).eq("id", id).maybeSingle();
  if (error || !data) return null;
  const [row] = await hydrate(admin, [data as unknown as RawRow]);
  return row ?? null;
}

async function hydrate(admin: SupabaseClient, raw: RawRow[]): Promise<AdsRequestRow[]> {
  if (raw.length === 0) return [];
  const ids = raw.map((r) => Number(r.id));
  const memberIds = new Set<string>();
  for (const r of raw) {
    for (const k of ["created_by", "executed_by", "finance_checked_by"]) {
      const v = r[k];
      if (typeof v === "string") memberIds.add(v);
    }
  }
  const [{ data: results }, { data: invoices }, { data: members }] = await Promise.all([
    admin.from("ads_campaign_results").select("brief_id, ads_spent").in("brief_id", ids),
    admin.from("ads_invoices").select("id, request_id, status, total, due_date, paid_at").in("request_id", ids).neq("status", "batal"),
    memberIds.size
      ? admin.from("team_members").select("id, name").in("id", [...memberIds])
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const spent = new Map<number, { sum: number; n: number }>();
  for (const r of (results ?? []) as { brief_id: number; ads_spent: number }[]) {
    const cur = spent.get(r.brief_id) ?? { sum: 0, n: 0 };
    cur.sum += Number(r.ads_spent ?? 0);
    cur.n += 1;
    spent.set(r.brief_id, cur);
  }
  const invByReq = new Map<number, AdsRequestRow["invoice"]>();
  for (const i of (invoices ?? []) as { id: string; request_id: number; status: InvoiceStatus; total: number; due_date: string; paid_at: string | null }[]) {
    invByReq.set(i.request_id, { id: i.id, status: i.status, total: Number(i.total), dueDate: i.due_date, paidAt: i.paid_at });
  }
  const nameById = new Map(((members ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const nameOf = (v: unknown) => (typeof v === "string" ? nameById.get(v) ?? null : null);

  return raw.map((r) => {
    const id = Number(r.id);
    const sp = spent.get(id) ?? { sum: 0, n: 0 };
    return {
      id,
      status: (r.status as RequestStatus) ?? "baru",
      fundingType: (r.funding_type as FundingType | null) ?? null,
      paymentMethod: (r.payment_method as PaymentMethod | null) ?? null,
      payerName: (r.payer_name as string | null) ?? null,
      budgetRequested: num(r.budget_requested),
      budgetApproved: num(r.budget_approved),
      budgetMonth: (r.budget_month as string | null) ?? null,
      objective: (r.objective as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      periodStart: (r.period_start as string | null) ?? null,
      periodEnd: (r.period_end as string | null) ?? null,
      creatorId: (r.creator_id as string | null) ?? null,
      creatorName: r.creators?.name ?? null,
      creatorOwnerCpmId: r.creators?.owner_cpm_id ?? null,
      scheduleSlotId: num(r.schedule_slot_id),
      slotDate: r.live_schedule_slots?.schedule_date ?? null,
      slotBrand: r.live_schedule_slots?.brand_name ?? null,
      projectId: num(r.project_id),
      projectName: r.special_projects?.name ?? null,
      dealId: (r.deal_id as string | null) ?? null,
      financeStatus: ((r.finance_status as string) ?? "belum_dicek") as AdsRequestRow["financeStatus"],
      financeNote: (r.finance_note as string | null) ?? null,
      financeCheckedByName: nameOf(r.finance_checked_by),
      financeCheckedAt: (r.finance_checked_at as string | null) ?? null,
      cashReceivedAt: (r.cash_received_at as string | null) ?? null,
      requestedById: (r.created_by as string | null) ?? null,
      requestedByName: nameOf(r.created_by),
      executedById: (r.executed_by as string | null) ?? null,
      executedByName: nameOf(r.executed_by),
      executedAt: (r.executed_at as string | null) ?? null,
      cancelledReason: (r.cancelled_reason as string | null) ?? null,
      createdAt: String(r.created_at ?? ""),
      adsSpent: sp.sum,
      resultCount: sp.n,
      invoice: invByReq.get(id) ?? null,
    };
  });
}

// ---------- Jatah budget MEA ----------

export interface MeaBudgetContext extends MeaBudgetCheck {
  creatorId: string;
  month: string;
  note: string | null;
}

/** Jatah + terpakai bulan ini untuk satu kreator (D-2026-10-31-4). `excludeRequestId` = saat menghitung ulang untuk request yang sudah ada. */
export async function loadMeaBudgetContext(
  creatorId: string,
  month: string,
  requested: number | null,
  excludeRequestId?: number
): Promise<MeaBudgetContext> {
  const admin = createAdminClient();
  const [{ data: budgetRow }, { data: usageRows }] = await Promise.all([
    admin.from("creator_ads_monthly_budgets").select("budget, note").eq("creator_id", creatorId).eq("month", month).maybeSingle(),
    admin
      .from("ads_briefs")
      .select("id, budget_requested, budget_approved")
      .eq("creator_id", creatorId)
      .eq("funding_type", "mea_budget")
      .eq("budget_month", month)
      .not("status", "in", "(batal,ditolak)"),
  ]);
  let used = 0;
  for (const r of (usageRows ?? []) as { id: number; budget_requested: number | null; budget_approved: number | null }[]) {
    if (excludeRequestId != null && r.id === excludeRequestId) continue;
    used += Number(r.budget_approved ?? r.budget_requested ?? 0);
  }
  const check = checkMeaBudget(budgetRow ? Number(budgetRow.budget) : null, used, requested);
  return { ...check, creatorId, month, note: budgetRow?.note ?? null };
}

export interface MeaBudgetListRow {
  creatorId: string;
  creatorName: string;
  username: string | null;
  month: string;
  budget: number;
  used: number;
  remaining: number;
  note: string | null;
}

/** Daftar jatah bulan tertentu + terpakai (view creator_mea_budget_usage_v). */
export async function loadMeaBudgetList(month: string): Promise<{ rows: MeaBudgetListRow[]; migrationMissing: boolean }> {
  const admin = createAdminClient();
  const [{ data: budgets, error }, { data: usage }] = await Promise.all([
    admin.from("creator_ads_monthly_budgets").select("creator_id, budget, note, creators(name, username)").eq("month", month).order("creator_id"),
    admin.from("creator_mea_budget_usage_v").select("creator_id, used").eq("budget_month", month),
  ]);
  if (error) return { rows: [], migrationMissing: isMissingRelationError(error) };
  const usedBy = new Map(((usage ?? []) as { creator_id: string; used: number }[]).map((u) => [u.creator_id, Number(u.used)]));
  const rows: MeaBudgetListRow[] = ((budgets ?? []) as { creator_id: string; budget: number; note: string | null; creators: { name?: string; username?: string | null } | null }[]).map((b) => {
    const used = usedBy.get(b.creator_id) ?? 0;
    const budget = Number(b.budget);
    return {
      creatorId: b.creator_id,
      creatorName: b.creators?.name ?? b.creator_id,
      username: b.creators?.username ?? null,
      month,
      budget,
      used,
      remaining: Math.max(0, budget - used),
      note: b.note,
    };
  });
  // Kreator yang memakai jatah tanpa baris jatah (= 0) ikut tampil supaya Head melihatnya.
  for (const [creatorId, used] of usedBy) {
    if (rows.some((r) => r.creatorId === creatorId)) continue;
    rows.push({ creatorId, creatorName: creatorId, username: null, month, budget: 0, used, remaining: 0, note: null });
  }
  return { rows, migrationMissing: false };
}
