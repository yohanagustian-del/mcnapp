"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelInvoiceAction, markInvoiceSentAction, recordInvoicePaymentAction, type FinanceActionResult } from "../../actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnGreen = "rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50";
const btnRed = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";
const box = "rounded-lg border border-slate-200 bg-white p-4";

export function InvoiceActions({ invoiceId, total, status, billToName }: { invoiceId: string; total: number; status: string; billToName: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(fn: (fd: FormData) => Promise<FinanceActionResult>, fd: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await fn(fd);
      if (res.ok) { setMessage(res.message ?? "Tersimpan."); router.refresh(); }
      else setError(res.error);
    });
  }

  const tagihanText = `Halo ${billToName}, berikut invoice ${invoiceId} dari MCN MEA sebesar Rp${Math.round(total).toLocaleString("id-ID")} (sudah termasuk PPN). Mohon konfirmasi pembayarannya. Terima kasih.`;

  if (status !== "terbit") {
    return <p className="text-sm text-slate-500">Invoice {status === "lunas" ? "sudah lunas" : "dibatalkan"} — tidak ada aksi.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-md bg-green-50 p-2 text-sm text-green-700">{message}</p>}

      <form action={(fd) => run(recordInvoicePaymentAction, fd)} className={box}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <h3 className="text-sm font-semibold">Catat pembayaran</h3>
        <p className="mt-1 text-xs text-slate-500">Invoice ditandai lunas hanya bila dibayar penuh (total {`Rp${Math.round(total).toLocaleString("id-ID")}`}).</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-600">Tanggal bayar<input type="date" name="paid_at" required className={`${input} block w-full`} /></label>
          <label className="text-xs text-slate-600">Nominal (Rp)<input name="paid_amount" required inputMode="numeric" defaultValue={Math.round(total)} className={`${input} block w-full`} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Bukti (link)<input name="proof_url" placeholder="https://…" className={`${input} block w-full`} /></label>
          <label className="text-xs text-slate-600 sm:col-span-2">Catatan<input name="note" className={`${input} block w-full`} /></label>
        </div>
        <button disabled={pending} className={`${btnGreen} mt-2`}>Tandai lunas</button>
      </form>

      <form action={(fd) => run(markInvoiceSentAction, fd)} className={box}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <h3 className="text-sm font-semibold">Kirim tagihan (manual via WA/email)</h3>
        <textarea readOnly value={tagihanText} rows={3} className={`${input} mt-2 w-full text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <div className="mt-2 flex items-center gap-2">
          <select name="channel" className={input}><option value="wa">WhatsApp</option><option value="email">Email</option></select>
          <button disabled={pending} className={btn}>Catat sudah dikirim</button>
        </div>
      </form>

      <form action={(fd) => run(cancelInvoiceAction, fd)} className={box}>
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <h3 className="text-sm font-semibold">Batalkan invoice</h3>
        <p className="mt-1 text-xs text-slate-500">Nomor tidak dipakai ulang. Request-nya tetap di-ACC — buat invoice baru lewat ACC ulang bila perlu.</p>
        <div className="mt-2 flex items-end gap-2">
          <label className="flex-1 text-xs text-slate-600">Alasan (wajib)<input name="reason" required className={`${input} block w-full`} /></label>
          <button disabled={pending} className={btnRed}>Batalkan</button>
        </div>
      </form>
    </div>
  );
}
