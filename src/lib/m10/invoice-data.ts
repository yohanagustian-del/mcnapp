// Server-only: penerbitan & pemuatan invoice ads (ads_invoices 0100). SATU-SATUNYA
// jalur membuat invoice — dipanggil saat ACC request berpendanaan invoice
// (D-2026-10-31-3/6). Nomor INV-YYYYMM-NNNN berurutan per bulan, tidak dipakai ulang.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayWib } from "@/lib/utils/date";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import {
  invoiceAmounts,
  invoiceDueDate,
  invoiceReminderState,
  invoiceSeqOf,
  nextInvoiceNumber,
  type InvoiceReminderState,
  type InvoiceStatus,
} from "./request";
import { billToTypeOf, type FundingType } from "./funding-spec";

export const DEFAULT_PPN_RATE = 0.11;
export const DEFAULT_INVOICE_DUE_DAYS = 14;
export const DEFAULT_INVOICE_REMINDER_DAYS = 3;

export interface InvoiceConfig {
  ppnRate: number;
  dueDays: number;
  reminderDays: number;
}

/** Threshold dari app_config (CLAUDE.md: jangan hardcode) dengan fallback bila kunci belum ada. */
export async function loadInvoiceConfig(admin: SupabaseClient = createAdminClient()): Promise<InvoiceConfig> {
  const { data } = await admin
    .from("app_config")
    .select("key, value")
    .in("key", ["m10.invoice_ppn_rate", "m10.invoice_due_days", "m10.invoice_reminder_days"]);
  const map = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, Number(r.value)]));
  const pick = (k: string, d: number) => {
    const v = map.get(k);
    return v !== undefined && Number.isFinite(v) ? v : d;
  };
  return {
    ppnRate: pick("m10.invoice_ppn_rate", DEFAULT_PPN_RATE),
    dueDays: pick("m10.invoice_due_days", DEFAULT_INVOICE_DUE_DAYS),
    reminderDays: pick("m10.invoice_reminder_days", DEFAULT_INVOICE_REMINDER_DAYS),
  };
}

export interface IssueInvoiceInput {
  requestId: number;
  fundingType: FundingType;
  billToName: string;
  billToDetail?: string | null;
  dpp: number;
  actorId: string;
}

export type IssueInvoiceResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Terbitkan invoice untuk satu request. Nomor dialokasikan dari urutan terbesar bulan
 * ini; tabrakan (dua ACC bersamaan) ditangani dengan mencoba nomor berikutnya.
 */
export async function issueInvoiceForRequest(input: IssueInvoiceInput, admin: SupabaseClient = createAdminClient()): Promise<IssueInvoiceResult> {
  const billToType = billToTypeOf(input.fundingType);
  if (!billToType) return { ok: false, error: "[tipe pendanaan ini tidak ditagihkan lewat invoice]" };
  if (!input.billToName.trim()) return { ok: false, error: "[nama pihak yang ditagih wajib diisi sebelum invoice terbit]" };

  const cfg = await loadInvoiceConfig(admin);
  const issuedAt = todayWib();
  const yyyymm = issuedAt.slice(0, 7).replace("-", "");
  const amounts = invoiceAmounts(input.dpp, cfg.ppnRate);
  const dueDate = invoiceDueDate(issuedAt, cfg.dueDays);

  const { data: last } = await admin
    .from("ads_invoices")
    .select("id")
    .like("id", `INV-${yyyymm}-%`)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  let seq = last?.id ? invoiceSeqOf(String(last.id)) ?? 0 : 0;

  for (let attempt = 0; attempt < 5; attempt++) {
    const id = nextInvoiceNumber(yyyymm, seq);
    const { error } = await admin.from("ads_invoices").insert({
      id,
      request_id: input.requestId,
      bill_to_type: billToType,
      bill_to_name: input.billToName.trim(),
      bill_to_detail: input.billToDetail?.trim() || null,
      dpp: amounts.dpp,
      ppn_rate: amounts.ppnRate,
      ppn: amounts.ppn,
      total: amounts.total,
      issued_at: issuedAt,
      due_date: dueDate,
      status: "terbit",
      created_by: input.actorId,
    });
    if (!error) {
      await admin.from("ads_invoice_events").insert({
        invoice_id: id,
        event: "dibuat",
        actor_id: input.actorId,
        payload: { request_id: input.requestId, total: amounts.total, due_date: dueDate },
      });
      return { ok: true, id };
    }
    if (error.code === "23505" && error.message.includes("ads_invoices_pkey")) {
      seq += 1;
      continue;
    }
    if (error.code === "23505") {
      return { ok: false, error: "[request ini sudah punya invoice aktif]" };
    }
    return { ok: false, error: `Gagal menerbitkan invoice: ${error.message}` };
  }
  return { ok: false, error: "[gagal mengalokasikan nomor invoice, coba lagi]" };
}

