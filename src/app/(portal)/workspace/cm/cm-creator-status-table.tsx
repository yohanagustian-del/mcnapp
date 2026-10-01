"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ContractRenewForm } from "@/components/contract-renew-form";
import { PortalInviteButton } from "@/components/portal-invite-button";
import { PartnershipBadge } from "@/components/partnership-badge";
import { contractBucketTone, type ContractBucket } from "@/lib/creators/contract";
import type { PortalAccountStatus } from "@/lib/portal/invite";
import type {
  FeeAgreementStatus,
  PartnershipStatus,
  PartnershipStatusLabels,
} from "@/lib/creators/partnership-spec";

/** One row — every number/bucket computed on the server (CLAUDE.md #4). */
export interface CmCreatorStatusRow {
  id: string;
  name: string;
  username: string | null;
  platform: string | null;
  cmName: string | null;
  contractEndDate: string | null;
  contractLabel: string;
  bucket: ContractBucket;
  partnership: PartnershipStatus | null;
  fee: FeeAgreementStatus | null;
  /** Portal account status; undefined = viewer may not invite this creator. */
  portal?: PortalAccountStatus | null;
  canRenew: boolean;
}

/**
 * CM Workspace — "Kreator Saya — Kontrak & Status Kemitraan" (Improvement MCN T6).
 * Rows in the danger/expired bucket (≤ app_config danger) are highlighted red; the
 * banner count is computed by the page from the same buckets.
 */
export function CmCreatorStatusTable({
  rows,
  labels,
  showCm,
}: {
  rows: CmCreatorStatusRow[];
  labels: PartnershipStatusLabels;
  showCm: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [renewed, setRenewed] = useState<Set<string>>(new Set());
  const [urgentOnly, setUrgentOnly] = useState(false);

  const isUrgent = (b: ContractBucket) => b === "danger" || b === "expired";
  const visible = urgentOnly ? rows.filter((r) => isUrgent(r.bucket)) : rows;
  const colSpan = showCm ? 7 : 6;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={urgentOnly} onChange={(e) => setUrgentOnly(e.target.checked)} />
        Hanya kontrak yang perlu diperpanjang
      </label>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kreator</th>
              {showCm && <th className="px-3 py-2">CM</th>}
              <th className="px-3 py-2">Sisa Kontrak</th>
              <th className="px-3 py-2">Management Partnership</th>
              <th className="px-3 py-2">Fee Agreement</th>
              <th className="px-3 py-2">Portal</th>
              <th className="px-3 py-2">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const tone = contractBucketTone(r.bucket);
              return (
                <Fragment key={r.id}>
                  <tr className={tone.row || undefined}>
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/creators/${r.id}`} className="hover:underline">{r.name}</Link>
                      {r.username && <span className="ml-1 text-xs text-slate-400">@{r.username}</span>}
                    </td>
                    {showCm && <td className="px-3 py-2">{r.cmName ?? "—"}</td>}
                    <td className={`px-3 py-2 ${tone.text}`}>
                      {r.contractLabel}
                      {renewed.has(r.id) && <span className="ml-1 text-xs text-green-700">(diperpanjang)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <PartnershipBadge kind="partnership" status={r.partnership} labels={labels} />
                    </td>
                    <td className="px-3 py-2">
                      <PartnershipBadge kind="fee" status={r.fee} platform={r.platform} labels={labels} />
                    </td>
                    <td className="px-3 py-2">
                      {r.portal !== undefined ? (
                        <PortalInviteButton creatorId={r.id} existingStatus={r.portal} canReset />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {r.canRenew ? (
                        <button
                          type="button"
                          onClick={() => setOpenId(openId === r.id ? null : r.id)}
                          className="text-xs text-blue-700 hover:underline"
                        >
                          {openId === r.id ? "Tutup" : "Perpanjang"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                  {openId === r.id && (
                    <tr>
                      <td colSpan={colSpan} className="px-3 pb-3">
                        <ContractRenewForm
                          creatorId={r.id}
                          contractEndDate={r.contractEndDate}
                          onDone={() => {
                            setOpenId(null);
                            setRenewed((prev) => new Set(prev).add(r.id));
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-slate-400">
                  {urgentOnly ? "Tidak ada kontrak yang perlu diperpanjang." : "Belum ada kreator di scope Anda."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
