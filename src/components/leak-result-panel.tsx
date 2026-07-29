"use client";

import type { LeakAnalysisResult } from "@/lib/m4/leak-analysis";

/**
 * Shared read-out for a weekly link-leakage analysis (in-platform compute).
 * Used by BOTH upload entry points — /ingest (Lane 1, leak computed from the same
 * weekly files) and /link-leakage (standalone re-run) — so the two never drift.
 *
 * Shows the official per-(product,shop) figure next to the per-shop comparison
 * value (the formula the old external artifact used), because during the
 * transition the team reconciles the new numbers against last week's report.
 */

const STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Agency",
  bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total",
  belum_ada_link: "Belum Ada Link",
};
const STATUS_STYLES: Record<string, string> = {
  via_agency: "bg-green-100 text-green-800",
  bocor_sebagian: "bg-amber-100 text-amber-800",
  bocor_total: "bg-red-100 text-red-700",
  belum_ada_link: "bg-slate-100 text-slate-600",
};

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);

export function LeakResultPanel({ result }: { result: LeakAnalysisResult }) {
  const t = result.totals;
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-white p-4 text-sm">
      <p className="font-medium text-slate-800">
        Analisa kebocoran selesai — minggu {result.week} ({result.periodStart} s/d {result.periodEnd}).
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Master shop:{" "}
        {result.masterSource === "file"
          ? `dari file upload (${result.masterShops} shop)`
          : `dari database cooperating_shops (${result.masterShops} shop)`}{" "}
        · {result.partneredShops} shop dihitung ber-deal minggu ini · {result.creators.length} kreator.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total Affiliate GMV" value={rupiah(t.gmvAffiliateTotal)} />
        <Kpi label="Via Agency Link (TAP)" value={rupiah(t.gmvTap)} tone="green" />
        <Kpi
          label="Bocor (per produk — resmi)"
          value={rupiah(t.gmvBocor)}
          tone="red"
          note={`pembanding basis shop (rumus artifak): ${rupiah(t.gmvBocorShopBasis)}`}
        />
        <Kpi label="Peluang BD (shop non-deal)" value={rupiah(t.gmvBdOpportunity)} tone="amber" />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
        <span>
          Lead BD: <strong>{result.bdLeadsNew}</strong> baru, <strong>{result.bdLeadsUpdated}</strong> diperbarui
        </span>
        <span>
          Alert: <strong>{result.alerts.bocor}</strong> bocor · <strong>{result.alerts.dealExpiring}</strong> deal
          hampir habis · <strong>{result.alerts.dealExpired}</strong> deal kadaluarsa masih transaksi
        </span>
        <span>
          Baris detail bocor: <strong>{result.detailRows.toLocaleString("id-ID")}</strong> (tidak disimpan di DB —
          lihat backup CSV)
        </span>
      </div>

      {result.exports.length > 0 && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Backup CSV</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {result.exports.map((f) =>
              f.url ? (
                <a
                  key={f.kind}
                  href={f.url}
                  download={f.filename}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  ⬇ {f.label} ({f.rows.toLocaleString("id-ID")} baris)
                </a>
              ) : (
                <span key={f.kind} className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">
                  {f.label}: gagal disimpan
                </span>
              )
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Tautan berlaku 1 jam. File tersimpan di penyimpanan privat platform dan bisa diunduh
            lagi dari daftar &quot;Backup CSV Analisa&quot; di halaman Link Leakage.
          </p>
        </div>
      )}

      {result.creators.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Kreator</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total Affiliate</th>
                <th className="px-3 py-2 text-right">TAP</th>
                <th className="px-3 py-2 text-right">Bocor (produk)</th>
                <th className="px-3 py-2 text-right">Bocor (shop)</th>
                <th className="px-3 py-2 text-right">Rasio</th>
                <th className="px-3 py-2 text-right">Peluang BD</th>
                <th className="px-3 py-2 text-right">Efektivitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.creators.map((c) => (
                <tr key={c.creatorId}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {c.creatorName}
                    {c.createdProspect && (
                      <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-700">baru</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLES[c.linkStatus] ?? ""}`}
                    >
                      {STATUS_LABELS[c.linkStatus] ?? c.linkStatus}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{rupiah(c.gmvAffiliateTotal)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{rupiah(c.gmvTap)}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-700">{rupiah(c.gmvBocor)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{rupiah(c.gmvBocorShopBasis)}</td>
                  <td className="px-3 py-2 text-right">{pct(c.leakRatio)}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{rupiah(c.bdOpportunityGmv)}</td>
                  <td className="px-3 py-2 text-right">{pct(c.effectiveness)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.bdShopsTop.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">
            Top {result.bdShopsTop.length} peluang BD (shop tanpa deal aktif)
          </summary>
          <div className="mt-2 overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-left uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Shop</th>
                  <th className="px-3 py-2">Kategori</th>
                  <th className="px-3 py-2 text-right">GMV Peluang</th>
                  <th className="px-3 py-2 text-right">Kreator</th>
                  <th className="px-3 py-2 text-right">Produk</th>
                  <th className="px-3 py-2">Status Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.bdShopsTop.map((s) => (
                  <tr key={s.shopId}>
                    <td className="px-3 py-2">
                      {s.shopName ?? "—"}
                      <span className="block font-mono text-[10px] text-slate-400">{s.shopId}</span>
                    </td>
                    <td className="px-3 py-2">
                      {[s.level1Category, s.level2Category].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-amber-700">{rupiah(s.gmv)}</td>
                    <td className="px-3 py-2 text-right">{s.creators.length}</td>
                    <td className="px-3 py-2 text-right">{s.products}</td>
                    <td className="px-3 py-2">
                      {s.dealState === "expired" ? "deal kadaluarsa" : "belum ada deal"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {result.warnings.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">Catatan ({result.warnings.length})</p>
          <ul className="mt-1 list-inside list-disc">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.skipped.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-amber-700">
            {result.skipped.length} baris dilewati saat parsing
          </summary>
          <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
            {result.skipped.slice(0, 50).map((s, i) => (
              <li key={i}>
                {s.row > 0 ? `Baris ${s.row}: ` : ""}
                {s.reason}
              </li>
            ))}
            {result.skipped.length > 50 && <li>… {result.skipped.length - 50} lainnya</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone = "ink",
  note,
}: {
  label: string;
  value: string;
  tone?: "ink" | "green" | "red" | "amber";
  note?: string;
}) {
  const border = {
    ink: "border-l-slate-800",
    green: "border-l-green-600",
    red: "border-l-red-600",
    amber: "border-l-amber-500",
  }[tone];
  const text = {
    ink: "text-slate-800",
    green: "text-green-700",
    red: "text-red-700",
    amber: "text-amber-700",
  }[tone];
  return (
    <div className={`rounded-md border border-slate-200 border-l-4 bg-white px-3 py-2 ${border}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 font-mono text-base font-bold ${text}`}>{value}</p>
      {note && <p className="mt-0.5 text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}
