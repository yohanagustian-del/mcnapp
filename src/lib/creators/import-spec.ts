import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { DEFAULT_IMPORT_STATUS } from "./master-upload";
import {
  CREATOR_CLASS_DESCRIPTION,
  CREATOR_CLASS_LABEL,
  CREATOR_CLASS_OPTIONS,
  DEFAULT_CREATOR_CLASS,
  parseCreatorClass,
} from "./creator-class";

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
 *
 * Niche SENGAJA tidak ada di template: nilainya diturunkan otomatis dari upload
 * data platform mingguan, jadi kolom manual di sini hanya menimpanya dengan
 * tebakan yang lebih buruk.
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
    label: "Kelas Kreator",
    aliases: ["kelaskreator", "kelas", "creatorclass", "kelascreator"],
    required: false,
    note: `Opsional. Salah satu: ${CREATOR_CLASS_OPTIONS.map((o) => o.label).join(" / ")} (istilah lama "Top Creator" = ${CREATOR_CLASS_LABEL.top_creator}, tetap terbaca; "External" terbaca sebagai ${CREATOR_CLASS_LABEL.eksternal}). ${CREATOR_CLASS_LABEL.eksternal} = ${CREATOR_CLASS_DESCRIPTION.eksternal}. Kosong atau tidak dikenali → ${CREATOR_CLASS_LABEL[DEFAULT_CREATOR_CLASS]} untuk kreator baru; kreator yang sudah ada tetap memakai kelas lamanya.`,
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
    label: "Kualitas",
    aliases: ["kualitas", "kualitaskonten", "contentquality"],
    required: false,
    note: "Opsional. Penilaian kualitas konten, teks bebas (contoh: Bagus / Cukup / Kurang).",
  },
  {
    label: "Domisili",
    aliases: ["domisili", "kota"],
    required: false,
    note: "Opsional. Kota domisili kreator.",
  },
  {
    label: "Alamat Lengkap",
    aliases: ["alamatlengkap", "alamat"],
    required: false,
    note: "Opsional. Alamat lengkap kreator (jalan, kelurahan, kota, kode pos).",
  },
  {
    label: "Level",
    aliases: ["level", "levelcreator"],
    required: false,
    note: "Opsional. Angka 1–8. Di luar rentang itu diabaikan.",
  },
  {
    label: "Sharing Komisi",
    aliases: ["sharingkomisi", "sharing", "komisi", "commissionshare", "sharingkomisimea"],
    required: false,
    note: "Opsional. Persen — '22%' / '22' / '0,22' semuanya jadi 22%. HANYA mengisi kreator yang sharing-nya masih kosong; nilai yang sudah ada TIDAK ditimpa dari sheet (read-only, sync platform) dan selisihnya dicatat sebagai alert.",
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
    label: "End Date",
    aliases: [
      "enddate",
      "tanggalend",
      "endkontrak",
      "contractenddate",
      // Header sheet master lama "End Date Kontrak Tertulis" / "End Date Dashboard".
      "enddatekontraktertulis",
      "enddatedashboard",
    ],
    required: false,
    note: "Opsional. Tanggal akhir kontrak — '2026-01-31' atau '31 January 2026'. Sisa Kontrak di tabel hanya dihitung kalau Join Date DAN End Date terisi.",
  },
  {
    label: "Status",
    aliases: ["status"],
    required: false,
    note: `Opsional. Salah satu: ${STATUSES.join(", ")}. Kosong saat kreator baru → ${DEFAULT_IMPORT_STATUS}.`,
  },
];

/**
 * Header yang dicari `parseSheet` untuk melewati baris judul di atas header.
 * Harus dalam bentuk normalisasi parseSheet (huruf kecil, spasi → "_", penanda
 * wajib "*" dibuang), jadi "Username*" dari template dan "Username" dari file
 * buatan tangan sama-sama jatuh ke "username". Bentuk lama "username*" tetap
 * didaftarkan supaya file yang dinormalisasi versi lama tidak ikut tertolak.
 */
export const SHEET_REQUIRED_HEADERS = ["username", "username*"];

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

/**
 * "22%" / "22" / "0,22" / "22,5%" → fraksi 0.225.
 *
 * Kolom DB `commission_share` menyimpan FRAKSI (0.22 = 22%), sementara sheet
 * menulisnya bebas. Tanda "%" atau angka > 1 dianggap persen; angka <= 1
 * dianggap sudah fraksi. Di luar rentang (0, 1] → null (tidak valid, bukan
 * dipaksa masuk) supaya "5-7%" atau "not found" tidak jadi angka ngawur.
 */
