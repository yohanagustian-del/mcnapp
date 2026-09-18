"use client";

import { useMemo, useState } from "react";
import { successRate } from "@/lib/m8/routing";
import { APPROACH_DATE_STAGES, type ExternalApproachRow } from "@/lib/workspace/external-approach";

const cardCls = "rounded-lg border border-slate-200 bg-white p-4";
const labelCls = "text-xs uppercase text-slate-500";
const valueCls = "mt-1 text-2xl font-semibold";
const dateInputCls = "mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm";

/** §2D.1 pipeline funnel: satu scorecard per tahap + conversion using TAP / reachout. */
export function ApproachScorecards({ rows }: { rows: ExternalApproachRow[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Filter berdasar tanggal Scouting (approach_date) — anchor date tiap baris.
  const filtered = useMemo(() => {
    if (!from && !to) return rows;
    return rows.filter((r) => {
      if (!r.approach_date) return false;
      if (from && r.approach_date < from) return false;
      if (to && r.approach_date > to) return false;
      return true;
    });
  }, [rows, from, to]);

  const counts = {
    scouting_date: filtered.filter((r) => r.approach_date).length,
    reachout_date: filtered.filter((r) => r.reachout_date).length,
    respon_date: filtered.filter((r) => r.respon_date).length,
    follow_up_1_date: filtered.filter((r) => r.follow_up_1_date).length,
    follow_up_2_date: filtered.filter((r) => r.follow_up_2_date).length,
    follow_up_3_date: filtered.filter((r) => r.follow_up_3_date).length,
    using_tap_date: filtered.filter((r) => r.using_tap_date).length,
  };
  const conversion = successRate(counts.reachout_date, counts.using_tap_date);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Dari tanggal (Scouting)</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateInputCls} />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Sampai tanggal</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateInputCls} />
        </label>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Reset filter
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {APPROACH_DATE_STAGES.map((stage) => (
          <div key={stage.field} className={cardCls}>
            <p className={labelCls}>{stage.label}</p>
            <p className={valueCls}>{counts[stage.field as keyof typeof counts]}</p>
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
