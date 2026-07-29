import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { daysInMonth, weekOfMonth } from "@/lib/utils/date";
import { IngestForm } from "./ingest-form";
import { ShopeeIngestForm } from "./shopee-ingest-form";
import { LeakArtifactForm } from "./leak-artifact-form";

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

const MONTH_LABELS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

type WeekCellStatus = "processed" | "staging" | "failed" | "kosong" | "n/a";

const CALENDAR_CELL_STYLES: Record<WeekCellStatus, string> = {
  processed: "bg-green-500",
  staging: "bg-amber-400",
  failed: "bg-red-500",
  kosong: "bg-slate-200",
  "n/a": "bg-transparent",
};

interface BatchForCalendar {
  period_start: string | null;
  period_end: string | null;
  status: string;
}

/**
 * Builds a month x W1-W5 coverage grid (visual calendar, task §4) purely from
 * upload_batches rows already fetched for the history table above — no extra
 * query. One cell per (month, week); status priority when multiple batches
 * land in the same window: processed > failed > staging (most "final" wins,
 * since a later successful reprocess should not be hidden by a stale failed
 * row from the same window).
 */
function buildWeekCalendar(
  batches: BatchForCalendar[],
  monthsBack: number
): Array<{ year: number; month: number; label: string; weeks: Array<{ week: 1 | 2 | 3 | 4 | 5; exists: boolean; status: WeekCellStatus }> }> {
  const now = new Date();
  const months: Array<{ year: number; month: number }> = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  // status rank: higher wins when a window has multiple batches.
  const rank: Record<string, number> = { processed: 3, failed: 2, staging: 1 };

  return months.map(({ year, month }) => {
    const lastDay = daysInMonth(year, month);
    const cellStatus = new Map<number, WeekCellStatus>();

    for (const b of batches) {
      if (!b.period_start) continue;
      const m = b.period_start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      const [, y, mo, d] = m;
      if (Number(y) !== year || Number(mo) !== month) continue;
      const week = weekOfMonth(new Date(Date.UTC(year, month - 1, Number(d))));
      const status = (b.status as WeekCellStatus) ?? "kosong";
      const current = cellStatus.get(week);
      if (!current || (rank[status] ?? 0) > (rank[current] ?? 0)) {
        cellStatus.set(week, status);
      }
    }

    const weeks = ([1, 2, 3, 4, 5] as const).map((week) => {
      const exists = week < 5 || 29 <= lastDay; // W5 exists only if month has a day 29
      if (!exists) return { week, exists: false, status: "n/a" as WeekCellStatus };
      return { week, exists: true, status: cellStatus.get(week) ?? "kosong" };
    });

    return { year, month, label: `${MONTH_LABELS_ID[month - 1]} ${year}`, weeks };
  });
}

