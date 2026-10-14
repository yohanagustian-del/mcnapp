"use client";

import {
  PAGE_SIZES_10_20_50_100, SortableTh, TablePagination, useTableControls, type SortConfig,
} from "@/components/table-controls";
import { TAP_STATUS_LABEL, tapMatchCsv, type MatchCreatorRow, type TapMatchResult } from "@/lib/m8/tap-matchmaking";

const rp = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(0)}%`);
const th = "px-3 py-2 whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;

const LEFT_SORT: SortConfig<MatchCreatorRow> = {
  columns: {
    name: { value: (r) => r.name },
    tap: { value: (r) => r.gmvTap, firstDir: "desc" },
    mcn: { value: (r) => r.gmvMcn, firstDir: "desc" },
    gap: { value: (r) => r.gap, firstDir: "desc" },
    cm: { value: (r) => r.cmName },
  },
  initial: { key: "tap", dir: "desc" },
};
const RIGHT_SORT: SortConfig<MatchCreatorRow> = {
  columns: {
    name: { value: (r) => r.username ?? r.name },
    mcn: { value: (r) => r.gmvMcn, firstDir: "desc" },
    status: { value: (r) => TAP_STATUS_LABEL[r.status] },
    cm: { value: (r) => r.cmName },
  },
  initial: { key: "mcn", dir: "desc" },
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function TapMatchResultView({ result, fileName }: { result: TapMatchResult; fileName: string }) {
  const left = useTableControls<MatchCreatorRow>({
    rows: result.tapCreators, sort: LEFT_SORT, pageSizes: PAGE_SIZES_10_20_50_100, itemLabel: "kreator",
  });
  const right = useTableControls<MatchCreatorRow>({
    rows: result.allCreators, sort: RIGHT_SORT, pageSizes: PAGE_SIZES_10_20_50_100, itemLabel: "kreator",
    searchText: (r) => `${r.name} ${r.username ?? ""} ${r.cmName}`,
  });

  function exportCsv() {
    const blob = new Blob(["﻿" + tapMatchCsv(result)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Creator (pakai TAP)" value={result.tapKnown ? String(result.header.totalCreatorTap) : "—"} />
        <Stat
          label="Total GMV TAP"
          value={result.header.totalGmvTap === null ? "Belum tersedia" : rp(result.header.totalGmvTap)}
        />
        <Stat label="GMV MCN kreator pemakai TAP" value={result.tapKnown ? rp(result.header.totalGmvMcnTapUsers) : "—"} />
        <Stat label={`GMV semua kreator (${result.header.totalCreators})`} value={rp(result.header.totalGmvAllCreators)} />
      </div>
      {!result.tapKnown && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          GMV TAP belum tersedia untuk {result.platform === "shopee" ? "Shopee" : "periode ini"} — yang tampil hanya GMV
          MCN kreator di shop ini.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Ekspor CSV
        </button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Kreator pakai TAP</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <SortableTh controls={left} sortKey="name" className={th}>Kreator</SortableTh>
                  <SortableTh controls={left} sortKey="tap" className={th}>GMV TAP</SortableTh>
                  <SortableTh controls={left} sortKey="mcn" className={th}>GMV MCN</SortableTh>
                  <SortableTh controls={left} sortKey="gap" className={th}>GAP</SortableTh>
                  <SortableTh controls={left} sortKey="cm" className={th}>CM</SortableTh>
                  <th className={th}>Live / Video</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {left.visibleRows.map((c) => (
                  <tr key={c.creatorId ?? "__no_creator__"}>
                    <td className={`${td} font-medium`}>{c.username ? `@${c.username}` : c.name}</td>
                    <td className={tdNum}>{rp(c.gmvTap)}</td>
                    <td className={tdNum}>{rp(c.gmvMcn)}</td>
                    <td className={tdNum} title="GMV MCN − GMV TAP: GMV kreator di shop ini yang tidak lewat link agency">
                      {rp(c.gap)}
                    </td>
                    <td className={td}>{c.cmName}</td>
                    <td className={td}>{pct(c.livePct)} / {pct(c.videoPct)}</td>
                  </tr>
                ))}
                {left.visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      {result.tapKnown ? "Belum ada kreator yang memakai TAP di shop ini." : "Data TAP belum tersedia."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <TablePagination controls={left} />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold">Semua kreator di shop</h2>
            <input
              type="search"
              value={right.search}
              onChange={(e) => right.setSearch(e.target.value)}
              placeholder="Cari kreator / CM…"
              className="w-48 rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <SortableTh controls={right} sortKey="name" className={th}>Username</SortableTh>
                  <SortableTh controls={right} sortKey="mcn" className={th}>GMV</SortableTh>
                  <SortableTh controls={right} sortKey="status" className={th}>Status</SortableTh>
                  <SortableTh controls={right} sortKey="cm" className={th}>CM</SortableTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {right.visibleRows.map((c) => (
                  <tr key={c.creatorId ?? "__no_creator__"}>
                    <td className={`${td} font-medium`}>{c.username ? `@${c.username}` : c.name}</td>
                    <td className={tdNum}>{rp(c.gmvMcn)}</td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          c.status === "tap"
                            ? "bg-green-100 text-green-800"
                            : c.status === "no_tap"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {TAP_STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className={td}>{c.cmName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TablePagination controls={right} />
        </section>
      </div>
    </div>
  );
}
