import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";

/**
 * Bulk import kreator lewat Excel (tab Kreator → "Import Kreator").
 *
 * Satu sumber kebenaran untuk kolom template DAN parser file yang diunggah —
 * template yang di-download dan validator yang membaca file kembali memakai
 * daftar `IMPORT_COLUMNS` yang sama, jadi keduanya tidak bisa hanyut.
 *
 * Kolom wajib: Username + CM. Sisanya opsional; kolom opsional yang kosong
 * TIDAK menimpa data lama saat update (lihat `buildPayload`).
 *
 * CM di file adalah NAMA (mis. "Netta") → di-resolve ke team_members.id
 * (creators.owner_cpm_id). Nama CM yang tidak dikenal = baris error, bukan
 * diam-diam dikosongkan.
 */

const PLATFORMS = ["tiktok", "shopee"] as const;
const STATUSES = ["prospek", "binding", "aktif", "nonaktif"] as const;

export interface ImportColumn {
  /** Header yang ditulis ke file template (dan dipakai sebagai judul kolom preview). */
  label: string;
  /** Bentuk kanonik header yang diterima saat membaca file (lihat `canonicalHeader`). */
  aliases: string[];
  required: boolean;
  /** Keterangan format untuk sheet "Petunjuk". */
  note: string;
}

/** Urutan di sini = urutan kolom di file template dan di tabel preview. */
export const IMPORT_COLUMNS: ImportColumn[] = [
  {
    label: "Username*",
    aliases: ["username", "usernametiktok", "handle"],
    required: true,
    note: "WAJIB. Handle akun tanpa @ (contoh: vikahere). Dipakai sebagai kunci pencocokan — sudah ada = CM-nya di-update, belum ada = kreator baru.",
  },
  {
    label: "CM*",
    aliases: ["cm", "creatormanager", "namacm", "cpm"],
    required: true,
    note: "WAJIB. Nama Creator Manager persis seperti terdaftar di menu Tim (contoh: Netta). Nama yang tidak terdaftar = baris ditolak.",
  },
  {
    label: "Nama Creator",
    aliases: ["namacreator", "name", "nama"],
    required: false,
    note: "Opsional. Kosong saat kreator baru dibuat → otomatis memakai Username.",
  },
  {
    label: "Kategory",
    aliases: ["kategory", "kategori", "jeniscreator", "jenis"],
    required: false,
    note: "Opsional. Contoh: Video Creator / Live Creator.",
  },
  {
    label: "Platform",
    aliases: ["platform"],
    required: false,
    note: "Opsional. tiktok atau shopee. Selain itu diabaikan.",
  },
  {
    label: "No HP",
    aliases: ["nohp", "phone", "notelp", "nowa"],
    required: false,
    note: "Opsional. Teks bebas (contoh: 08123456789).",
  },
  {
    label: "Link Akun",
    aliases: ["linkakun", "linkprofile", "profilelink"],
    required: false,
    note: "Opsional. URL profil kreator.",
  },
  {
    label: "UID",
    aliases: ["uid"],
    required: false,
    note: "Opsional. UID akun dari platform.",
  },
  {
    label: "Followers",
    aliases: ["followers", "follower", "followertier"],
    required: false,
    note: "Opsional. Teks bebas (contoh: 120K).",
  },
  {
    label: "Niche",
    aliases: ["niche", "niches", "topniches"],
    required: false,
    note: "Opsional. Pisahkan dengan koma / titik koma; 3 pertama disimpan sebagai top niche.",
  },
  {
    label: "Domisili",
    aliases: ["domisili", "kota"],
    required: false,
    note: "Opsional. Kota domisili kreator.",
  },
  {
    label: "Level",
    aliases: ["level", "levelcreator"],
    required: false,
    note: "Opsional. Angka 1–8. Di luar rentang itu diabaikan.",
  },
  {
    label: "RC Live",
    aliases: ["rclive", "ratecardlive"],
    required: false,
    note: "Opsional. Teks bebas.",
  },
  {
    label: "RC Video",
    aliases: ["rcvideo", "ratecardvideo", "ratecardvt"],
    required: false,
    note: "Opsional. Teks bebas.",
  },
  {
    label: "Rate Card",
    aliases: ["ratecard"],
    required: false,
    note: "Opsional. Rupiah — 'Rp1.500.000' / '1,500,000' / '1500000' semuanya diterima.",
  },
  {
    label: "Join Date",
    aliases: ["joindate", "tanggaljoin"],
    required: false,
    note: "Opsional. Tanggal — '2026-01-31' atau '31 January 2026'.",
  },
  {
    label: "Status",
    aliases: ["status"],
    required: false,
    note: `Opsional. Salah satu: ${STATUSES.join(", ")}. Kosong saat kreator baru → prospek.`,
  },
];

