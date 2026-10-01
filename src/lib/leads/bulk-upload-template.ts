import * as XLSX from "xlsx";
import { BRAND_LEAD_UPLOAD_COLUMNS } from "./bulk-upload-spec";

export const BRAND_LEAD_TEMPLATE_FILENAME = "template_brand_lead_bank.xlsx";
export const BRAND_LEAD_TEMPLATE_SHEET = "Brand Lead";

const EXAMPLE_ROWS = 3;

/**
 * Template upload massal Brand Lead Bank (.xlsx), built from
 * `BRAND_LEAD_UPLOAD_COLUMNS` — the same list the parser reads (pattern of
 * partnership-template.ts), guarded by a round-trip test. The first 8 columns
 * follow the BizDev matchmaking sheet, so that sheet can also be uploaded as is.
 */
export function buildBrandLeadTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header = BRAND_LEAD_UPLOAD_COLUMNS.map((c) => c.label);
  const blank = header.map(() => "");
  const sheet = XLSX.utils.aoa_to_sheet([header, ...Array.from({ length: EXAMPLE_ROWS }, () => [...blank])]);
  sheet["!cols"] = BRAND_LEAD_UPLOAD_COLUMNS.map((c) => ({ wch: Math.max(14, Math.min(40, c.label.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, sheet, BRAND_LEAD_TEMPLATE_SHEET);

  const guide: string[][] = [
    ["PETUNJUK PENGISIAN TEMPLATE BRAND LEAD BANK"],
    [],
    [`Isi data mulai baris ke-2 di sheet '${BRAND_LEAD_TEMPLATE_SHEET}'. Spreadsheet matchmaking yang sudah ada boleh langsung diupload (baris judul seperti "Bizdev" di atas header dilewati otomatis).`],
    ["Setiap baris minimal berisi Nama Brand ATAU Contact PIC Brand. Baris tanpa keduanya dilewati."],
    ["Asal Lead (Matchmaking/Event/…) dipilih sekali di form upload dan berlaku untuk semua baris. Status lead baru = Baru."],
    ["Brand yang sudah ada di Brand Lead Bank tidak dibuat dua kali: kontak baru & kolom yang masih kosong ditambahkan, isi lama TIDAK ditimpa."],
    [],
    ["Kolom", "Keterangan"],
    ...BRAND_LEAD_UPLOAD_COLUMNS.map((c) => [c.label, c.note]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 42 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
