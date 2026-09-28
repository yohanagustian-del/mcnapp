"use client";

import { useMemo, useState } from "react";
import { daysInMonth } from "@/lib/utils/date";

/**
 * PLAN_MSDPS_mcnapp.md Paket C (R4): filter periode Report Kreator ala TikTok Shop
 * Seller Center — Weekly (pilih bulan → jendela W1-W5), Monthly (pilih bulan),
 * Custom (rentang tanggal, dibulatkan ke jendela W1-W5 utuh terdekat).
 *
 * Render tiga input HIDDEN (period_type/period_start/period_end) di dalam <form>
 * pembungkusnya (GenerateReportForm) — UI di atas hanya mengatur nilainya, submit
 * tetap lewat form action biasa. Tidak menandai jendela "belum ada data" (butuh
 * query per-kreator reaktif, di luar cakupan efisiensi sesi ini) — hanya
 * kalender murni W1-W5, sejalan dengan skema upload mingguan (CLAUDE.md).
 */

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const WEEK_STARTS = [1, 8, 15, 22, 29] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
function addDaysIso(isoStr: string, days: number): string {
  const d = new Date(`${isoStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Awal bulan (y,m) + `delta` bulan, sebagai ISO — pakai Date object supaya rollover tahun benar. */
function monthStartIso(y: number, m: number, delta = 0): string {
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}
/** Jendela W1-W5 (real, capped ke akhir bulan) yang mengandung tanggal `d` di bulan (y,m). */
function weekWindow(y: number, m: number, d: number): { w: number; start: number; end: number } {
  const last = daysInMonth(y, m);
  if (d <= 7) return { w: 1, start: 1, end: 7 };
  if (d <= 14) return { w: 2, start: 8, end: 14 };
  if (d <= 21) return { w: 3, start: 15, end: 21 };
  if (d <= 28) return { w: 4, start: 22, end: 28 };
  return { w: 5, start: 29, end: last };
}
function thisMonthIso(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`;
}

type Tab = "weekly" | "monthly" | "custom";

export function ReportPeriodPicker() {
  const [tab, setTab] = useState<Tab>("weekly");
  const [month, setMonth] = useState(thisMonthIso()); // "YYYY-MM", dipakai weekly & monthly
  const [weekIdx, setWeekIdx] = useState(0); // index ke WEEK_STARTS, dipakai weekly
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [y, m] = month.split("-").map(Number);
  const lastDay = daysInMonth(y, m);
  const windows = WEEK_STARTS.filter((s) => s <= lastDay).map((s) => {
    const w = weekWindow(y, m, s);
    return { ...w, startIso: iso(y, m, w.start), endLabel: `${w.start}–${w.end} ${BULAN[m - 1]} ${y}` };
  });

  const picked = useMemo(() => {
    if (tab === "monthly") {
      return { period_type: "monthly", period_start: monthStartIso(y, m), period_end: monthStartIso(y, m, 1) };
    }
    if (tab === "weekly") {
      const w = windows[Math.min(weekIdx, windows.length - 1)];
      if (!w) return null;
      return { period_type: "weekly", period_start: w.startIso, period_end: addDaysIso(iso(y, m, w.end), 1) };
    }
    // custom: bulatkan input user ke jendela W1-W5 pembungkusnya.
    if (!customStart || !customEnd) return null;
    const [sy, sm, sd] = customStart.split("-").map(Number);
    const [ey, em, ed] = customEnd.split("-").map(Number);
    const startW = weekWindow(sy, sm, sd);
    const endW = weekWindow(ey, em, ed);
    return {
      period_type: "custom",
      period_start: iso(sy, sm, startW.start),
      period_end: addDaysIso(iso(ey, em, endW.end), 1),
    };
  }, [tab, y, m, weekIdx, windows, customStart, customEnd]);

  const TAB_BTN = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        tab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
      <div className="flex gap-2">
        {TAB_BTN("weekly", "Weekly")}
        {TAB_BTN("monthly", "Monthly")}
        {TAB_BTN("custom", "Custom")}
      </div>

      {(tab === "weekly" || tab === "monthly") && (
        <input
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setWeekIdx(0);
          }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      )}

      {tab === "weekly" && (
        <div className="flex flex-wrap gap-1">
          {windows.map((w, i) => (
            <button
              key={w.w}
              type="button"
              onClick={() => setWeekIdx(i)}
              className={`rounded-md border px-2 py-1 text-xs ${
                i === weekIdx ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"
              }`}
            >
              W{w.w} · {w.endLabel}
            </button>
          ))}
        </div>
      )}

      {tab === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <span className="text-xs text-slate-400">s/d</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
      )}

      {picked && (
        <p className="text-xs text-slate-500">
          Data dihitung: {picked.period_start} – {addDaysIso(picked.period_end, -1)}
          {tab === "custom" && " (dibulatkan ke jendela mingguan W1-W5 terdekat)"}
        </p>
      )}

      <input type="hidden" name="period_type" value={picked?.period_type ?? "weekly"} />
      <input type="hidden" name="period_start" value={picked?.period_start ?? ""} />
      <input type="hidden" name="period_end" value={picked?.period_end ?? ""} />
    </div>
  );
}
