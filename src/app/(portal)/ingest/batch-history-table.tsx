"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const PAGE_SIZE = 10;

const STATUS_STYLES: Record<string, string> = {
  processed: "bg-green-100 text-green-800",
  staging: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};
const STATUS_LABELS: Record<string, string> = {
  processed: "Selesai",
  staging: "Diproses",
  failed: "Gagal",
};

export interface BatchRow {
  batch_id: string;
  period_start: string | null;
  period_end: string | null;
  row_count_raw: number | string;
  creators_count: number | null;
  status: string;
  processed_at: string | null;
  error: string | null;
}

/**
 * Riwayat Batch dengan pagination 10 baris/halaman. Halaman pertama + total baris
 * di-fetch di server (page.tsx) dan dikirim sebagai props; halaman berikutnya
 * di-ambil bertahap dari browser via .range() supaya tidak menarik seluruh baris
 * sekaligus meski jumlah batch besar. RLS upload_batches (ub_select) mengizinkan
 * SELECT untuk internal authenticated; creator_user ditolak (restrictive policy).
 */
export function BatchHistoryTable({
  initialBatches,
  totalCount,
}: {
  initialBatches: BatchRow[];
  totalCount: number;
}) {
  const [batches, setBatches] = useState<BatchRow[]>(initialBatches);
  const [page, setPage] = useState(0); // 0-indexed
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  async function goToPage(nextPage: number) {
    if (loading || nextPage < 0 || nextPage >= totalPages || nextPage === page) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const from = nextPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error: qErr } = await supabase
      .from("upload_batches")
      .select(
        "batch_id, source_type, uploaded_at, row_count_raw, creators_count, period_start, period_end, status, processed_at, error"
      )
      .order("uploaded_at", { ascending: false })
      .range(from, to);
    if (qErr) {
      setError("Gagal memuat halaman riwayat batch. Coba lagi.");
      setLoading(false);
      return;
    }
    setBatches((data as BatchRow[]) ?? []);
    setPage(nextPage);
    setLoading(false);
  }

  return (
    <>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Periode</th>
              <th className="px-4 py-3">Baris Raw</th>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Diproses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batches.map((b) => (
              <tr key={b.batch_id} className={loading ? "opacity-50" : ""}>
                <td className="px-4 py-2 font-mono text-xs">{b.batch_id}</td>
                <td className="px-4 py-2">
                  {b.period_start ?? "—"} — {b.period_end ?? "—"}
                </td>
                <td className="px-4 py-2">{Number(b.row_count_raw).toLocaleString("id-ID")}</td>
                <td className="px-4 py-2">{b.creators_count}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status] ?? ""}`}
                  >
                    {STATUS_LABELS[b.status] ?? b.status}
                  </span>
                  {b.error && <span className="ml-2 text-xs text-red-600">{b.error}</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {b.processed_at ? new Date(b.processed_at).toLocaleString("id-ID") : "—"}
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada batch. Upload file MCN + TAP mingguan untuk memulai (analisa kebocoran
                  ikut dihitung bila TAP disertakan).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {totalCount > 0 && (
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            Halaman {page + 1} dari {totalPages} · {totalCount.toLocaleString("id-ID")} batch total
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={loading || page === 0}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              ← Sebelumnya
            </button>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={loading || page >= totalPages - 1}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              Berikutnya →
            </button>
          </div>
        </div>
      )}
    </>
  );
}
