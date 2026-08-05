"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { ProjectRequirement } from "@/lib/m7/requirements";
import { rupiah } from "@/lib/utils/format";
import {
  PAGE_SIZE_10, SortableTh, TableFilterBar, TablePagination, useTableControls,
  type FacetDef, type SortConfig,
} from "@/components/table-controls";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  aktif: "bg-green-100 text-green-800",
};

/** Search mencakup nama DAN tipe project. */
const searchNameOrType = (p: ProjectRequirement) => `${p.name} ${p.type ?? ""}`;

/** Filter status: opsi diturunkan dari baris yang ada (planning / aktif). */
const STATUS_FACET: FacetDef<ProjectRequirement>[] = [
  {
    key: "status",
    label: "Status",
    value: (p) => (p.status ? { value: p.status, label: p.status } : null),
    emptyLabel: "Belum ada status pada data ini.",
  },
];

/**
 * Kolom yang bisa diurutkan. Satu konfigurasi untuk kedua `focus` — kolom yang tidak
 * dirender pada satu mode tidak pernah dipakai key sort-nya, jadi tidak saling ganggu.
 */
const SORT: SortConfig<ProjectRequirement> = {
  columns: {
    project: { value: (p) => p.name },
    periode: { value: (p) => p.startDate },
    status: { value: (p) => p.status },
    targetCreators: { value: (p) => p.targetCreators, firstDir: "desc" },
    participants: { value: (p) => p.participants, firstDir: "desc" },
    creatorGap: { value: (p) => (p.targetCreators == null ? null : p.creatorGap), firstDir: "desc" },
    adsBudget: { value: (p) => p.adsBudgetCap, firstDir: "desc" },
    targetGmv: { value: (p) => p.targetGmv, firstDir: "desc" },
  },
  // Default = urutan yang dipakai server (project paling awal mulai dulu).
  initial: { key: "periode", dir: "asc" },
};

/**
 * Read-only panel showing what active/planned special projects need from a team.
 * `focus="creator"` (CM & Acquisition) surfaces the creator recruitment gap;
 * `focus="ads"` (BizDev) surfaces the ads budget requirement.
 *
 * Search nama/tipe project, filter status, sort asc/desc di tiap header, dan paginasi
 * 10 project per halaman — semua client-side (daftar sudah dimuat server component).
 */
export function ProjectRequirementsPanel({
  requirements,
  focus,
}: {
  requirements: ProjectRequirement[];
  focus: "creator" | "ads";
}) {
  const title =
    focus === "creator" ? "Kebutuhan Creator — Special Project" : "Kebutuhan Ads Budget — Special Project";
  const help =
    focus === "creator"
      ? "Berapa creator yang masih harus direkrut/di-bind untuk project aktif & rencana. Sumber: M7 (target_creators vs peserta). Read-only."
      : "Ads budget yang perlu diamankan BizDev untuk project aktif & rencana. Sumber: M7 (ads_budget_cap). Read-only.";

  const facets = useMemo(() => STATUS_FACET, []);
  const controls = useTableControls<ProjectRequirement>({
    rows: requirements,
    searchText: searchNameOrType,
    facets,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "project",
  });

  return (
    <section>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{help}</p>

      <TableFilterBar
        controls={controls}
        searchPlaceholder="Cari nama / tipe project…"
        className="mt-3"
      />

      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <SortableTh controls={controls} sortKey="project">Project</SortableTh>
                <SortableTh controls={controls} sortKey="periode">Periode</SortableTh>
                <SortableTh controls={controls} sortKey="status">Status</SortableTh>
                {focus === "creator" ? (
                  <>
                    <SortableTh controls={controls} sortKey="targetCreators">Target Creator</SortableTh>
                    <SortableTh controls={controls} sortKey="participants">Sudah Bind</SortableTh>
                    <SortableTh controls={controls} sortKey="creatorGap">Masih Dibutuhkan</SortableTh>
                  </>
                ) : (
                  <>
                    <SortableTh controls={controls} sortKey="adsBudget">Ads Budget</SortableTh>
                    <SortableTh controls={controls} sortKey="targetGmv">Target GMV</SortableTh>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.visibleRows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/projects/${p.id}`} className="text-slate-900 underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                    {p.type && <span className="ml-1 text-xs text-slate-400">{p.type}</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{p.startDate ?? "—"} → {p.endDate ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  {focus === "creator" ? (
                    <>
                      <td className="px-4 py-2">{p.targetCreators ?? "—"}</td>
                      <td className="px-4 py-2">{p.participants}</td>
                      <td className="px-4 py-2">
                        {p.targetCreators == null ? (
                          "—"
                        ) : p.creatorGap > 0 ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            kurang {p.creatorGap}
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            terpenuhi
                          </span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-medium">{rupiah(p.adsBudgetCap)}</td>
                      <td className="px-4 py-2">{rupiah(p.targetGmv)}</td>
                    </>
                  )}
                </tr>
              ))}
              {controls.visibleRows.length === 0 && (
                <tr>
                  <td colSpan={focus === "creator" ? 6 : 5} className="px-4 py-6 text-center text-slate-400">
                    {controls.filterActive
                      ? "Tidak ada project yang cocok dengan pencarian nama/tipe atau filter status."
                      : "Tidak ada special project aktif / rencana."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <TablePagination controls={controls} />
      </div>
    </section>
  );
}
