import * as XLSX from "xlsx";
import { ROLES } from "@/lib/rbac";
import { ROLE_TEAM_GROUP, SEGMENTS, TEAM_GROUPS } from "./roles";

export const TEAM_TEMPLATE_FILENAME = "template_tim.xlsx";

/** Jumlah baris contoh kosong di bawah header, siap diisi user. */
const EXAMPLE_ROWS = 2;

export interface TeamColumn {
  /**
   * Header yang ditulis ke template. HARUS persis sama dengan key yang dibaca
   * `uploadTeamMembers` setelah normalisasi parseSheet (huruf kecil, spasi → "_"),
   * karena parser membaca `raw.name` / `raw.email` / dst. secara langsung.
   * Karena itu kolom wajib TIDAK ditandai "*" di header — penanda wajib ada di
   * sheet "Petunjuk". Dijaga oleh test round-trip.
   */
  label: string;
  required: boolean;
  note: string;
}

export const TEAM_COLUMNS: TeamColumn[] = [
  {
    label: "name",
    required: true,
    note: "WAJIB. Nama lengkap anggota tim. Nama ini yang dipakai saat mencocokkan kolom CM di import kreator, jadi tulis persis seperti yang akan dipakai di sheet lain.",
  },
  {
    label: "email",
    required: true,
    note: "WAJIB. Email unik — dipakai sebagai akun login (auth user dibuat otomatis). Email yang sudah terdaftar akan dilewati, bukan dibuat ganda.",
  },
  {
    label: "role",
    required: true,
    note: `WAJIB. Salah satu: ${ROLES.join(", ")}. Catatan: 'cm' BUKAN role — untuk tim CM pakai 'cpm' atau 'cm_lead'.`,
  },
  {
    label: "team_group",
    required: false,
    note: `Opsional — dikosongkan saja, sistem mengisinya otomatis dari role. Kalau diisi: ${TEAM_GROUPS.join(", ")}.`,
  },
  {
    label: "platform_segment",
    required: false,
    note: `Opsional. Salah satu: ${SEGMENTS.join(", ")}. Kosongkan bila tidak spesifik ke satu platform.`,
  },
];

/**
 * Bangun file template upload anggota tim (.xlsx).
 *
 * Tiga sheet:
 *  - "Tim"       : header + baris contoh kosong, siap diisi.
 *  - "Petunjuk"  : kolom mana yang wajib + format tiap kolom.
 *  - "Ref Role"  : daftar role valid beserta team_group otomatisnya, supaya user
 *                  tidak menebak-nebak dan salah ketik role.
 */
export function buildTeamTemplate(): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  const header = TEAM_COLUMNS.map((c) => c.label);
  const blank = header.map(() => "");
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    ...Array.from({ length: EXAMPLE_ROWS }, () => [...blank]),
  ]);
  sheet["!cols"] = TEAM_COLUMNS.map((c) => ({ wch: Math.max(16, c.label.length + 4) }));
  XLSX.utils.book_append_sheet(wb, sheet, "Tim");

  const required = TEAM_COLUMNS.filter((c) => c.required).map((c) => c.label);
  const guide: string[][] = [
    ["PETUNJUK PENGISIAN TEMPLATE UPLOAD ANGGOTA TIM"],
    [],
    [`Kolom wajib: ${required.join(", ")}. Baris dengan kolom wajib kosong akan dilewati.`],
    ["Isi data mulai baris ke-2 di sheet 'Tim'. Jangan mengubah atau menerjemahkan baris header."],
    ["Baris yang seluruh kolomnya kosong otomatis dilewati, jadi baris contoh boleh dibiarkan."],
    ["Email yang sudah terdaftar dilewati (tidak dibuat ganda, tidak menimpa data lama)."],
    ["Setiap anggota baru otomatis dibuatkan akun login dari email-nya."],
    [],
    ["Kolom", "Wajib", "Keterangan"],
    ...TEAM_COLUMNS.map((c) => [c.label, c.required ? "WAJIB" : "opsional", c.note]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guide);
  guideSheet["!cols"] = [{ wch: 20 }, { wch: 10 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, "Petunjuk");

  const roleRef: string[][] = [
    ["Daftar role valid — salin persis ke kolom 'role'"],
    [],
    ["role", "team_group otomatis"],
    ...ROLES.map((r) => [r, ROLE_TEAM_GROUP[r]]),
  ];
  const roleSheet = XLSX.utils.aoa_to_sheet(roleRef);
  roleSheet["!cols"] = [{ wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, roleSheet, "Ref Role");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