export interface AdsInvoiceRow {
  id: string;
  requestId: number;
  billToType: "creator" | "brand";
  billToName: string;
  billToDetail: string | null;
  dpp: number;
  ppnRate: number;
  ppn: number;
  total: number;
  issuedAt: string;
  dueDate: string;
  status: InvoiceStatus;
  paidAt: string | null;
  paidAmount: number | null;
  proofUrl: string | null;
  note: string | null;
  createdAt: string;
  reminder: InvoiceReminderState;
  /** Konteks request (untuk tabel/PDF). */
  creatorName: string | null;
  projectName: string | null;
  slotDate: string | null;
  fundingType: FundingType | null;
  objective: string | null;
}

const INVOICE_SELECT =
  "id, request_id, bill_to_type, bill_to_name, bill_to_detail, dpp, ppn_rate, ppn, total, issued_at, due_date, status, paid_at, paid_amount, proof_url, note, created_at, " +
  "ads_briefs(funding_type, objective, creators(name), special_projects(name), live_schedule_slots(schedule_date))";

type RawInvoice = Record<string, unknown> & {
  ads_briefs?: {
    funding_type?: string | null;
    objective?: string | null;
    creators?: { name?: string | null } | null;
    special_projects?: { name?: string | null } | null;
    live_schedule_slots?: { schedule_date?: string | null } | null;
  } | null;
};

function shape(r: RawInvoice, reminderDays: number, today: string): AdsInvoiceRow {
  const status = r.status as InvoiceStatus;
  return {
    id: String(r.id),
    requestId: Number(r.request_id),
    billToType: r.bill_to_type as "creator" | "brand",
    billToName: String(r.bill_to_name ?? ""),
    billToDetail: (r.bill_to_detail as string | null) ?? null,
    dpp: Number(r.dpp),
    ppnRate: Number(r.ppn_rate),
    ppn: Number(r.ppn),
    total: Number(r.total),
    issuedAt: String(r.issued_at),
    dueDate: String(r.due_date),
    status,
    paidAt: (r.paid_at as string | null) ?? null,
    paidAmount: r.paid_amount == null ? null : Number(r.paid_amount),
    proofUrl: (r.proof_url as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: String(r.created_at ?? ""),
    reminder: status === "terbit" ? invoiceReminderState(String(r.due_date), today, reminderDays, false) : "aman",
    creatorName: r.ads_briefs?.creators?.name ?? null,
    projectName: r.ads_briefs?.special_projects?.name ?? null,
    slotDate: r.ads_briefs?.live_schedule_slots?.schedule_date ?? null,
    fundingType: (r.ads_briefs?.funding_type as FundingType | null) ?? null,
    objective: r.ads_briefs?.objective ?? null,
  };
}

export type LoadInvoicesResult =
  | { ok: true; rows: AdsInvoiceRow[]; config: InvoiceConfig }
  | { ok: false; migrationMissing: boolean; error: string; rows: AdsInvoiceRow[]; config: InvoiceConfig };

export async function loadInvoices(opts: { statuses?: InvoiceStatus[]; limit?: number } = {}): Promise<LoadInvoicesResult> {
  const admin = createAdminClient();
  const config = await loadInvoiceConfig(admin);
  let q = admin.from("ads_invoices").select(INVOICE_SELECT).order("issued_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.statuses?.length) q = q.in("status", opts.statuses);
  const { data, error } = await q;
  if (error) return { ok: false, migrationMissing: isMissingRelationError(error), error: error.message, rows: [], config };
  const today = todayWib();
  return { ok: true, rows: ((data ?? []) as unknown as RawInvoice[]).map((r) => shape(r, config.reminderDays, today)), config };
}

export async function loadInvoice(id: string): Promise<AdsInvoiceRow | null> {
  const admin = createAdminClient();
  const config = await loadInvoiceConfig(admin);
  const { data, error } = await admin.from("ads_invoices").select(INVOICE_SELECT).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return shape(data as unknown as RawInvoice, config.reminderDays, todayWib());
}

export interface InvoiceEventRow {
  id: number;
  event: string;
  actorName: string | null;
  actorLabel: string | null;
  payload: unknown;
  createdAt: string;
}

export async function loadInvoiceEvents(invoiceId: string): Promise<InvoiceEventRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ads_invoice_events")
    .select("id, event, actor_label, payload, created_at, team_members(name)")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: true });
  return ((data ?? []) as { id: number; event: string; actor_label: string | null; payload: unknown; created_at: string; team_members: { name?: string } | null }[]).map((e) => ({
    id: e.id,
    event: e.event,
    actorName: e.team_members?.name ?? null,
    actorLabel: e.actor_label,
    payload: e.payload,
    createdAt: e.created_at,
  }));
}
