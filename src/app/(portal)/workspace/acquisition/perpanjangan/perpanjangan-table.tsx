"use client";

import { Fragment, useMemo, useState } from "react";
import { ContractRenewForm } from "@/components/contract-renew-form";
import {
  contractBucket,
  contractBucketTone,
  type ContractAlertDays,
  type ContractBucket,
} from "@/lib/creators/contract";

export interface PerpanjanganRow {
  id: string;
  name: string;
  username: string | null;
  cmName: string | null;
  joinDate: string | null;
  contractEndDate: string | null;
  days: number | null;
  priorPeriods: number;
}

type Bucket = "semua" | "habis" | "danger" | "warning";

// Tabs are cumulative: "≤danger" includes expired, "≤warning" includes danger + expired.
const TAB_BUCKETS: Record<Exclude<Bucket, "semua">, ContractBucket[]> = {
  habis: ["expired"],
  danger: ["expired", "danger"],
  warning: ["expired", "danger", "warning"],
};

function matchesBucket(days: number | null, bucket: Bucket, alertDays: ContractAlertDays): boolean {
  if (bucket === "semua") return true;
  return TAB_BUCKETS[bucket].includes(contractBucket(days, alertDays));
}

function daysLabel(days: number | null): string {
  if (days === null) return "—";
  if (days < 0) return `habis ${-days} hr lalu`;
  return `${days} hari`;
}

export function PerpanjanganTable({
  rows,
  alertDays,
}: {
  rows: PerpanjanganRow[];
  /** Thresholds from app_config m8.contract_alert_days — CLAUDE.md: never hardcode. */
  alertDays: ContractAlertDays;
}) {
  const [bucket, setBucket] = useState<Bucket>("semua");
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshedIds, setRefreshedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () =>
      rows
        .filter((r) => matchesBucket(r.days, bucket, alertDays))
        .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity)),
    [rows, bucket, alertDays]
  );

  const counts = useMemo(
    () => ({
      semua: rows.length,
      habis: rows.filter((r) => matchesBucket(r.days, "habis", alertDays)).length,
      danger: rows.filter((r) => matchesBucket(r.days, "danger", alertDays)).length,
      warning: rows.filter((r) => matchesBucket(r.days, "warning", alertDays)).length,
    }),
    [rows, alertDays]
  );

  const TABS: { key: Bucket; label: string }[] = [
    { key: "habis", label: "Sudah Habis" },
    { key: "danger", label: `≤${alertDays.danger} Hari` },
    { key: "warning", label: `≤${alertDays.warning} Hari` },
    { key: "semua", label: "Semua" },
  ];

  const toneOf = (days: number | null) => contractBucketTone(contractBucket(days, alertDays));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setBucket(t.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              bucket === t.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Kreator</th>
              <th className="px-3 py-2">CM</th>
              <th className="px-3 py-2">Join Date</th>
              <th className="px-3 py-2">Akhir Kontrak</th>
              <th className="px-3 py-2">Sisa</th>
              <th className="px-3 py-2">Perpanjangan Sebelumnya</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr className={toneOf(r.days).row || undefined}>
                  <td className="px-3 py-2 font-medium">
                    {r.name}
                    {r.username && <span className="ml-1 text-slate-400">@{r.username}</span>}
                  </td>
                  <td className="px-3 py-2">{r.cmName ?? "—"}</td>
                  <td className="px-3 py-2">{r.joinDate ?? "—"}</td>
                  <td className="px-3 py-2">{r.contractEndDate ?? "—"}</td>
                  <td className={`px-3 py-2 ${toneOf(r.days).text}`}>
                    {daysLabel(r.days)}
                  </td>
                  <td className="px-3 py-2">{r.priorPeriods}x</td>
                  <td className="px-3 py-2">
                    {!refreshedIds.has(r.id) && (
                      <button
                        onClick={() => setOpenId(openId === r.id ? null : r.id)}
                        className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium hover:bg-slate-200"
                      >
                        {openId === r.id ? "Tutup" : "Perpanjang"}
                      </button>
                    )}
                    {refreshedIds.has(r.id) && <span className="text-xs text-emerald-700">✓ diperpanjang</span>}
                  </td>
                </tr>
                {openId === r.id && (
                  <tr>
                    <td colSpan={7} className="px-3 pb-3">
                      <ContractRenewForm
                        creatorId={r.id}
                        contractEndDate={r.contractEndDate}
                        onDone={() => {
                          setOpenId(null);
                          setRefreshedIds((prev) => new Set(prev).add(r.id));
                        }}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-5 text-center text-slate-400">
                  Tidak ada kreator pada filter ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
