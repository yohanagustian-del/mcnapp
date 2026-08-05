"use client";

import Link from "next/link";
import { PAGE_SIZE_10, SortableTh, TablePagination, useTableControls, type SortConfig } from "@/components/table-controls";
import { PIPELINE_STAGES } from "@/lib/m8/routing";
import { setPipelineStage } from "./actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Satu baris pipeline deal (§2B.2) — subset kolom brand_deals yang dipakai tabel ini. */
export interface PipelineDealRow {
  id: string;
  brandName: string;
  campaignName: string | null;
  expDate: string | null;
  pipelineStage: string | null;
}

/**
 * Tahap pipeline diurutkan mengikuti urutan tahapnya (PIPELINE_STAGES), bukan abjad:
 * "desc" harus berarti tahap paling akhir dulu, dan itu bukan urutan huruf.
 */
const STAGE_RANK = new Map<string, number>(PIPELINE_STAGES.map((s, i) => [s, i]));

/** Kolom yang bisa diurutkan lewat klik header. */
const SORT: SortConfig<PipelineDealRow> = {
  columns: {
    deal: { value: (d) => d.id },
    brand: { value: (d) => d.brandName },
    campaign: { value: (d) => d.campaignName },
    exp: { value: (d) => d.expDate },
    stage: { value: (d) => (d.pipelineStage ? STAGE_RANK.get(d.pipelineStage) ?? null : null) },
  },
  // Tanpa `initial`: urutan bawaan = urutan dari server (deal terbaru dulu). Klik
  // ketiga pada kolom yang sama mengembalikan ke urutan itu.
  resettable: true,
};

/**
 * Pipeline Deal Brand (§2B.2): sort asc/desc di setiap header kolom + paginasi 10
 * baris per halaman, client-side atas daftar yang sudah dimuat server component
 * (limit 100). Perubahan tahap tetap lewat server action (ter-audit di sana).
 */
export function PipelineTable({
  rows,
  canPipeline,
}: {
  rows: PipelineDealRow[];
  canPipeline: boolean;
}) {
  const controls = useTableControls<PipelineDealRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "deal",
  });

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="deal">Deal</SortableTh>
              <SortableTh controls={controls} sortKey="brand">Brand</SortableTh>
              <SortableTh controls={controls} sortKey="campaign">Campaign</SortableTh>
              <SortableTh controls={controls} sortKey="exp">Exp</SortableTh>
              <SortableTh controls={controls} sortKey="stage">Tahap Pipeline</SortableTh>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-2 font-medium">{d.id}</td>
                <td className="px-4 py-2">{d.brandName}</td>
                <td className="px-4 py-2">{d.campaignName ?? "—"}</td>
                <td className="px-4 py-2 whitespace-nowrap">{d.expDate ?? "—"}</td>
                <td className="px-4 py-2">
                  {canPipeline ? (
                    <form action={setPipelineStage} className="flex items-center gap-1">
                      <input type="hidden" name="deal_id" value={d.id} />
                      <select name="stage" defaultValue={d.pipelineStage ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                        <option value="" disabled>— tahap —</option>
                        {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button type="submit" className={`${btnSmall} bg-slate-200 text-slate-700 hover:bg-slate-300`}>Set</button>
                    </form>
                  ) : (d.pipelineStage ?? "—")}
                </td>
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Belum ada deal — registrasi via <Link href="/deals/baru" className="underline">Registrasi Deal</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination controls={controls} />
    </div>
  );
}
