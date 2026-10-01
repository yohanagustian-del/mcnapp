import * as XLSX from "xlsx";
import {
  FEE_AGREEMENT_STATUSES,
  PARTNERSHIP_COLUMNS,
  PARTNERSHIP_STATUSES,
  type PartnershipStatusLabels,
} from "./partnership-spec";

export const PARTNERSHIP_TEMPLATE_FILENAME = "template_status_kemitraan.xlsx";

const EXAMPLE_ROWS = 2;

/**
 * Template upload status kemitraan (.xlsx), built from `PARTNERSHIP_COLUMNS` — the same
 * list the parser reads (pattern of import-template.ts), guarded by a round-trip test.
 *
 * Sheets: "Status Kemitraan" (header + blank rows) and "Petunjuk" (rules + the meaning
 * of each status from app_config m8.partnership_status_labels).
 */
export function buildPartnershipTemplate(labels: PartnershipStatusLabels): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header = PARTNERSHIP_COLUMNS.map((c) => c.label);
  const blank = header.map(() => "");
  const sheet = XLSX.utils.aoa_to_sheet([header, ...Array.from({ length: EXAMPLE_ROWS }, () => [...blank])]);
  sheet["!cols"] = PARTNERSHIP_COLUMNS.map((c) => ({ wch: Math.max(14, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, sheet, "Status Kemitraan");

  const guide: string[][] = [
    ["PETUNJUK PENGISIAN TEMPLATE STATUS KEMITRAAN"],
    [],
    ["Kolom bertanda * WAJIB diisi. Isi data mulai baris ke-2 di sheet 'Status Kemitraan'."],
    ["Username dicocokkan ke kreator yang SUDAH terdaftar (per platform). Username yang tidak ditemukan dilewati."],
    ["Kolom status yang dikosongkan TIDAK mengubah status lama."],
    ["Fee Agreement hanya berlaku untuk TikTok — Shopee hanya punya Management Partnership."],
    [],
    ["Arti status Management Partnership:"],
    ...PARTNERSHIP_STATUSES.map((s) => [`  - ${labels.partnership[s].label}: ${labels.partnership[s].meaning}`]),
    [],
    ["Arti status Fee Agreement (TikTok):"],
    ...FEE_AGREEMENT_STATUSES.map((s) => [`  - ${labels.fee_agreement[s].label}: ${labels.fee_agreement[s].meaning}`]),
    [],
    ["Kolom", "Wajib", "Keterangan"],
    ...PARTNERSHIP_COLUMNS.map((c) => [c.label, c.required ? "WAJIB" : "opsional", c.note]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 24 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