/**
 * Header yang dicari `parseSheet` untuk melewati baris judul di atas header.
 * Harus dalam bentuk normalisasi parseSheet (huruf kecil, spasi → "_"), BUKAN
 * bentuk kanonik: template menulis "Username*" → "username*", sedangkan file
 * buatan tangan biasanya "Username" → "username". Keduanya diterima.
 */
export const SHEET_REQUIRED_HEADERS = ["username*", "username"];

/**
 * Header sheet → bentuk kanonik untuk pencocokan: huruf kecil, hanya a-z0-9.
 * Membuat "No HP", "no_hp", "NO. HP" dan penanda wajib "Username*" semuanya
 * jatuh ke alias yang sama, jadi file hasil edit user tetap terbaca.
 */
export function canonicalHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Ambil nilai kolom dari satu baris sheet (header sudah dinormalisasi parseSheet). */
function cell(row: Record<string, string>, column: ImportColumn): string {
  for (const [key, value] of Object.entries(row)) {
    if (column.aliases.includes(canonicalHeader(key))) return String(value ?? "").trim();
  }
  return "";
}

/** "beauty; skincare, fashion" → maksimal 3 kategori. */
function parseNiches(raw: string): string[] | null {
  const parts = raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 3) : null;
}

/** "Lv 3" / "3" → 1..8; selain itu null. */
function parseLevel(raw: string): number | null {
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 8 ? n : null;
}

export type ImportRowStatus = "insert" | "update" | "error";

export interface ParsedImportRow {
  /** Nomor baris di file Excel (header = baris 1, jadi data pertama = 2). */
  rowNum: number;
  status: ImportRowStatus;
  /** Alasan baris ditolak — hanya terisi saat status "error". */
  errors: string[];
  username: string;
  cmName: string;
  /** team_members.id hasil resolve `cmName`; null saat error. */
  cmId: string | null;
  /** creators.id yang cocok dengan username — null berarti insert. */
  existingId: string | null;
  /** CM lama yang akan digantikan (baris update) — untuk ditampilkan di preview. */
  previousCmName: string | null;
  /** Nilai per kolom (label → teks) untuk tabel preview. */
  values: Record<string, string>;
  /** Payload siap tulis ke tabel creators. */
  payload: Record<string, unknown>;
}

export interface ImportContext {
  /** nama CM (huruf kecil) → { id, name }. */
  cmByName: Map<string, { id: string; name: string }>;
  /** username (huruf kecil) → kreator yang sudah ada. */
  existingByUsername: Map<string, { id: string; cmName: string | null }>;
}

/**
 * Bangun payload tulis dari satu baris. Kolom opsional yang kosong sengaja
 * TIDAK dimasukkan supaya UPDATE tidak menghapus data yang sudah ada di DB
 * (file import biasanya hanya mengisi username + CM).
 *
 * owner_cpm_id SELALU dimasukkan — inilah "replace CM, bukan append" yang diminta.
 */
