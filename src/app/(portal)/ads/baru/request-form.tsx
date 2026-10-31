"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  FUNDING_LABELS,
  FUNDING_TYPES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  fundingNeedsPaymentMethod,
  type FundingType,
  type PaymentMethod,
} from "@/lib/m10/funding-spec";
import { createAdsRequestAction } from "../actions";

const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600";
const btn = "rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50";

export interface ProjectOption { id: number; name: string; status: string; startDate: string | null; endDate: string | null }
export interface ParticipantOption { id: string; name: string; username: string | null }

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

export function RequestForm({
  slot,
  projects,
  selectedProjectId,
  participants,
  preselectedCreatorId,
  legacyFunding,
  legacyNote,
  meaHint,
}: {
  slot: { id: number; creatorId: string; creatorName: string; date: string; brand: string | null } | null;
  projects: ProjectOption[];
  selectedProjectId: number | null;
  participants: ParticipantOption[];
  preselectedCreatorId: string | null;
  legacyFunding: { fundingType: FundingType; paymentMethod: PaymentMethod | null } | null;
  legacyNote: string | null;
  meaHint: { month: string; budget: number; used: number; remaining: number } | null;
}) {
  const router = useRouter();
  const [funding, setFunding] = useState<FundingType | "">(legacyFunding?.fundingType ?? "");
  const [payment, setPayment] = useState<PaymentMethod | "">(legacyFunding?.paymentMethod ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const needsPayment = funding !== "" && fundingNeedsPaymentMethod(funding);

  function onProjectChange(id: string) {
    // Peserta dimuat server-side per project → navigasi ulang dengan query.
    router.replace(id ? `/ads/baru?project_id=${id}` : "/ads/baru");
  }

  function onSubmit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createAdsRequestAction(fd);
      if (res.ok) {
        router.push(`/ads/${res.id}${res.message ? `?msg=${encodeURIComponent(res.message)}` : ""}`);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {slot ? (
        <>
          <input type="hidden" name="schedule_slot_id" value={slot.id} />
          <input type="hidden" name="creator_id" value={slot.creatorId} />
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Special Project</label>
            <select
              name="project_id"
              required
              defaultValue={selectedProjectId ?? ""}
              onChange={(e) => onProjectChange(e.target.value)}
              className={input}
            >
              <option value="">— pilih project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.status}, {p.startDate ?? "?"} → {p.endDate ?? "?"})</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Kreator peserta {funding === "mea_budget" ? "(wajib untuk Budget MEA)" : "(opsional)"}</label>
            <select name="creator_id" defaultValue={preselectedCreatorId ?? ""} className={input} disabled={!selectedProjectId}>
              <option value="">— seluruh project —</option>
              {participants.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.username ? ` (@${c.username})` : ""}</option>
              ))}
            </select>
            {selectedProjectId && participants.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">Project ini belum punya peserta dalam scope Anda.</p>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Tipe pendanaan</label>
          <select
            name="funding_type"
            required
            value={funding}
            onChange={(e) => { setFunding(e.target.value as FundingType | ""); setPayment(""); }}
            className={input}
          >
            <option value="">— pilih —</option>
            {FUNDING_TYPES.map((ft) => <option key={ft} value={ft}>{FUNDING_LABELS[ft]}</option>)}
          </select>
          {legacyFunding && (
            <p className="mt-1 text-xs text-slate-500">Diisi dari "Pembayar ads" lama di slot{legacyNote ? `: ${legacyNote}` : ""}.</p>
          )}
        </div>
        {needsPayment && (
          <div>
            <label className={label}>Metode pembayaran</label>
            <select name="payment_method" required value={payment} onChange={(e) => setPayment(e.target.value as PaymentMethod | "")} className={input}>
              <option value="">— pilih —</option>
              {PAYMENT_METHODS.map((pm) => <option key={pm} value={pm}>{PAYMENT_METHOD_LABELS[pm]}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              {payment === "cash_upfront"
                ? "Finance mengecek uang masuk dulu sebelum request di-ACC."
                : payment === "invoice"
                ? "Invoice (PDF, PPN otomatis) terbit saat di-ACC Head CM/Finance; eksekusi boleh jalan sebelum lunas."
                : ""}
            </p>
          </div>
        )}
      </div>

      {funding === "mea_budget" && meaHint && (
        <p className={`rounded-md p-2 text-xs ${meaHint.remaining > 0 ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          Jatah Budget MEA {meaHint.month.slice(0, 7)}: {rupiah(meaHint.budget)} · terpakai {rupiah(meaHint.used)} · sisa{" "}
          <strong>{rupiah(meaHint.remaining)}</strong>. Request melebihi sisa → butuh approval Director dulu.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Nominal budget ads (Rp)</label>
          <input name="budget_requested" required inputMode="numeric" placeholder="mis. 500.000" className={input} />
        </div>
        {needsPayment && (
          <div>
            <label className={label}>{funding === "brand_budget" ? "Nama brand yang membayar" : "Nama kreator yang membayar"}</label>
            <input name="payer_name" required defaultValue={slot && funding === "creator_budget" ? slot.creatorName : slot?.brand ?? ""} className={input} />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Objektif / produk yang di-ads</label>
          <input name="objective" defaultValue={slot?.brand ? `Live ${slot.brand}` : ""} className={input} />
        </div>
        <div>
          <label className={label}>Catatan untuk executor</label>
          <input name="notes" placeholder="mis. jam ads, target, link produk" className={input} />
        </div>
      </div>

      {!slot && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Periode ads mulai</label>
            <input type="date" name="period_start" className={input} />
          </div>
          <div>
            <label className={label}>Periode ads selesai</label>
            <input type="date" name="period_end" className={input} />
          </div>
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={btn}>{pending ? "Mengirim…" : "Ajukan Request Ads"}</button>
        <span className="text-xs text-slate-500">
          Setelah diajukan: {funding === "mea_budget" ? "cek jatah MEA → " : ""}ACC {payment === "cash_upfront" ? "Finance" : "Head CM / Finance"} → Creator Support mengeksekusi.
        </span>
      </div>
    </form>
  );
}
