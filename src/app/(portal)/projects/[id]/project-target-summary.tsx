import type { TrackingSummary } from "@/lib/m7/tracking";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

/**
 * Ringkas target project (Improvement MCN T1): Target GMV | Achieved GMV |
 * GMV Gap | Sisa Hari. Every number comes straight from trackDaily()
 * (CLAUDE.md #4: no recomputation in the UI). Gap is measured against the
 * full-period target, not the ramp curve — the "Progres GMV"/"Status" cards
 * above keep showing the curve-based view.
 */
export function ProjectTargetSummary({ tracking }: { tracking: TrackingSummary }) {
  const reached = tracking.gmvGapToTarget <= 0;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Target GMV</th>
              <th className="px-4 py-3">Achieved GMV</th>
              <th className="px-4 py-3">GMV Gap</th>
              <th className="px-4 py-3">Sisa Hari</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-2 font-medium">{rupiah(tracking.targetGmv)}</td>
              <td className="px-4 py-2 font-medium">{rupiah(tracking.cumActual)}</td>
              <td className={`px-4 py-2 font-medium ${reached ? "text-green-700" : "text-red-700"}`}>
                {reached ? "Tercapai" : rupiah(tracking.gmvGapToTarget)}
              </td>
              <td className="px-4 py-2 font-medium">{tracking.daysRemaining} hari</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