export default async function IngestPage() {
  const member = await requireMember();
  const canRun = hasPermission("ingest.run", member.role);
  const canUploadLeak = hasPermission("leak.upload_artifact", member.role);

  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("upload_batches")
    .select("batch_id, source_type, uploaded_at, row_count_raw, creators_count, period_start, period_end, status, processed_at, error")
    .order("uploaded_at", { ascending: false })
    .limit(20);

  // Kalender cakupan minggu: pola query sama (upload_batches, service via RLS
  // select-all policy), diurutkan by period_start supaya bulan-bulan dengan
  // data historis (bukan cuma 20 upload terakhir) ikut terhitung.
  const { data: calendarBatches } = await supabase
    .from("upload_batches")
    .select("period_start, period_end, status")
    .not("period_start", "is", null)
    .order("period_start", { ascending: false })
    .limit(500);
  const weekCalendar = buildWeekCalendar(calendarBatches ?? [], 3);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Upload Data Platform Mingguan</h1>
      <p className="mt-1 text-sm text-slate-500">
        Satu upload untuk semuanya: file MCN (semua transaksi) + TAP (via agency link) diproses
        sekali — ringkasan periode (M2/M8), GMV subkategori×segmen (M5/M6), top produk, katalog
        produk TAP, DAN analisa kebocoran link agency (rollup per kreator, peluang BD, alert)
        dihitung serentak dari file yang sama, lalu baris mentah dibuang (tidak pernah disimpan ke
        DB). Tidak perlu lagi menjalankan artifak Agency Leaked Generator di luar platform.
      </p>

      <h2 className="mt-6 text-lg font-medium">TikTok</h2>
      {canRun ? (
        <div className="mt-2 max-w-2xl">
          <IngestForm />
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Role Anda tidak memiliki izin upload ingest.
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Shopee</h2>
      {canRun ? (
        <div className="mt-2 max-w-2xl">
          <ShopeeIngestForm />
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Role Anda tidak memiliki izin upload ingest.
        </p>
      )}

      <h2 className="mt-10 text-xl font-semibold">
        Upload Hasil Agency Leaked (Artifak) — fallback data lama
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Tidak dipakai untuk upload mingguan lagi: analisa kebocoran kini dihitung platform dari file
        MCN+TAP di atas (atau lewat halaman{" "}
        <Link href="/link-leakage" className="text-blue-700 underline">
          Link Leakage
        </Link>
        ). Jalur ini DIBIARKAN untuk memasukkan hasil artifak Excel lama (2 file, format v1/v2) —
        mis. minggu-minggu historis yang file platform mentahnya sudah tidak ada. Platform hanya
        menyimpan ROLLUP per kreator per minggu; status link & rasio bocor dihitung ulang
        deterministik dengan ambang app_config yang sama.
      </p>
      {canUploadLeak ? (
        <div className="mt-4 max-w-2xl">
          <LeakArtifactForm />
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
          Role Anda tidak memiliki izin upload hasil artifak.
        </p>
      )}

      <h2 className="mt-8 text-lg font-medium">Kalender Cakupan Minggu (W1-W5)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Status upload per window mingguan (W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan).
        Sel Februari W5 kosong/nonaktif untuk tahun bukan kabisat.
      </p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-4">
        <table className="text-sm">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs uppercase text-slate-500">Bulan</th>
              {(["W1", "W2", "W3", "W4", "W5"] as const).map((w) => (
                <th key={w} className="px-3 py-2 text-center text-xs uppercase text-slate-500">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekCalendar.map((m) => (
              <tr key={`${m.year}-${m.month}`}>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-700">{m.label}</td>
                {m.weeks.map((w) => (
                  <td key={w.week} className="px-3 py-2 text-center">
                    <span
                      title={
                        !w.exists
                          ? "Window tidak ada untuk bulan ini"
                          : STATUS_LABELS[w.status] ?? "Belum ada upload"
                      }
                      className={`inline-block h-5 w-5 rounded ${CALENDAR_CELL_STYLES[w.status]} ${
                        !w.exists ? "opacity-30" : ""
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-green-500" /> Selesai
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-amber-400" /> Diproses
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-red-500" /> Gagal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-slate-200" /> Belum ada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded bg-slate-200 opacity-30" /> Window tidak ada (mis. Feb W5)
          </span>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-medium">Riwayat Batch</h2>
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
            {(batches ?? []).map((b) => (
              <tr key={b.batch_id}>
                <td className="px-4 py-2 font-mono text-xs">{b.batch_id}</td>
                <td className="px-4 py-2">
                  {b.period_start ?? "—"} — {b.period_end ?? "—"}
                </td>
                <td className="px-4 py-2">{Number(b.row_count_raw).toLocaleString("id-ID")}</td>
                <td className="px-4 py-2">{b.creators_count}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status] ?? ""}`}>
                    {STATUS_LABELS[b.status] ?? b.status}
                  </span>
                  {b.error && <span className="ml-2 text-xs text-red-600">{b.error}</span>}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {b.processed_at ? new Date(b.processed_at).toLocaleString("id-ID") : "—"}
                </td>
              </tr>
            ))}
            {(batches ?? []).length === 0 && (
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
      <p className="mt-2 text-xs text-slate-500">
        Baris mentah tidak disimpan permanen — bukti upload (jumlah baris, hash file, periode)
        tercatat di tabel ini. Upload ulang periode sama menimpa hasil lama (idempotent).
      </p>
    </div>
  );
}
