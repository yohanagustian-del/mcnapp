import { PENDING_SOURCE_LABEL, type PendingRow, type PendingSource } from "@/lib/creators/pending";
import { approvePendingCreator, rejectPendingCreator } from "./pending-actions";

/**
 * Panel "Daftar Tunggu Kreator" (migration 0028).
 *
 * Jalur upload data mingguan tidak lagi membuat master kreator — username asing
 * mendarat di sini. Panel ini yang mengubahnya jadi kreator (approve) atau menutupnya
 * (tolak). Server component: aksinya server action, tanpa state klien.
 */

const btnApprove =
  "rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700";
const btnReject =
  "rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-slate-200 text-slate-600",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "menunggu",
  approved: "sudah dibuat",
  rejected: "ditolak",
};

const tanggal = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export function PendingCreatorsPanel({
  rows,
  canReview,
}: {
  rows: PendingRow[];
  canReview: boolean;
}) {
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <section>
      <h2 className="text-lg font-medium">
        Daftar Tunggu Kreator{" "}
        {pendingCount > 0 && (
          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-sm text-amber-800">
            {pendingCount} menunggu
          </span>
        )}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Username yang muncul di file upload mingguan tapi belum ada di master kreator. Upload TIDAK
        membuat kreator otomatis lagi — data mingguan mereka dilewati sampai di-approve di sini,
        lalu file mingguannya di-upload ulang. Deterministik, 0 token AI.
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Tidak ada username tertunda — semua kreator di file upload terakhir sudah terdaftar.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Sumber</th>
                <th className="px-3 py-2 text-right">Kali terdeteksi</th>
                <th className="px-3 py-2 text-right">Baris dilewati</th>
                <th className="px-3 py-2">Followers</th>
                <th className="px-3 py-2">Terakhir</th>
                {canReview && <th className="px-3 py-2">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className={r.status === "pending" ? "" : "text-slate-500"}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {r.username}
                    <span className="ml-1 text-xs text-slate-400">{r.platform ?? "tiktok"}</span>
                    {r.creator_id && (
                      <span className="ml-1 text-xs text-slate-400">→ {r.creator_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ""}`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {PENDING_SOURCE_LABEL[r.source as PendingSource] ?? r.source}
                  </td>
                  <td className="px-3 py-2 text-right">{r.seen_count}×</td>
                  <td className="px-3 py-2 text-right">
                    {r.rows_affected === null ? "—" : r.rows_affected.toLocaleString("id-ID")}
                  </td>
                  <td className="px-3 py-2">
                    {r.followers === null ? "—" : r.followers.toLocaleString("id-ID")}
                  </td>
                  <td className="px-3 py-2 text-xs">{tanggal(r.last_seen_at)}</td>
                  {canReview && (
                    <td className="px-3 py-2">
                      {r.status === "approved" ? (
                        <span className="text-xs">Upload ulang file mingguannya</span>
                      ) : (
                        <div className="flex gap-2">
                          <form action={approvePendingCreator}>
                            <input type="hidden" name="pending_id" value={r.id} />
                            <button type="submit" className={btnApprove}>
                              Daftarkan
                            </button>
                          </form>
                          {r.status === "pending" && (
                            <form action={rejectPendingCreator}>
                              <input type="hidden" name="pending_id" value={r.id} />
                              <button type="submit" className={btnReject}>
                                Tolak
                              </button>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