function buildPayload(
  values: Record<string, string>,
  username: string,
  cmId: string
): Record<string, unknown> {
  const payload: Record<string, unknown> = { username, owner_cpm_id: cmId };

  const put = (key: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") payload[key] = value;
  };

  put("name", values["Nama Creator"]);
  put("jenis_creator", values["Kategory"]);
  put("phone", values["No HP"]);
  put("profile_link", values["Link Akun"]);
  put("uid", values["UID"]);
  put("followers", values["Followers"]);
  put("domisili", values["Domisili"]);
  put("rc_live", values["RC Live"]);
  put("rc_video", values["RC Video"]);
  put("level", parseLevel(values["Level"] ?? ""));
  put("rate_card", parseRupiah(values["Rate Card"] ?? ""));
  put("join_date", parseFlexibleDate(values["Join Date"] ?? ""));

  const niches = parseNiches(values["Niche"] ?? "");
  if (niches) {
    payload.niche = niches[0];
    payload.top_niches = niches;
  }

  const platform = (values["Platform"] ?? "").toLowerCase();
  if (PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) payload.platform = platform;

  return payload;
}

/** Status yang dipakai saat baris ini menghasilkan kreator baru. */
export function insertStatus(values: Record<string, string>): string {
  const raw = (values["Status"] ?? "").toLowerCase();
  return STATUSES.includes(raw as (typeof STATUSES)[number]) ? raw : "prospek";
}

/**
 * Klasifikasi setiap baris file menjadi insert / update / error.
 *
 * Fungsi murni — tidak menyentuh Supabase — supaya preview dan commit bisa
 * memakai logika yang sama persis, dan bisa diuji tanpa DB.
 */
export function buildImportRows(
  rows: Record<string, string>[],
  ctx: ImportContext
): ParsedImportRow[] {
  const out: ParsedImportRow[] = [];
  /** username (huruf kecil) → nomor baris pertama yang memakainya, untuk deteksi duplikat dalam file. */
  const seenInFile = new Map<string, number>();

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2; // +1 header, +1 index-0
    const values: Record<string, string> = {};
    for (const col of IMPORT_COLUMNS) values[col.label] = cell(raw, col);

    // Baris contoh kosong bawaan template (dan baris kosong di tengah file)
    // dilewati diam-diam — bukan error yang perlu diperbaiki user.
    if (Object.values(raw).every((v) => String(v ?? "").trim() === "")) continue;

    const username = values["Username*"];
    const cmName = values["CM*"];
    const errors: string[] = [];

    if (!username) errors.push("Username wajib diisi");
    if (!cmName) errors.push("CM wajib diisi");

    const key = username.toLowerCase();
    const duplicateOf = username ? seenInFile.get(key) : undefined;
    if (duplicateOf !== undefined) {
      errors.push(`Username duplikat di dalam file (sudah ada di baris ${duplicateOf})`);
    }

    const cm = cmName ? ctx.cmByName.get(cmName.toLowerCase()) : undefined;
    if (cmName && !cm) {
      errors.push(`CM "${cmName}" tidak terdaftar di Tim — perbaiki nama atau daftarkan CM dulu`);
    }

    const existing = username ? ctx.existingByUsername.get(key) : undefined;

    if (errors.length > 0 || !cm) {
      out.push({
        rowNum,
        status: "error",
        errors,
        username,
        cmName,
        cmId: null,
        existingId: existing?.id ?? null,
        previousCmName: existing?.cmName ?? null,
        values,
        payload: {},
      });
      continue;
    }

    // Baris valid — baru sekarang dicatat, supaya baris error tidak "memblokir"
    // username yang sama di baris berikutnya.
    if (username) seenInFile.set(key, rowNum);

    out.push({
      rowNum,
      status: existing ? "update" : "insert",
      errors: [],
      username,
      cmName: cm.name,
      cmId: cm.id,
      existingId: existing?.id ?? null,
      previousCmName: existing?.cmName ?? null,
      values,
      payload: buildPayload(values, username, cm.id),
    });
  }

  return out;
}

export interface ImportSummary {
  insert: number;
  update: number;
  error: number;
}

export function summarize(rows: ParsedImportRow[]): ImportSummary {
  return {
    insert: rows.filter((r) => r.status === "insert").length,
    update: rows.filter((r) => r.status === "update").length,
    error: rows.filter((r) => r.status === "error").length,
  };
}
