"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AdsRequestRow } from "@/lib/m10/request-data";
import { fundingNeedsCashCheck, fundingProducesInvoice } from "@/lib/m10/funding-spec";
import {
  accRequestAction,
  cancelRequestAction,
  claimRequestAction,
  decideDirectorAction,
  finishRequestAction,
  inputResultAction,
  recordCashReceivedAction,
  rejectRequestAction,
  type AdsActionResult,
} from "../actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";
const btnGreen = "rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50";
const btnRed = "rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";
const box = "rounded-lg border border-slate-200 bg-white p-4";

export interface RequestCapabilities {
  canDirector: boolean;
  /** Boleh ACC/tolak request INI (aturan per pendanaan sudah dihitung server). */
  canAcc: boolean;
  canRecordCash: boolean;
  canExecute: boolean;
  canInputResult: boolean;
  canCancel: boolean;
}

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function run(fn: (fd: FormData) => Promise<AdsActionResult>, fd: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const res = await fn(fd);
      if (res.ok) {
        if (res.message) setMessage(res.message);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }
  return { run, error, message, pending };
}

export function RequestActions({ request, caps }: { request: AdsRequestRow; caps: RequestCapabilities }) {
  const { run, error, message, pending } = useAction();
  const s = request.status;
  const ft = request.fundingType;
  const isCash = ft ? fundingNeedsCashCheck(ft, request.paymentMethod) : false;
  const isInvoice = ft ? fundingProducesInvoice(ft, request.paymentMethod) : false;

  const waitingDirector = s === "menunggu_approval_director" || s === "menunggu_approval";
  const waitingAcc = s === "menunggu_finance" || s === "diajukan";
  const ready = s === "siap_dieksekusi" || s === "baru";
  const working = s === "dikerjakan";
  const terminal = s === "selesai" || s === "ditolak" || s === "batal";

  return (
    <div className="space-y-3">
      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-md bg-green-50 p-2 text-sm text-green-700">{message}</p>}

      {waitingDirector && caps.canDirector && (
        <form action={(fd) => run(decideDirectorAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Approval Director — melebihi jatah Budget MEA</h3>
          <p className="mt-1 text-xs text-slate-500">Setujui = lanjut ke antrean ACC; tolak = request ditutup (alasan wajib).</p>
          <input name="note" placeholder="Catatan / alasan" className={`${input} mt-2 w-full`} />
          <div className="mt-2 flex gap-2">
            <button name="decision" value="approve" disabled={pending} className={btnGreen}>Setujui</button>
            <button name="decision" value="reject" disabled={pending} className={btnRed}>Tolak</button>
          </div>
        </form>
      )}

      {waitingAcc && isCash && caps.canRecordCash && !request.cashReceivedAt && (
        <form action={(fd) => run(recordCashReceivedAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Catat uang masuk (cash di awal)</h3>
          <p className="mt-1 text-xs text-slate-500">Request cash tidak bisa di-ACC sebelum tanggal uang masuk tercatat.</p>
          <div className="mt-2 flex items-end gap-2">
            <label className="text-xs text-slate-600">Tanggal uang masuk<input type="date" name="cash_received_at" required className={`${input} block`} /></label>
            <button disabled={pending} className={btn}>Simpan</button>
          </div>
        </form>
      )}

      {waitingAcc && caps.canAcc && (
        <form action={(fd) => run(accRequestAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">ACC request</h3>
          <p className="mt-1 text-xs text-slate-500">
            {isCash
              ? request.cashReceivedAt
                ? `Uang masuk tercatat ${request.cashReceivedAt}. ACC = request siap dieksekusi.`
                : "Isi tanggal uang masuk di bawah (atau lewat form di atas) — tanpa itu ACC ditolak sistem."
              : isInvoice
              ? "ACC = request siap dieksekusi DAN invoice PDF (PPN otomatis) langsung terbit atas nama pembayar."
              : "ACC = request siap dieksekusi Creator Support."}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Budget disetujui (Rp)
              <input name="budget_approved" defaultValue={request.budgetApproved ?? request.budgetRequested ?? ""} inputMode="numeric" className={`${input} block w-full`} />
            </label>
            {isCash && !request.cashReceivedAt && (
              <label className="text-xs text-slate-600">
                Tanggal uang masuk
                <input type="date" name="cash_received_at" className={`${input} block w-full`} />
              </label>
            )}
            {isInvoice && (
              <>
                <label className="text-xs text-slate-600">
                  Ditagihkan kepada
                  <input name="payer_name" defaultValue={request.payerName ?? request.creatorName ?? ""} className={`${input} block w-full`} />
                </label>
                <label className="text-xs text-slate-600">
                  Alamat / NPWP / kontak (opsional, tampil di invoice)
                  <input name="bill_to_detail" className={`${input} block w-full`} />
                </label>
              </>
            )}
            <label className="text-xs text-slate-600 sm:col-span-2">
              Catatan ACC
              <input name="note" className={`${input} block w-full`} />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={pending} className={btnGreen}>ACC</button>
          </div>
        </form>
      )}

      {waitingAcc && caps.canAcc && (
        <form action={(fd) => run(rejectRequestAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Tolak request</h3>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-600">Alasan (wajib)<input name="note" required className={`${input} block w-full`} /></label>
            <button disabled={pending} className={btnRed}>Tolak</button>
          </div>
        </form>
      )}

      {ready && caps.canExecute && (
        <form action={(fd) => run(claimRequestAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Eksekusi</h3>
          <p className="mt-1 text-xs text-slate-500">Klaim = Anda yang menjalankan ads ini; setelah itu input realisasi ads spent per periode.</p>
          <button disabled={pending} className={`${btn} mt-2`}>Klaim &amp; mulai kerjakan</button>
        </form>
      )}

      {(working || s === "baru") && caps.canInputResult && (
        <form action={(fd) => run(inputResultAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Input realisasi (ads spent = sumber tunggal biaya ads)</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <label className="text-xs text-slate-600">Periode<input type="date" name="period" required defaultValue={request.slotDate ?? request.periodStart ?? ""} className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">Ads spent (Rp)<input name="ads_spent" required inputMode="numeric" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">GMV dari ads (Rp)<input name="gmv" inputMode="numeric" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">ROAS<input name="roas" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">CPM<input name="cpm" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">CTR<input name="ctr" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">CVR<input name="cvr" className={`${input} block w-full`} /></label>
            <label className="text-xs text-slate-600">Status<select name="status" defaultValue="final" className={`${input} block w-full`}><option value="draft">draft</option><option value="final">final</option></select></label>
          </div>
          <button disabled={pending} className={`${btn} mt-2`}>Simpan realisasi</button>
        </form>
      )}

      {working && caps.canExecute && (
        <form action={(fd) => run(finishRequestAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Selesaikan request</h3>
          <p className="mt-1 text-xs text-slate-500">Butuh minimal satu baris realisasi. Setelah selesai, status terkunci.</p>
          <button disabled={pending} className={`${btnGreen} mt-2`}>Tandai selesai</button>
        </form>
      )}

      {!terminal && !working && caps.canCancel && (
        <form action={(fd) => run(cancelRequestAction, fd)} className={box}>
          <input type="hidden" name="request_id" value={request.id} />
          <h3 className="text-sm font-semibold">Batalkan request</h3>
          <div className="mt-2 flex items-end gap-2">
            <label className="flex-1 text-xs text-slate-600">Alasan (wajib)<input name="reason" required className={`${input} block w-full`} /></label>
            <button disabled={pending} className={btnRed}>Batalkan</button>
          </div>
        </form>
      )}
    </div>
  );
}
