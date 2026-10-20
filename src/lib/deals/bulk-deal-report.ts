import { SKIP_REASON_LABEL, formatSupportTypes } from "./bulk-deal-spec";
import { SENSITIVE_FIELDS, type BulkDealPlan, type ExistingDeal, type FieldDiff } from "./bulk-deal-plan";
import { dealStatusLabel } from "./deal-status";

/**
 * Laporan dry-run Import Bulk Deal Brand (markdown). Pure — dipakai
 * scripts/mcn-bulkload-dryrun.ts; isi sama dengan halaman /deals/import/preview
 * karena keduanya membaca BulkDealPlan yang sama.
 */

export interface DryRunMeta {
  sheetName: string;
  envLabel: string;
  generatedAt: string;
  sheetDataRows: number;
  envRowCount: number;
  /** id brand_deals → jumlah referensi FK per tabel. */
  refs: Record<string, Record<string, number>>;
  /** shop_id → nama BizDev handler yang ada sekarang di environment. */
  handlers: Record<string, string[]>;
}

const esc = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function formatDiffValue(d: Pick<FieldDiff, "field">, v: unknown): string {
  if (SENSITIVE_FIELDS.includes(d.field)) return v === null || v === undefined || v === "" ? "—" : "(ada, disembunyikan)";
  if (v === null || v === undefined || v === "") return "—";
  if (d.field === "status") return dealStatusLabel(String(v));
  if (d.field === "support_types") return formatSupportTypes(v as string[]);
  return String(v);
}

function table(head: string[], rows: (string | number | null | undefined)[][]): string {
  if (rows.length === 0) return "_(tidak ada)_\n";
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n") + "\n";
}

export function refSummary(refs: Record<string, number> | undefined): string {
  const e = Object.entries(refs ?? {}).filter(([, n]) => n > 0);
  return e.length ? e.map(([t, n]) => `${t}: ${n}`).join(", ") : "—";
}

export function replaceProposal(row: ExistingDeal, refs: Record<string, number> | undefined): string {
  return Object.values(refs ?? {}).some((n) => n > 0) ? "soft-deactivate (masih direferensikan)" : "boleh dihapus / dinonaktifkan";
}

