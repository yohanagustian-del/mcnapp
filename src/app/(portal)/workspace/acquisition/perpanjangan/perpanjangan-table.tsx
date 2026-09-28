"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { renewContractAction } from "./actions";

export interface PerpanjanganRow {
  id: string;
  name: string;
  username: string | null;
  cmName: string | null;
  joinDate: string | null;
  contractEndDate: string | null;
  days: number | null;
  priorPeriods: number;
}

const input = "rounded-md border border-slate-300 px-2 py-1 text-xs";
const btn = "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50";

type Bucket = "semua" | "habis" | "d30" | "d60";

function matchesBucket(days: number | null, bucket: Bucket): boolean {
  if (bucket === "semua") return true;
  if (days === null) return false;
  if (bucket === "habis") return days < 0;
  if (bucket === "d30") return days <= 30;
  return days <= 60; // d60
}

function daysLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `habis ${-days} hr lalu`;
  return `${days} hari`;
}

function RenewForm({ row, onDone }: { row: PerpanjanganRow; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const defaultStart = row.contractEndDate
    ? new Date(new Date(row.contractEndDate).getTime() + 86_400_000).toISOString().slice(0, 10)
    : "";

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await renewContractAction(formData);
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <form action={onSubmit} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="creator_id" value={row.id} />
        <label className="text-[11px] text-slate-500">
          Mulai
          <input type="date" name="start_date" required defaultValue={defaultStart} className={`${input} block`} />
        </label>
        <label className="text-[11px] text-slate-500">
          Akhir Baru
          <input type="date" name="end_date" required className={`${input} block`} />
        </label>
        <label className="text-[11px] text-slate-500">
          Catatan (opsional)
          <input type="text" name="notes" className={`${input} block w-48`} />
        </label>
        <button type="submit" disabled={pending} className={btn}>
          {pending ? "..." : "Simpan Perpanjangan"}
        </button>
      </form>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

export function PerpanjanganTable({ rows }: { rows: PerpanjanganRow[] }) {
  const [bucket, setBucket] = useState<Bucket>("semua");
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => rows.filter((r) => matchesBucket(r.days, bucket)).sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity)),
    [rows, bucket]
  );

  const counts = useMemo(
    () => ({
      semua: rows.length,
      habis: rows.filter((r) => matchesBucket(r.days, "habis")).length,
      d30: rows.filter((r) => matchesBucket(r.days, "d30")).length,
      d60: rows.filter((r) => matchesBucket(r.days, "d60")).length,
    }),
    [rows]
  );

  const TABS: { key: Bucket; label: string }[] = [
    { key: "habis", label: "Sudah Habis" },
    { key: "d30", label: "≤30 Hari" },
    { key: "d60", label: "≤60 Hari" },
    { key: "semua", label: "Semua" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setBucket(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              bucket === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2">CM</th>
              <th className="px-3 py-2">Join Date</th>
              <th className="px-3 py-2">Akhir Kontrak</th>
              <th className="px-3 py-2">Sisa</th>
              <th className="px-3 py-2">Perpanjangan Sebelumnya</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr className={r.days !== null && r.days < 0 ? "bg-red-50/40" : undefined}>
                  <td className="px-3 py-2 font-medium">
                    {r.name}
                    {r.username && <span className="ml-1 text-slate-400">@{r.username}</span>}
                  </td>
                  <td className="px-3 py-2">{r.cmName ?? "—"}</td>
                  <td className="px-3 py-2">{r.joinDate ?? "—"}</td>
                  <td className="px-3 py-2">{r.contractEndDate ?? "—"}</td>
                  <td className={`px-3 py-2 ${r.days !== null && r.days < 0 ? "font-medium text-red-600" : ""}`}>
                    {daysLabel(r.days)}
                  </td>
                  <td className="px-3 py-2">{r.priorPeriods}x</td>
                  <td className="px-3 py-2">
                    {!refreshedIds.has(r.id) && (
                      <button
                        onClick={() => setOpenId(openId === r.id ? null : r.id)}
                        className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium hover:bg-slate-200"
                      >
                        {openId === r.id ? "Tutup" : "Perpanjang"}
                      </button>
                    )}
                    {refreshedIds.has(r.id) && <span className="text-xs text-emerald-700">✓ diperpanjang</span>}
                  </td>
                </tr>
                {openId === r.id && (
                  <tr>
                    <td colSpan={7} className="px-3 pb-3">
                      <RenewForm
                        row={r}
                        onDone={() => {
                          setOpenId(null);
                          setRefreshedIds((prev) => new Set(prev).add(r.id));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-slate-400">
                  Tidak ada kreator pada filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
