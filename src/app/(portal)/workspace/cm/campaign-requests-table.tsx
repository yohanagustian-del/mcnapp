"use client";

import { TablePagination, useTableControls } from "@/components/table-controls";
import { cmConfirmCampaign, cmClaimBroadcastRequest } from "../campaign-actions";

const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/** Satu baris req campaign dari BizDev (routing §2E). */
export interface CampaignRequestRow {
  id: number;
  dealId: string | null;
  brandName: string | null;
  creatorId: string | null;
  creatorName: string | null;
  routeType: string | null;
  level2Category: string | null;
  requestText: string | null;
  cmConfirmStatus: string;
  needsBrandAcc: boolean;
  brandAccStatus: string | null;
  finalStatus: string;
  handedOverAt: string | null;
}

export interface CreatorPickOption {
  id: string;
  name: string;
}

/**
 * Campaign dari BizDev — perlu konfirmasi. Paginasi 10/20/50 (client-side; daftar sudah
 * dimuat server component). Aksi konfirmasi/claim tetap server action, tidak ada logic
 * routing yang diduplikasi di sini.
 */
export function CampaignRequestsTable({
  rows,
  creators,
}: {
  rows: CampaignRequestRow[];
  creators: CreatorPickOption[];
}) {
  const controls = useTableControls<CampaignRequestRow>({ rows, itemLabel: "req" });

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Brand / Deal</th>
              <th className="px-4 py-3">Sumber / Creator</th>
              <th className="px-4 py-3">Konfirmasi CM</th>
              <th className="px-4 py-3">Acc Brand</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {controls.visibleRows.map((r) => {
              const isBroadcast = r.routeType === "category" || r.routeType === "broadcast";
              const needsPick = isBroadcast && !r.creatorId;
              return (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    {r.dealId ? (
                      <>
                        {r.brandName ?? "—"} <span className="text-xs text-slate-400">{r.dealId}</span>
                      </>
                    ) : (
                      <span className="text-slate-400">tanpa deal</span>
                    )}
                    {r.requestText && (
                      <span className="mt-0.5 block max-w-xs text-xs text-slate-500">“{r.requestText}”</span>
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
                      <>
                        {r.creatorName ?? "—"} <span className="text-xs text-slate-400">{r.creatorId}</span>
                      </>
                    )}
                    {isBroadcast && r.creatorId && (
                      <span className="mt-0.5 block text-xs text-slate-600">
                        → {r.creatorName ?? "—"} <span className="text-slate-400">{r.creatorId}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">{r.cmConfirmStatus}</td>
                  <td className="px-4 py-2">{r.needsBrandAcc ? r.brandAccStatus : "tidak perlu"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        r.finalStatus === "fix"
                          ? "bg-green-100 text-green-800"
                          : r.finalStatus === "batal"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {r.finalStatus}
                      {r.handedOverAt ? " · handed over" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {r.finalStatus === "proses" && r.cmConfirmStatus === "menunggu" && !needsPick && (
                      <div className="flex gap-1">
                        {(["mau", "tidak"] as const).map((d) => (
                          <form key={d} action={cmConfirmCampaign}>
                            <input type="hidden" name="req_id" value={r.id} />
                            <input type="hidden" name="decision" value={d} />
                            <button
                              type="submit"
                              className={`${btnSmall} ${d === "mau" ? "bg-green-600 text-white hover:bg-green-500" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
                            >
                              Creator {d}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                    {r.finalStatus === "proses" && r.cmConfirmStatus === "menunggu" && needsPick && (
                      <div className="flex flex-col gap-1">
                        <form action={cmClaimBroadcastRequest} className="flex items-center gap-1">
                          <input type="hidden" name="req_id" value={r.id} />
                          <input type="hidden" name="decision" value="mau" />
                          <select name="creator_id" required className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                            <option value="">— pilih kreator —</option>
                            {creators.map((c) => (
                              <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                            ))}
                          </select>
                          <button type="submit" className={`${btnSmall} bg-green-600 text-white hover:bg-green-500`}>
                            Pilih &amp; mau
                          </button>
                        </form>
                        <form action={cmClaimBroadcastRequest}>
                          <input type="hidden" name="req_id" value={r.id} />
                          <input type="hidden" name="decision" value="tidak" />
                          <button type="submit" className={`${btnSmall} bg-red-100 text-red-700 hover:bg-red-200`}>
                            Tidak ada yang cocok
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {controls.visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada req campaign masuk.
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
