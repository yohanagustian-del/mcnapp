"use client";

import Link from "next/link";
import type { ProjectRequirement } from "@/lib/m7/requirements";
import { rupiah } from "@/lib/utils/format";
import { PAGE_SIZE_10, TablePagination, useTableControls } from "@/components/table-controls";

const STATUS_STYLES: Record<string, string> = {
  planning: "bg-slate-100 text-slate-600",
  aktif: "bg-green-100 text-green-800",
};

/**
 * Read-only panel showing what active/planned special projects need from a team.
 * `focus="creator"` (CM & Acquisition) surfaces the creator recruitment gap;
 * `focus="ads"` (BizDev) surfaces the ads budget requirement.
 * Dipaginasi 10 project per halaman (client-side — daftar sudah dimuat server component).
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

  const controls = useTableControls({
    rows: requirements,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "project",
  });

  return (
    <section>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{help}</p>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Periode</th>
                <th className="px-4 py-3">Status</th>
                {focus === "creator" ? (
                  <>
                    <th className="px-4 py-3">Target Creator</th>
                    <th className="px-4 py-3">Sudah Bind</th>
                    <th className="px-4 py-3">Masih Dibutuhkan</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-3">Ads Budget</th>
                    <th className="px-4 py-3">Target GMV</th>
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
              {requirements.length === 0 && (
                <tr>
                  <td colSpan={focus === "creator" ? 6 : 5} className="px-4 py-6 text-center text-slate-400">
                    Tidak ada special project aktif / rencana.
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
