"use client";

import { useMemo, useState } from "react";
import { successRate } from "@/lib/m8/routing";
import { APPROACH_DATE_STAGES, type ExternalApproachRow } from "@/lib/workspace/external-approach";

const cardCls = "rounded-lg border border-slate-200 bg-white p-4";
const labelCls = "text-xs uppercase text-slate-500";
const valueCls = "mt-1 text-2xl font-semibold";
const dateInputCls = "mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm";
const selectCls = "mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm";

/** `scouting_date` di APPROACH_DATE_STAGES adalah nama tahap; kolom DB-nya tetap `approach_date`. */
function stageDate(row: ExternalApproachRow, field: string): string | null {
  return field === "scouting_date" ? row.approach_date : (row[field as keyof ExternalApproachRow] as string | null);
}

/** §2D.1 pipeline funnel: satu scorecard per tahap + conversion using TAP / reachout. */
export function ApproachScorecards({ rows }: { rows: ExternalApproachRow[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [inputBy, setInputBy] = useState("");

  const inputByOptions = useMemo(
    () => [...new Set(rows.map((r) => r.approached_by_name).filter((n): n is string => !!n))].sort(),
    [rows]
  );

  const byPerson = useMemo(
    () => (inputBy ? rows.filter((r) => r.approached_by_name === inputBy) : rows),
    [rows, inputBy]
  );

  // Setiap tahap dihitung dari TANGGAL TAHAPNYA SENDIRI, bukan tanggal Scouting —
  // baris yang scouting-nya Agustus tapi reachout-nya September hanya masuk hitungan
  // Reachout saat filter tanggal mencakup September, bukan Agustus (lihat contoh di PR).
  const inRange = (dateStr: string | null) => {
    if (!dateStr) return false;
    if (from && dateStr < from) return false;
    if (to && dateStr > to) return false;
    return true;
  };

  const counts = Object.fromEntries(
    APPROACH_DATE_STAGES.map((stage) => [stage.field, byPerson.filter((r) => inRange(stageDate(r, stage.field))).length])
  ) as Record<(typeof APPROACH_DATE_STAGES)[number]["field"], number>;

  const conversion = successRate(counts.reachout_date, counts.using_tap_date);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Dari tanggal</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateInputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Sampai tanggal</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateInputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Diinput oleh</span>
          <select value={inputBy} onChange={(e) => setInputBy(e.target.value)} className={selectCls}>
            <option value="">Semua</option>
            {inputByOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        {(from || to || inputBy) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              setInputBy("");
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Reset filter
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Filter tanggal berlaku per tahap: satu baris dihitung di tahap tertentu kalau tanggal tahap
        itu sendiri masuk rentang yang dipilih (bukan tanggal Scouting-nya).
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        {APPROACH_DATE_STAGES.map((stage) => (
          <div key={stage.field} className={cardCls}>
            <p className={labelCls}>{stage.label}</p>
            <p className={valueCls}>{counts[stage.field]}</p>
          </div>
        ))}
        <div className={cardCls}>
          <p className={labelCls}>Conversion</p>
          <p className={valueCls}>{conversion === null ? "—" : `${(conversion * 100).toFixed(0)}%`}</p>
          <p className="text-sm text-slate-500">Using TAP / Reachout</p>
        </div>
      </div>
    </section>
  );
}
