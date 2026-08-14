import * as XLSX from "xlsx";

/**
 * Template .xlsx untuk dua upload tracking report campaign BD (dipakai halaman
 * detail Deal Brand DAN detail Project BD — satu parser, satu template):
 *
 *  - "Report Performance" per sesi live  → uploadReportSessions
 *  - "Creator TC & Celeb"                → uploadReportCreators
 *
 * Header di sini HARUS menghasilkan kunci yang sama dengan yang dibaca parser
 * setelah normalisasi `normalizeHeader` (trim → huruf kecil → spasi jadi "_"),
 * karena parser membaca `nama_creator`, `tanggal_session_live`, `gmv_l30d`, dst.
 * secara langsung. Dijaga oleh test round-trip di __tests__/report-template.test.ts —
 * kalau ada yang mengganti nama kolom di salah satu sisi, testnya yang gagal, bukan
 * user yang menemukannya lewat upload 0 baris.
 */

export const REPORT_SESSION_TEMPLATE_FILENAME = "template_report_performance.xlsx";
export const REPORT_CREATOR_TEMPLATE_FILENAME = "template_creator_tc_celeb.xlsx";

/** Jumlah baris kosong di bawah header, siap diisi. */
const EXAMPLE_ROWS = 3;

export interface TemplateColumn {
  /** Header apa adanya yang ditulis ke file. */
  label: string;
  required: boolean;
  note: string;
}

/**
 * Kolom "Report Performance" per sesi live. `id` dan `Brand` ikut dibawa karena ada
 * di file asli tim (dan memudahkan menyalin), meski parser tidak memakainya —
 * pemilik baris ditentukan dari halaman tempat file diunggah, bukan dari isi file.
 */
export const REPORT_SESSION_COLUMNS: TemplateColumn[] = [
  { label: "id", required: false, note: "Opsional. Nomor urut/ID internal file — tidak dibaca sistem." },
  { label: "Brand", required: false, note: "Opsional. Nama brand — tidak dibaca sistem (pemiliknya deal/project tempat file diunggah)." },
  { label: "Nama Creator", required: true, note: "WAJIB. Username/nama creator. Baris tanpa kolom ini dilewati (termasuk baris TOTAL). Nama yang belum ada di master otomatis dibuat sebagai prospek + ditandai review." },
  { label: "Tanggal Session Live", required: false, note: "Tanggal sesi live. Format bebas yang lazim (2026-08-14, 14/08/2026, 14 August 2026). Boleh kosong ASAL GMV terisi." },
  { label: "Event", required: false, note: "Opsional. Payday / Reguler / Twindate / dst." },
  { label: "Support Ads", required: false, note: "Opsional. Teks bebas (mis. Ya / Tidak / MEA)." },
  { label: "Ads Spending", required: false, note: 'Ads spend dalam USD (mis. "$75.25" atau 75.25). "-" / kosong = tidak ada.' },
  { label: "IDR", required: false, note: 'Ads spend dalam Rupiah (mis. "Rp1,296,097" atau "Rp1.296.097"). Titik & koma ribuan sama-sama terbaca.' },
  { label: "SS Dashboard", required: false, note: "Opsional. Link/nama file screenshot dashboard." },
  { label: "GMV", required: true, note: 'WAJIB bila tanggal kosong. GMV sesi (mis. "Rp14,626,698"). Kosong dianggap 0.' },
  { label: "ROAS", required: false, note: "Opsional. Angka (mis. 11.29). Kosongkan bila tidak dihitung." },
];

