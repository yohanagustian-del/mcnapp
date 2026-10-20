import { SKIP_REASON_LABEL } from "@/lib/deals/bulk-deal-spec";
import type { BulkDealPlan } from "@/lib/deals/bulk-deal-plan";
import { formatDiffValue, refSummary, replaceProposal } from "@/lib/deals/bulk-deal-report";
import { dealStatusLabel } from "@/lib/deals/deal-status";

/**
 * Tampilan BulkDealPlan — dipakai panel Import (/deals/import) dan halaman preview
 * (/deals/import/preview). Tanpa hook: bisa dirender dari server maupun client.
 */

type Cell = string | number | null | undefined;

function Table({ head, rows, empty = "Tidak ada." }: { head: string[]; rows: Cell[][]; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="max-h-[480px] overflow-auto rounded-md border border-slate-200">
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-50 text-slate-600">
          <tr>{head.map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="px-2 py-1 align-top">{c ?? "—"}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, count, tone = "slate", open, children }: {
  title: string; count: number; tone?: "slate" | "amber" | "red"; open?: boolean; children: React.ReactNode;
}) {
  const badge = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-100 text-amber-800", red: "bg-red-100 text-red-700" }[tone];
  return (
    <details open={open} className="rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-medium text-slate-800">
        {title} <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${badge}`}>{count}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function BulkPlanView({ plan, envRowCount, envLabel, refs }: {
  plan: BulkDealPlan;
  envRowCount: number;
  envLabel: string;
  /** id brand_deals → referensi FK (untuk bagian baris yang tidak ada di sheet). */
  refs?: Record<string, Record<string, number>>;
}) {
  const unmatchedBizdev = plan.bizdevNames.filter((n) => !n.memberId);
  const unmatchedOps = plan.campaignOpsNames.filter((n) => !n.memberId);
  const handlerSkips = plan.handlers.filter((h) => !h.apply);
  const stat = (label: string, v: number, tone = "text-slate-900") => (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{v.toLocaleString("id-ID")}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stat(`Baris di ${envLabel}`, envRowCount)}
        {stat("Insert", plan.inserts.length, "text-green-700")}
        {stat("Update", plan.updates.length, "text-blue-700")}
        {stat("Tidak berubah", plan.unchanged.length)}
        {stat("Skip (konfirmasi tim)", plan.skipped.length, "text-amber-700")}
        {stat(`Ada di ${envLabel}, tidak di sheet`, plan.missingFromSheet.length, "text-red-700")}
      </div>

      <h2 className="pt-2 text-base font-semibold">Perlu konfirmasi tim</h2>
      <Section title="Baris di-skip (duplikat persis / tanpa Shop ID / tanpa nama)" count={plan.skipped.length} tone="amber" open>
        <Table
          head={["Baris", "Brand", "Shop ID", "Alasan", "Baris kembar"]}
          rows={plan.skipped.map((s) => [s.sheetRow, s.brandName || "(kosong)", s.shopId || "(kosong)", SKIP_REASON_LABEL[s.reason], s.otherRows?.join(", ")])}
        />
      </Section>
      <Section title="Ads Brand lama di luar daftar (tidak dipetakan)" count={plan.adsOutOfList.length} tone="amber">
        <Table head={["Baris", "Brand", "Shop ID", "Nilai lama"]} rows={plan.adsOutOfList.map((a) => [a.sheetRow, a.brandName, a.shopId, a.value])} />
      </Section>
      <Section title="Ads Brand perlu dipasang ke Project BD (project tidak dibuat otomatis)" count={plan.adsNeedsProject.length} tone="amber">
        <Table head={["Baris", "Brand", "Shop ID", "Ads Brand"]} rows={plan.adsNeedsProject.map((a) => [a.sheetRow, a.brandName, a.shopId, a.value])} />
      </Section>
      <Section title="Nama Bizdev / Campaign Ops tidak cocok" count={unmatchedBizdev.length + unmatchedOps.length} tone="amber">
        <Table
          head={["Kolom", "Nama di sheet", "Status", "Kandidat (tidak dipakai otomatis)"]}
          rows={[
            ...unmatchedBizdev.map((n) => ["Bizdev", n.name, n.inactive ? "nonaktif" : "tidak ditemukan", n.candidates.join("; ")]),
            ...unmatchedOps.map((n) => ["Campaign Ops", n.name, n.inactive ? "nonaktif" : "tidak ditemukan", n.candidates.join("; ")]),
          ]}
        />
        {handlerSkips.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-xs text-slate-600">
              BizDev handler {handlerSkips.length} shop TIDAK ditulis (nama tak cocok / &gt;2 BizDev di shop bersama); handler lama dibiarkan.
            </p>
            <Table
              head={["Shop ID", "Brand", "Tidak cocok", "Konflik >2"]}
              rows={handlerSkips.map((h) => [h.shopId, h.brands.join(" / "), h.unmatched.join(", "), h.conflict ? "ya" : ""])}
            />
          </div>
        )}
      </Section>
      <Section title="Usulan penggabungan niche (tidak digabung otomatis)" count={plan.nicheMergeProposals.length + plan.nicheEmpty.length} tone="amber">
        <Table head={["Nilai sheet", "Usulan", "Jumlah brand", "Catatan"]} rows={plan.nicheMergeProposals.map((n) => [n.from, n.to, n.count, n.note])} />
        <p className="mt-2 text-xs text-slate-600">Tanpa niche: {plan.nicheEmpty.map((n) => n.brandName).join(", ") || "—"}</p>
        {plan.nicheOutOfList.length > 0 && (
          <p className="mt-1 text-xs text-slate-600">
            Di luar daftar baku: {plan.nicheOutOfList.map((n) => `${n.brandName} (${n.value})`).join(", ")}
          </p>
        )}
      </Section>
      <Section title="Status kosong → NULL" count={plan.statusNull.length} tone="amber">
        <Table head={["Baris", "Brand", "Shop ID"]} rows={plan.statusNull.map((s) => [s.sheetRow, s.brandName, s.shopId])} />
      </Section>
      <Section title="Peringatan per baris (tetap dimuat)" count={plan.warnings.length}>
        <Table head={["Baris", "Brand", "Peringatan"]} rows={plan.warnings.map((w) => [w.sheetRow, w.brandName, w.message])} />
      </Section>

      <h2 className="pt-2 text-base font-semibold">Perubahan data</h2>
      <Section title={`Ada di ${envLabel} tapi tidak di sheet (kandidat soft-deactivate saat Promote)`} count={plan.missingFromSheet.length} tone="red">
        <Table
          head={["ID", "Brand", "Shop ID", "Status", "Referensi FK", "Usulan"]}
          rows={plan.missingFromSheet.map((m) => [
            m.id, m.brand_name, m.shop_id ?? "(kosong)", dealStatusLabel(m.status as string | null),
            refs ? refSummary(refs[m.id]) : "—", refs ? replaceProposal(m, refs[m.id]) : "—",
          ])}
        />
      </Section>
      <Section title="Update — diff per field" count={plan.updates.length}>
        <Table
          head={["ID", "Brand", "Shop ID", "Field", "Sebelum", "Sesudah"]}
          rows={plan.updates.flatMap((u) =>
            u.diffs.map((d) => [u.existingId, u.row.brandName, u.row.shopId, d.field, formatDiffValue(d, d.before), formatDiffValue(d, d.after)])
          )}
        />
      </Section>
      <Section title="Insert" count={plan.inserts.length}>
        <Table
          head={["Baris", "Brand", "Shop ID", "Status", "Niche", "Bizdev", "Exp Date"]}
          rows={plan.inserts.map((i) => [i.row.sheetRow, i.row.brandName, i.row.shopId, dealStatusLabel(i.row.status), i.row.niche, i.row.bizdevLabel, i.row.expDate])}
        />
      </Section>
    </div>
  );
}
