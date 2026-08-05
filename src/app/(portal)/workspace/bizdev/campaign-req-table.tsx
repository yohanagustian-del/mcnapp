"use client";

import { PAGE_SIZE_10, SortableTh, TablePagination, useTableControls, type SortConfig } from "@/components/table-controls";
import { brandAccCampaign, handoverCampaign } from "../campaign-actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/**
 * Satu baris tracker req campaign (§2E.2). Sudah diratakan di server component —
 * komponen ini hanya menampilkan, tidak menghitung ulang status apa pun.
 */
export interface CampaignReqRow {
  id: number;
  dealId: string | null;
  brandName: string;
  requestText: string | null;
  routeType: string | null;
  level2Category: string | null;
  creatorId: string | null;
  creatorName: string;
  cmOwnerName: string;
  cmConfirmStatus: string;
  needsBrandAcc: boolean;
  brandAccStatus: string;
  finalStatus: string;
  handedOverAt: string | null;
  creatorSourcedBy: string | null;
}

/** Label kolom "Creator" — routing per kreator, per kategori, atau broadcast. */
function targetLabel(r: CampaignReqRow): string {
  if (r.routeType === "category") return `Kategori: ${r.level2Category ?? "—"}`;
  if (r.routeType === "broadcast") return "Broadcast";
  return r.creatorName;
}

/** Kolom yang bisa diurutkan lewat klik header — kolom Aksi tidak ikut. */
const SORT: SortConfig<CampaignReqRow> = {
  columns: {
    brand: { value: (r) => (r.dealId ? r.brandName : null) },
    creator: { value: targetLabel },
    sourcing: { value: (r) => (r.creatorSourcedBy === "bizdev" ? "BizDev langsung" : "via CM") },
    cmOwner: { value: (r) => r.cmOwnerName },
    konfirmasi: { value: (r) => r.cmConfirmStatus },
    accBrand: { value: (r) => (r.needsBrandAcc ? r.brandAccStatus : null) },
    status: { value: (r) => r.finalStatus },
  },
  // Tanpa `initial`: urutan bawaan = urutan dari server (req terbaru dulu). Klik
  // ketiga pada kolom yang sama mengembalikan ke urutan itu.
  resettable: true,
};

/**
 * Status Req Campaign (§2E.2): sort asc/desc di setiap header kolom + paginasi 10
 * baris per halaman, client-side atas daftar yang sudah dimuat server component
 * (limit 50). Aksi Brand acc / Handover tetap server action — transisinya ter-log
 * di sana (audit_logs), komponen ini tidak pernah mengubah status sendiri.
 */
export function CampaignReqTable({
  rows,
  canBrandAcc,
  canHandover,
}: {
  rows: CampaignReqRow[];
  canBrandAcc: boolean;
  canHandover: boolean;
}) {
  const controls = useTableControls<CampaignReqRow>({
    rows,
    sort: SORT,
    pageSizes: PAGE_SIZE_10,
    itemLabel: "req",
  });

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortableTh controls={controls} sortKey="brand">Brand</SortableTh>
              <SortableTh controls={controls} sortKey="creator">Creator</SortableTh>
              <SortableTh controls={controls} sortKey="sourcing">Sourcing</SortableTh>
              <SortableTh controls={controls} sortKey="cmOwner">CM Owner</SortableTh>
              <SortableTh controls={controls} sortKey="konfirmasi">Konfirmasi CM</SortableTh>
              <SortableTh controls={controls} sortKey="accBrand">Acc Brand</SortableTh>
              <SortableTh controls={controls} sortKey="status">Status</SortableTh>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  {r.dealId ? r.brandName : <span className="text-slate-400">tanpa deal</span>}
                  {r.requestText && (
                    <span className="mt-0.5 block max-w-xs truncate text-xs text-slate-500" title={r.requestText}>
                      “{r.requestText}”
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {r.routeType === "category" ? (
                    <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                      Kategori: {r.level2Category}
                    </span>
                  ) : r.routeType === "broadcast" ? (
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                      Broadcast
                    </span>
                  ) : (
                    <>{r.creatorName} <span className="text-xs text-slate-400">{r.creatorId}</span></>
                  )}
                  {r.routeType !== "creator" && r.creatorId && (
                    <span className="mt-0.5 block text-xs text-slate-500">→ {r.creatorName} {r.creatorId}</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {r.creatorSourcedBy === "bizdev" ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                      BizDev langsung
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">via CM</span>
                  )}
                </td>
                <td className="px-4 py-2">{r.cmOwnerName}</td>
                <td className="px-4 py-2">{r.cmConfirmStatus}</td>
                <td className="px-4 py-2">{r.needsBrandAcc ? r.brandAccStatus : "tidak perlu"}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    r.finalStatus === "fix" ? "bg-green-100 text-green-800"
                    : r.finalStatus === "batal" ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-800"}`}>
                    {r.finalStatus}{r.handedOverAt ? " · handed over" : ""}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-1">
                    {canBrandAcc && r.finalStatus === "proses" && r.brandAccStatus === "menunggu" &&
                      (["approved", "ditolak"] as const).map((d) => (
                        <form key={d} action={brandAccCampaign}>
                          <input type="hidden" name="req_id" value={r.id} />
                          <input type="hidden" name="decision" value={d} />
                          <button type="submit" className={`${btnSmall} ${d === "approved" ? "bg-green-600 text-white" : "bg-red-100 text-red-700"}`}>
                            Brand {d}
                          </button>
                        </form>
                      ))}
                    {canHandover && r.finalStatus === "fix" && !r.handedOverAt && (
                      <form action={handoverCampaign}>
                        <input type="hidden" name="req_id" value={r.id} />
                        <button type="submit" className={`${btnSmall} bg-slate-900 text-white`}>Handover Campaign Ops</button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {controls.visibleRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Belum ada req campaign.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <TablePagination controls={controls} />
    </div>
  );
}