export function parseSharePercent(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const hasPercent = s.includes("%");
  // Koma = desimal ("22,5"). Persen tidak pernah pakai pemisah ribuan.
  const n = Number(s.replace(/%/g, "").replace(",", ".").replace(/\s/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const fraction = hasPercent || n > 1 ? n / 100 : n;
  if (fraction <= 0 || fraction > 1) return null;
  // Bulatkan supaya 22,5% tidak jadi 0.22500000000000003.
  return Math.round(fraction * 10_000) / 10_000;
}

/** Tampilkan fraksi sebagai persen untuk pesan ke user (0.225 → "22,5%"). */
function sharePct(fraction: number): string {
  return `${String(Number((fraction * 100).toFixed(2))).replace(".", ",")}%`;
}

export interface CommissionResolution {
  /** Nilai yang boleh ditulis ke commission_share; null = jangan tulis apa pun. */
  value: number | null;
  /** Catatan untuk preview (bukan error — baris tetap tersimpan). */
  warning: string | null;
  /** Terisi saat sheet mencoba MENGUBAH nilai yang sudah ada → platform_alert. */
  alert: { from: number; to: number } | null;
}

/**
 * Kebijakan Sharing Komisi dari sheet: ISI KALAU KOSONG SAJA.
 *
 * `creators.commission_share` read-only & sync dari platform (CLAUDE.md #3),
 * jadi sheet tidak boleh dipakai untuk mengubah nilai yang sudah ada — itu
 * satu-satunya cara mencegah sharing diturunkan diam-diam lewat import.
 * Yang diizinkan hanya mengisi kreator yang nilainya masih kosong (backfill).
 *
 * Sheet yang mencoba mengubah nilai terisi → TIDAK diterapkan, tapi selisihnya
 * dikembalikan sebagai `alert` supaya pemanggil menulis audit_logs bertipe
 * `platform_alert` (CLAUDE.md #2: perubahan sharing = alert, bukan edit).
 *
 * Fungsi murni — bisa diuji tanpa DB.
 */
export function resolveCommissionShare(
  raw: string,
  existingShare: number | null | undefined
): CommissionResolution {
  const empty: CommissionResolution = { value: null, warning: null, alert: null };
  const s = String(raw ?? "").trim();
  if (!s) return empty;

  const parsed = parseSharePercent(s);
  if (parsed === null) {
    return {
      value: null,
      warning: `Sharing Komisi "${s}" tidak dikenali — diabaikan (isi seperti 22% atau 0,22)`,
      alert: null,
    };
  }

  // Kreator baru atau sharing masih kosong → backfill, inilah satu-satunya
  // kasus yang boleh menulis.
  if (existingShare === null || existingShare === undefined) {
    return { value: parsed, warning: null, alert: null };
  }

  // Sudah sama → tidak perlu menulis, tidak perlu alert.
  if (Math.abs(existingShare - parsed) < 1e-6) return empty;

  return {
    value: null,
    warning: `Sharing komisi ${sharePct(existingShare)} di sistem TIDAK ditimpa jadi ${sharePct(parsed)} — read-only, sync platform (dicatat sebagai alert)`,
    alert: { from: existingShare, to: parsed },
  };
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
  /** Catatan non-fatal: baris TETAP tersimpan, tapi ada nilai yang diabaikan. */
  warnings: string[];
  /** Sheet mencoba mengubah sharing komisi yang sudah ada → tulis platform_alert. */
  commissionAlert: { from: number; to: number } | null;
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
  /**
   * username (huruf kecil) → kreator yang sudah ada.
   * `commissionShare` (fraksi, null = belum terisi) dipakai kebijakan
   * "isi kalau kosong saja" di resolveCommissionShare.
   */
  existingByUsername: Map<
    string,
    { id: string; cmName: string | null; commissionShare: number | null }
  >;
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
  put("content_quality", values["Kualitas"]);
  put("domisili", values["Domisili"]);
  put("alamat", values["Alamat Lengkap"]);
  put("rc_live", values["RC Live"]);
  put("rc_video", values["RC Video"]);
  put("level", parseLevel(values["Level"] ?? ""));
  put("rate_card", parseRupiah(values["Rate Card"] ?? ""));
  put("join_date", parseFlexibleDate(values["Join Date"] ?? ""));
  put("contract_end_date", parseFlexibleDate(values["End Date"] ?? ""));

  const platform = (values["Platform"] ?? "").toLowerCase();
  if (PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) payload.platform = platform;

  return payload;
}

/**
 * Status yang dipakai saat baris ini menghasilkan kreator baru.
 * Kosong / tidak dikenali → `aktif` (DEFAULT_IMPORT_STATUS), sama dengan form
 * Upload Master Data Creator — satu aturan untuk kedua jalur import.
 */
export function insertStatus(values: Record<string, string>): string {
  const raw = (values["Status"] ?? "").toLowerCase();
  return STATUSES.includes(raw as (typeof STATUSES)[number]) ? raw : DEFAULT_IMPORT_STATUS;
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
        warnings: [],
        commissionAlert: null,
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

    const payload = buildPayload(values, username, cm.id);

    // Sharing komisi diputuskan di sini (bukan di buildPayload) karena butuh
    // nilai yang sudah ada di DB: kebijakannya "isi kalau kosong saja".
    const share = resolveCommissionShare(values["Sharing Komisi"] ?? "", existing?.commissionShare);
    if (share.value !== null) payload.commission_share = share.value;

    const warnings: string[] = share.warning ? [share.warning] : [];

    // Kelas kreator: kosong → Reguler untuk kreator BARU. Kreator yang sudah ada
    // TIDAK diturunkan kelasnya hanya karena selnya kosong — itu aturan umum
    // template ("kolom opsional yang dikosongkan tidak menimpa data lama"), dan
    // kolomnya sendiri NOT NULL DEFAULT 'reguler' di DB (migration 0029).
    const classRaw = (values["Kelas Kreator"] ?? "").trim();
    const creatorClass = parseCreatorClass(classRaw);
    if (classRaw && !creatorClass) {
      const opsi = CREATOR_CLASS_OPTIONS.map((o) => o.label).join(" / ");
      warnings.push(
        `Kelas Kreator "${classRaw}" tidak dikenali (pilih ${opsi}) — ` +
          (existing
            ? "kelas lama dipertahankan"
            : `dipakai ${CREATOR_CLASS_LABEL[DEFAULT_CREATOR_CLASS]}`)
      );
    }
    if (creatorClass) payload.creator_class = creatorClass;
    else if (!existing) payload.creator_class = DEFAULT_CREATOR_CLASS;

    out.push({
      rowNum,
      status: existing ? "update" : "insert",
      errors: [],
      warnings,
      commissionAlert: share.alert,
      username,
      cmName: cm.name,
      cmId: cm.id,
      existingId: existing?.id ?? null,
      previousCmName: existing?.cmName ?? null,
      values,
      payload,
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
