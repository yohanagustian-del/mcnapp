"use client";

import {
  PAGE_SIZES_10_20_50_100, SortableTh, TablePagination, useTableControls, type SortConfig,
} from "@/components/table-controls";
import type { BizdevBreakdownRow, BizdevCard } from "@/lib/m8/bizdev-summary";

const rp = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const th = "px-3 py-2 whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;

/** GMV TAP: null karena Shopee (fase 1, Q4) → label, bukan 0. */
function TapCell({ value, unknownMcn }: { value: number | null; unknownMcn: number }) {
  if (value === null) return <span className="text-xs text-slate-400">GMV TAP belum tersedia untuk Shopee</span>;
  return (
    <span title={unknownMcn > 0 ? `Tidak termasuk GMV MCN ${rp(unknownMcn)} tanpa data TAP (Shopee)` : undefined}>
      {rp(value)}
    </span>
  );
}

const SORT: SortConfig<BizdevBreakdownRow> = {
  columns: {
    bizdev: { value: (r) => r.memberName },
    brand: { value: (r) => r.shopName },
    creators: { value: (r) => r.creatorCount, firstDir: "desc" },
    mcn: { value: (r) => r.gmvMcn, firstDir: "desc" },
    tap: { value: (r) => r.gmvTap, firstDir: "desc" },
    rev: { value: (r) => r.actualRevenuePartner, firstDir: "desc" },
    share: { value: (r) => r.tapShare, firstDir: "desc" },
  },
  initial: { key: "mcn", dir: "desc" },
};

export function BizdevSummary({
  cards,
  breakdown,
  periodLabel,
}: {
  cards: BizdevCard[];
  breakdown: BizdevBreakdownRow[];
  periodLabel: string;
}) {
  const controls = useTableControls<BizdevBreakdownRow>({
    rows: breakdown,
    sort: SORT,
    pageSizes: PAGE_SIZES_10_20_50_100,
    itemLabel: "brand",
    searchText: (r) => `${r.memberName} ${r.shopName}`,
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.memberId ?? "non-bd"}
            className={`rounded-lg border p-4 ${c.memberId ? "border-slate-200 bg-white" : "border-dashed border-slate-300 bg-slate-50"}`}
          >
            <p className="text-sm font-semibold text-slate-800">{c.memberName}</p>
            <p className="text-xs text-slate-500">{c.brandCount} brand dihandle · {periodLabel}</p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <dt className="text-slate-500">GMV MCN</dt>
              <dd className="text-right font-medium tabular-nums">{rp(c.gmvMcn)}</dd>
              <dt className="text-slate-500">GMV TAP</dt>
              <dd className="text-right font-medium tabular-nums">
                <TapCell value={c.gmvTap} unknownMcn={c.gmvMcnTapUnknown} />
              </dd>
              <dt className="text-slate-500">Actual Revenue Partner</dt>
              <dd className="text-right font-medium tabular-nums">{rp(c.actualRevenuePartner)}</dd>
              <dt className="text-slate-500">% TAP / MCN</dt>
              <dd className="text-right font-medium tabular-nums">{pct(c.tapShare)}</dd>
            </dl>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        Brand yang dihandle 2 BizDev dihitung <strong>penuh di keduanya</strong> (tidak dibagi dua), jadi total
        kartu bisa melebihi GMV seluruh brand. % TAP/MCN hanya dari brand yang data TAP-nya tersedia (TikTok);
        GMV MCN Shopee tetap terhitung di GMV MCN.
      </p>

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-2">
          <input
            type="search"
            value={controls.search}
            onChange={(e) => controls.setSearch(e.target.value)}
            placeholder="Cari BizDev / brand…"
            className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="bizdev" className={th}>BizDev</SortableTh>
                <SortableTh controls={controls} sortKey="brand" className={th}>Brand</SortableTh>
                <th className={th}>Platform</th>
                <SortableTh controls={controls} sortKey="creators" className={th}>Kreator</SortableTh>
                <SortableTh controls={controls} sortKey="mcn" className={th}>GMV MCN</SortableTh>
                <SortableTh controls={controls} sortKey="tap" className={th}>GMV TAP</SortableTh>
                <SortableTh controls={controls} sortKey="rev" className={th}>Actual Revenue Partner</SortableTh>
                <SortableTh controls={controls} sortKey="share" className={th}>% TAP/MCN</SortableTh>
                <th className={th}>Periode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50">
                  <td className={`${td} ${r.memberId ? "" : "text-slate-500"}`}>{r.memberName}</td>
                  <td className={`${td} max-w-[16rem] truncate font-medium`} title={r.shopKey}>{r.shopName}</td>
                  <td className={td}>{r.platform}</td>
                  <td className={tdNum} title={`${r.creatorTapCount} kreator memakai TAP`}>
                    {r.creatorCount.toLocaleString("id-ID")}
                  </td>
                  <td className={tdNum}>{rp(r.gmvMcn)}</td>
                  <td className={tdNum}><TapCell value={r.gmvTap} unknownMcn={r.gmvMcnTapUnknown} /></td>
                  <td className={tdNum}>{rp(r.actualRevenuePartner)}</td>
                  <td className={tdNum}>{pct(r.tapShare)}</td>
                  <td className={td}>{periodLabel}</td>
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-400">Tidak ada brand.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </div>
  );
}
