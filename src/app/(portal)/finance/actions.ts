"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseRupiah } from "@/lib/utils/rupiah";
import { validatePayment } from "@/lib/m10/request";

/** Server action invoice (Finance). Status invoice hanya: terbit → lunas | batal. Riwayat = ads_invoice_events (append-only). */
export type FinanceActionResult = { ok: true; message?: string } | { ok: false; error: string };

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function revalidate(invoiceId: string, requestId?: number) {
  revalidatePath("/finance");
  revalidatePath(`/finance/invoice/${invoiceId}`);
  revalidatePath("/ads");
  if (requestId) revalidatePath(`/ads/${requestId}`);
}

async function guard(): Promise<{ actor: TeamMember } | { error: string }> {
  try {
    return { actor: await requirePermission("finance.invoice_manage") };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Akses ditolak" };
  }
}

export async function recordInvoicePaymentAction(fd: FormData): Promise<FinanceActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const id = str(fd, "invoice_id");
  const paidAt = str(fd, "paid_at");
  const paidAmount = parseRupiah(str(fd, "paid_amount"));
  const proofUrl = str(fd, "proof_url");
  const note = str(fd, "note");
  if (!id) return { ok: false, error: "[invoice tidak valid]" };
  if (!paidAt || !DATE_RE.test(paidAt)) return { ok: false, error: "[tanggal pembayaran wajib diisi]" };

  const admin = createAdminClient();
  const { data: inv } = await admin.from("ads_invoices").select("id, status, total, request_id").eq("id", id).maybeSingle();
  if (!inv) return { ok: false, error: "[invoice tidak ditemukan]" };
  if (inv.status !== "terbit") return { ok: false, error: "[invoice sudah lunas atau dibatalkan]" };
  const v = validatePayment(Number(inv.total), paidAmount);
  if (!v.ok) return v;

  const { error } = await admin
    .from("ads_invoices")
    .update({ status: "lunas", paid_at: paidAt, paid_amount: paidAmount, proof_url: proofUrl, note: note ?? undefined, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "terbit");
  if (error) return { ok: false, error: error.message };
  await admin.from("ads_invoice_events").insert({
    invoice_id: id, event: "dibayar", actor_id: g.actor.id, payload: { paid_at: paidAt, paid_amount: paidAmount, proof_url: proofUrl },
  });
  // Alert jatuh tempo invoice ini (bila ada) ditutup.
  await admin.from("platform_alerts").update({ resolved: true }).eq("entity_type", "ads_invoices").eq("entity_id", id).eq("resolved", false);
  await writeAudit({
    actorId: g.actor.id, action: "finance.invoice_paid", entityType: "ads_invoices", entityId: id,
    before: { status: "terbit" }, after: { status: "lunas", paid_at: paidAt, paid_amount: paidAmount }, type: "auto",
  });
  revalidate(id, Number(inv.request_id));
  return { ok: true, message: `Invoice ${id} ditandai lunas.` };
}

export async function markInvoiceSentAction(fd: FormData): Promise<FinanceActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const id = str(fd, "invoice_id");
  const channel = str(fd, "channel") ?? "wa";
  if (!id) return { ok: false, error: "[invoice tidak valid]" };
  const admin = createAdminClient();
  const { data: inv } = await admin.from("ads_invoices").select("id, status, request_id").eq("id", id).maybeSingle();
  if (!inv) return { ok: false, error: "[invoice tidak ditemukan]" };
  if (inv.status !== "terbit") return { ok: false, error: "[hanya invoice berstatus terbit yang dicatat terkirim]" };
  const { error } = await admin.from("ads_invoice_events").insert({
    invoice_id: id, event: "dikirim", actor_id: g.actor.id, payload: { channel },
  });
  if (error) return { ok: false, error: error.message };
  await writeAudit({ actorId: g.actor.id, action: "finance.invoice_sent", entityType: "ads_invoices", entityId: id, after: { channel }, type: "auto" });
  revalidate(id, Number(inv.request_id));
  return { ok: true };
}

export async function cancelInvoiceAction(fd: FormData): Promise<FinanceActionResult> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  const id = str(fd, "invoice_id");
  const reason = str(fd, "reason");
  if (!id) return { ok: false, error: "[invoice tidak valid]" };
  if (!reason) return { ok: false, error: "[alasan pembatalan wajib diisi]" };
  const admin = createAdminClient();
  const { data: inv } = await admin.from("ads_invoices").select("id, status, request_id").eq("id", id).maybeSingle();
  if (!inv) return { ok: false, error: "[invoice tidak ditemukan]" };
  if (inv.status !== "terbit") return { ok: false, error: "[hanya invoice berstatus terbit yang bisa dibatalkan]" };
  const { error } = await admin
    .from("ads_invoices")
    .update({ status: "batal", note: reason, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "terbit");
  if (error) return { ok: false, error: error.message };
  await admin.from("ads_invoice_events").insert({ invoice_id: id, event: "dibatalkan", actor_id: g.actor.id, payload: { reason } });
  await admin.from("platform_alerts").update({ resolved: true }).eq("entity_type", "ads_invoices").eq("entity_id", id).eq("resolved", false);
  // Membatalkan invoice = tagihan hilang → berpotensi merugikan, dicatat sebagai approval (Finance/Director).
  await writeAudit({
    actorId: g.actor.id, action: "finance.invoice_cancel", entityType: "ads_invoices", entityId: id,
    before: { status: "terbit" }, after: { status: "batal", reason }, type: "approval",
  });
  revalidate(id, Number(inv.request_id));
  return { ok: true, message: `Invoice ${id} dibatalkan. Nomornya tidak dipakai ulang.` };
}
