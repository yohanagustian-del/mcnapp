import * as XLSX from "xlsx";
import { IMPORT_COLUMNS } from "./import-spec";

export const TEMPLATE_FILENAME = "template_kreator.xlsx";

/** Jumlah baris contoh kosong di bawah header, siap diisi user. */
const EXAMPLE_ROWS = 2;

/**
 * Bangun file template import kreator (.xlsx) dari `IMPORT_COLUMNS` — satu
 * sumber kebenaran yang sama dengan parser, jadi template selalu cocok dengan
 * apa yang bisa dibaca sistem.
 *
 * Dua sheet:
 *  - "Kreator"  : header + baris contoh kosong. Kolom wajib ditandai "*".
 *  - "Petunjuk" : legenda + keterangan format tiap kolom (WAJIB / opsional).
 *
 * Penandaan wajib memakai "*" di header, bukan bold: penulisan style sel tidak
 * tersedia di build xlsx komunitas, dan parser menormalisasi header sehingga
 * "Username*" tetap terbaca sebagai kolom username.
 */
export function buildCreatorTemplate(cmNames: string[] = []): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header = IMPORT_COLUMNS.map((c) => c.label);
  const blank = header.map(() => "");
  const sheet = XLSX.utils.aoa_to_sheet([header, ...Array.from({ length: EXAMPLE_ROWS }, () => [...blank])]);
  sheet["!cols"] = IMPORT_COLUMNS.map((c) => ({ wch: Math.max(12, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, sheet, "Kreator");

  const guide: string[][] = [
    ["PETUNJUK PENGISIAN TEMPLATE IMPORT KREATOR"],
    [],
    ["Kolom bertanda * WAJIB diisi. Baris dengan kolom wajib kosong akan ditolak."],
    ["Username dipakai sebagai kunci: sudah ada di sistem -> CM-nya diganti dengan CM di file."],
    ["Username belum ada -> kreator baru dibuat."],
    ["Kolom opsional yang dikosongkan TIDAK menghapus data lama."],
    ["Isi data mulai baris ke-2 di sheet 'Kreator'. Jangan mengubah baris header."],
    ["Tidak ada kolom Niche: niche diisi otomatis dari upload data platform mingguan."],
    [],
    ["Kolom", "Wajib", "Keterangan"],
    ...IMPORT_COLUMNS.map((c) => [c.label, c.required ? "WAJIB" : "opsional", c.note]),
  ];

  if (cmNames.length > 0) {
    guide.push([], ["Nama CM yang terdaftar (salin persis ke kolom CM*)"], ...cmNames.map((n) => [n]));
  }

  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 18 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