export function buildDryRunMarkdown(plan: BulkDealPlan, meta: DryRunMeta): string {
  const out: string[] = [];
  const p = (s = "") => out.push(s);
  p(`# Dry-run Import Bulk Deal Brand — ${meta.generatedAt.slice(0, 10)}`);
  p();
  p(`- Sumber: ${meta.sheetName}`);
  p(`- Dibandingkan dengan: **${meta.envLabel}** (SELECT read-only, tidak ada yang ditulis)`);
  p(`- Dibuat: ${meta.generatedAt}`);
  p(`- Kunci upsert: (platform, shop_id, trim(brand_name)), case-sensitive`);
  p();
  p("## Ringkasan");
  p(
    table(
      ["Item", "Jumlah"],
      [
        ["Baris data di sheet", meta.sheetDataRows],
        [`Baris brand_deals di ${meta.envLabel} sekarang`, meta.envRowCount],
        ["Akan di-INSERT", plan.inserts.length],
        ["Akan di-UPDATE", plan.updates.length],
        ["Sama persis (tidak berubah)", plan.unchanged.length],
        ["Di-SKIP (perlu konfirmasi tim)", plan.skipped.length],
        [`Baris ${meta.envLabel} yang tidak ada di sheet`, plan.missingFromSheet.length],
        ["Status kosong → NULL", plan.statusNull.length],
        ["Ads Brand di luar daftar", plan.adsOutOfList.length],
        ["Ads Brand perlu dipasang ke Project BD", plan.adsNeedsProject.length],
        ["Nama Bizdev tidak cocok", plan.bizdevNames.filter((n) => !n.memberId).length],
        ["Nama Campaign Ops tidak cocok", plan.campaignOpsNames.filter((n) => !n.memberId).length],
      ]
    )
  );

  p("## 1. Perlu konfirmasi tim — baris di-SKIP");
  p(
    table(
      ["Baris sheet", "Brand", "Shop ID", "Alasan", "Baris kembar"],
      plan.skipped.map((s) => [s.sheetRow, s.brandName || "(kosong)", s.shopId || "(kosong)", SKIP_REASON_LABEL[s.reason], s.otherRows?.join(", ") ?? ""])
    )
  );

  p("## 2. Status kosong (disimpan NULL)");
  p(table(["Baris", "Brand", "Shop ID"], plan.statusNull.map((s) => [s.sheetRow, s.brandName, s.shopId])));

  p("## 3. Ads Brand");
  p("### 3a. Nilai lama di luar daftar pilihan (dilaporkan, tidak dipetakan)");
  p(table(["Baris", "Brand", "Shop ID", "Nilai lama"], plan.adsOutOfList.map((a) => [a.sheetRow, a.brandName, a.shopId, a.value])));
  p("### 3b. Perlu dipasang ke Project BD (shop belum ada di Project BD mana pun — project TIDAK dibuat otomatis)");
  p(table(["Baris", "Brand", "Shop ID", "Ads Brand"], plan.adsNeedsProject.map((a) => [a.sheetRow, a.brandName, a.shopId, a.value])));

  p("## 4. Nama Bizdev & Campaign Ops");
  p("Dicocokkan PERSIS (tanpa beda huruf besar/kecil) ke team_members. Kandidat hanya saran — tidak dipakai otomatis.");
  p(
    table(
      ["Kolom", "Nama di sheet", "Cocok", "Kandidat"],
      [
        ...plan.bizdevNames.map((n) => ["Bizdev", n.name, n.memberId ? "ya" : n.inactive ? "nonaktif" : "TIDAK", n.candidates.join("; ")]),
        ...plan.campaignOpsNames.map((n) => ["Campaign Ops", n.name, n.memberId ? "ya" : n.inactive ? "nonaktif" : "TIDAK", n.candidates.join("; ")]),
      ]
    )
  );
  p("### 4a. BizDev handler per shop yang TIDAK ditulis (nama tak cocok / >2 BizDev di shop bersama)");
  p(
    table(
      ["Shop ID", "Brand", "Tidak cocok", "Konflik >2", `Handler ${meta.envLabel} sekarang`],
      plan.handlers
        .filter((h) => !h.apply)
        .map((h) => [h.shopId, h.brands.join(" / "), h.unmatched.join(", "), h.conflict ? "ya" : "", (meta.handlers[h.shopId] ?? []).join(", ")])
    )
  );

  p("## 5. Niche");
  p("### 5a. Usulan penggabungan ejaan (TIDAK digabung otomatis)");
  p(table(["Nilai sheet", "Usulan", "Jumlah brand", "Catatan"], plan.nicheMergeProposals.map((n) => [n.from, n.to, n.count, n.note])));
  p("### 5b. Brand tanpa niche");
  p(table(["Baris", "Brand", "Shop ID"], plan.nicheEmpty.map((n) => [n.sheetRow, n.brandName, n.shopId])));
  if (plan.nicheOutOfList.length) {
    p("### 5c. Niche di luar daftar baku");
    p(table(["Baris", "Brand", "Niche"], plan.nicheOutOfList.map((n) => [n.sheetRow, n.brandName, n.value])));
  }
  if (plan.leadsOutOfList.length) {
    p("### 5d. Leads di luar daftar");
    p(table(["Baris", "Brand", "Leads"], plan.leadsOutOfList.map((n) => [n.sheetRow, n.brandName, n.value])));
  }

  p("## 6. Peringatan per baris (tetap dimuat)");
  p(table(["Baris", "Brand", "Peringatan"], plan.warnings.map((w) => [w.sheetRow, w.brandName, w.message])));

  p(`## 7. Baris ${meta.envLabel} yang TIDAK ada di sheet (kandidat dihapus / dinonaktifkan)`);
  p("Baris yang masih direferensikan FK TIDAK boleh di-hard-delete → usulan soft-deactivate (`deactivated_at`).");
  p(
    table(
      ["ID", "Brand", "Shop ID", "Status", "Referensi FK", "Usulan"],
      plan.missingFromSheet.map((m) => [m.id, m.brand_name, m.shop_id ?? "(kosong)", dealStatusLabel(m.status as string | null), refSummary(meta.refs[m.id]), replaceProposal(m, meta.refs[m.id])])
    )
  );

  p("## 8. UPDATE — diff per field");
  p(
    table(
      ["ID", "Brand", "Shop ID", "Field", "Sebelum", "Sesudah"],
      plan.updates.flatMap((u) =>
        u.diffs.map((d) => [u.existingId, u.row.brandName, u.row.shopId, d.field, formatDiffValue(d, d.before), formatDiffValue(d, d.after)])
      )
    )
  );

  p("## 9. INSERT");
  p(
    table(
      ["Baris", "Brand", "Shop ID", "Status", "Niche", "Bizdev", "Exp Date"],
      plan.inserts.map((i) => [i.row.sheetRow, i.row.brandName, i.row.shopId, dealStatusLabel(i.row.status), i.row.niche ?? "—", i.row.bizdevLabel ?? "—", i.row.expDate ?? "—"])
    )
  );

  p("## Langkah yang menunggu persetujuan Yohan");
  p("1. Apply migrasi 0097 ke produksi (sudah di staging).");
  p("2. \"Promote ke Produksi\": replace brand_deals produksi dengan isi sheet + soft-deactivate baris di bagian 7.");
  p("3. Apply migrasi 0098 (unique index) SETELAH data bersih.");
  p("4. Ubah role akun Campaign Ops (lihat docs/reports/mcn-todo-tim-21okt.md).");
  return out.join("\n");
}
