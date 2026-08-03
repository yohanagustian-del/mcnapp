"use client";

import { useMemo, useState } from "react";
import { rupiah, pct, rupiahRingkas } from "@/lib/utils/format";

const WEEK_LABELS = ["W1", "W2", "W3", "W4", "W5"] as const;

/**
 * Satu baris tabel "Growth Mingguan per CM" — sudah diagregasi di server
 * (aggregateWeeklyByGroup). Komponen ini hanya menampilkan + mengurutkan;
 * tidak menghitung ulang growth (CLAUDE.md #4).
 */
export interface CmWeeklyGrowthRow {
  cpmId: string | null;
  cmName: string;
  /** Jumlah kreator milik CM ini yang punya data minggu di bulan terpilih. */
  creatorCount: number;
  /** GMV total seluruh kreatornya per minggu W1..W5; null = tidak ada upload. */
  weeks: (number | null)[];
  /** % perubahan vs minggu terisi sebelumnya, index-aligned dengan `weeks`. */
  deltas: (number | null)[];
  monthTotal: number;
  monthGrowthPct: number | null;
}

/** Trend arrow vs minggu terisi sebelumnya — sama seperti tabel per-kreator. */
function TrendCell({ value, delta }: { value: number | null; delta: number | null }) {
  if (value === null) return <span className="text-slate-300">—</span>;
  let arrow = <span className="text-slate-400">−</span>;
  if (delta !== null && delta > 0) arrow = <span className="text-green-600">▲</span>;
  else if (delta !== null && delta < 0) arrow = <span className="text-red-600">▼</span>;
  return (
    <span>
      {rupiahRingkas(value)} {arrow}
    </span>
  );
}

type SortKey = "cm" | "creators" | "total" | "growth";

/**
 * Growth Mingguan per CM — rollup tabel Pertumbuhan GMV Mingguan ke level CM,
 * supaya Lead/management bisa melihat tim mana yang naik/turun tanpa memindai
 * ratusan baris kreator.
 *
 * Daftar CM pendek (satu digit s/d belasan), jadi tidak perlu search/paginasi —
 * cukup klik header untuk mengurutkan. Baris "Tanpa CM" sengaja ditampilkan:
 * GMV yang tidak terhitung ke tim mana pun justru yang paling perlu terlihat.
 */
export function CmWeeklyGrowthTable({ rows }: { rows: CmWeeklyGrowthRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total",
    dir: "desc",
  });

  const toggle = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "cm" ? "asc" : "desc" }
    );

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (r: CmWeeklyGrowthRow): string | number | null => {
      if (sort.key === "cm") return r.cmName;
      if (sort.key === "creators") return r.creatorCount;
      if (sort.key === "growth") return r.monthGrowthPct;
      return r.monthTotal;
    };
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      // Growth null (CM dengan <2 minggu terisi) selalu di bawah, tidak ikut dibalik.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "id");
      return cmp * dir;
    });
  }, [rows, sort]);

  const totals = useMemo(() => {
    const weeks: (number | null)[] = new Array(5).fill(null);
    let grand = 0;
    let creators = 0;
    for (const r of rows) {
      grand += r.monthTotal;
      creators += r.creatorCount;
      for (let i = 0; i < 5; i++) {
        if (r.weeks[i] !== null) weeks[i] = (weeks[i] ?? 0) + (r.weeks[i] as number);
      }
    }
    const deltas: (number | null)[] = new Array(5).fill(null);
    let lastFilled: number | null = null;
    for (let i = 0; i < 5; i++) {
      if (weeks[i] === null) continue;
      if (lastFilled !== null) {
        const prev = weeks[lastFilled] as number;
        deltas[i] = prev !== 0 ? ((weeks[i] as number) - prev) / prev : null;
      }
      lastFilled = i;
    }
    return { weeks, deltas, grand, creators };
  }, [rows]);

  const SortTh = ({ label, sortKey }: { label: string; sortKey: SortKey }) => {
    const active = sort.key === sortKey;
    return (
      <th
        className="px-4 py-3"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          onClick={() => toggle(sortKey)}
          className={`flex items-center gap-1 uppercase hover:text-slate-800 ${active ? "text-slate-800" : ""}`}
        >
          {label}
          <span aria-hidden className={`text-[10px] ${active ? "text-slate-700" : "text-slate-300"}`}>
            {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortTh label="CM" sortKey="cm" />
              <SortTh label="Kreator" sortKey="creators" />
              {WEEK_LABELS.map((w) => (
                <th key={w} className="px-4 py-3">{w}</th>
              ))}
              <SortTh label="Total Bulan" sortKey="total" />
              <SortTh label="Growth" sortKey="growth" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r) => (
              <tr key={r.cpmId ?? "tanpa-cm"} className={r.cpmId ? undefined : "bg-amber-50/60"}>
                <td className="px-4 py-2 font-medium">
                  {r.cmName}
                  {!r.cpmId && (
                    <span className="ml-1 text-xs font-normal text-amber-700">
                      (belum ditugaskan)
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-600">{r.creatorCount}</td>
                {WEEK_LABELS.map((_, i) => (
                  <td key={i} className="px-4 py-2">
                    <TrendCell value={r.weeks[i]} delta={r.deltas[i]} />
                  </td>
                ))}
                <td className="px-4 py-2 font-medium">{rupiah(r.monthTotal)}</td>
                <td
                  className={`px-4 py-2 ${
                    r.monthGrowthPct !== null && r.monthGrowthPct < 0 ? "text-red-600" : "text-green-700"
                  }`}
                >
                  {pct(r.monthGrowthPct)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  Belum ada data GMV mingguan untuk bulan ini di scope Anda.
                </td>
              </tr>
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold">
              <tr>
                <td className="px-4 py-2">TOTAL</td>
                <td className="px-4 py-2">{totals.creators}</td>
                {WEEK_LABELS.map((_, i) => (
                  <td key={i} className="px-4 py-2">
                    <TrendCell value={totals.weeks[i]} delta={totals.deltas[i]} />
                  </td>
                ))}
                <td className="px-4 py-2">{rupiah(totals.grand)}</td>
                <td className="px-4 py-2">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