/** Kolom daftar usulan creator campaign ("Creator TC & Celeb"). */
export const REPORT_CREATOR_COLUMNS: TemplateColumn[] = [
  { label: "Username", required: true, note: "WAJIB. Username creator. Baris tanpa kolom ini dilewati." },
  { label: "Link Profile", required: false, note: "Opsional. URL profil creator." },
  { label: "Creator Manager", required: false, note: "Opsional. Nama CM pemegang creator." },
  { label: "Tipe Kreator", required: false, note: 'Opsional. Mis. "TC", "Celeb", "Exclusive MEA". Mengandung kata "exclusive" → ditandai exclusive MEA.' },
  { label: "Channel", required: false, note: "Opsional. Live / Video / keduanya." },
  { label: "GMV L30D", required: false, note: "Opsional. GMV 30 hari terakhir (Rupiah, format campur aman)." },
  { label: "Creator Requirement", required: false, note: 'Opsional. Syarat dari brand. Mengandung "exclusive" → ditandai exclusive MEA.' },
  { label: "Ratecard Live", required: false, note: "Opsional. Ratecard live (teks bebas, boleh rentang)." },
  { label: "Ratecard VT", required: false, note: "Opsional. Ratecard video (teks bebas)." },
  { label: "Link Produk", required: false, note: "Opsional. URL produk yang dibawakan." },
  { label: "Domisili", required: false, note: "Opsional. Kota/domisili creator." },
  { label: "Alamat", required: false, note: "Opsional. Alamat pengiriman sampel." },
  { label: "No HP", required: false, note: "Opsional. Nomor kontak." },
  { label: "Brand Approval", required: false, note: "Opsional. Status approval dari brand." },
  { label: "Creator Approval", required: false, note: "Opsional. Status approval dari creator." },
  { label: "Status Pengiriman", required: false, note: "Opsional. Status kirim sampel." },
  { label: "No Resi", required: false, note: "Opsional. Nomor resi pengiriman." },
  { label: "Notes", required: false, note: "Opsional. Catatan bebas." },
  { label: "Link VT", required: false, note: "Opsional. Link video hasil." },
  { label: "Boost Code", required: false, note: "Opsional. Kode boost/ads." },
];

/**
 * Bangun satu file template: sheet data (header + baris kosong) + sheet Petunjuk.
 * Bentuknya sengaja sama dengan template upload anggota tim supaya user tim
 * mengenali polanya.
 */
function buildTemplate(
  columns: TemplateColumn[],
  sheetName: string,
  title: string,
  extraGuide: string[],
): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header = columns.map((c) => c.label);
  const blank = header.map(() => "");
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    ...Array.from({ length: EXAMPLE_ROWS }, () => [...blank]),
  ]);
  sheet["!cols"] = columns.map((c) => ({ wch: Math.max(14, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);

  const required = columns.filter((c) => c.required).map((c) => c.label);
  const guide: string[][] = [
    [title],
    [],
    [`Kolom wajib: ${required.join(", ")}.`],
    [`Isi data mulai baris ke-2 di sheet '${sheetName}'. Jangan mengubah atau menerjemahkan baris header.`],
    ["Baris yang seluruh kolomnya kosong otomatis dilewati, jadi baris contoh boleh dibiarkan."],
    ...extraGuide.map((line) => [line]),
    [],
    ["Kolom", "Wajib", "Keterangan"],
    ...columns.map((c) => [c.label, c.required ? "WAJIB" : "opsional", c.note]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 24 }, { wch: 10 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function buildReportSessionTemplate(): ArrayBuffer {
  return buildTemplate(
    REPORT_SESSION_COLUMNS,
    "Report Performance",
    "TEMPLATE UPLOAD REPORT PERFORMANCE (per sesi live)",
    [
      "Upload ulang MENGGANTI seluruh baris hasil upload sebelumnya untuk deal/project ini; baris yang diinput manual lewat form tidak ikut terhapus.",
      "Rupiah boleh memakai titik ATAU koma sebagai pemisah ribuan — keduanya terbaca.",
      'Baris "TOTAL" di akhir file tidak perlu dihapus: baris tanpa Nama Creator otomatis dilewati.',
    ],
  );
}

export function buildReportCreatorTemplate(): ArrayBuffer {
  return buildTemplate(
    REPORT_CREATOR_COLUMNS,
    "Creator TC & Celeb",
    "TEMPLATE UPLOAD DAFTAR CREATOR CAMPAIGN (TC & Celeb)",
    [
      "Upload ulang MENGGANTI seluruh daftar hasil upload sebelumnya untuk deal/project ini.",
      'Baris anotasi di bawah header ("CM", "Otomatis", "Campaign", "Brand") otomatis dilewati.',
    ],
  );
}
