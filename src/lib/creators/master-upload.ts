import { parseRupiah } from "@/lib/utils/rupiah";
import { parseFlexibleDate } from "@/lib/utils/date";
import { parseCount, pick, pickPrefix } from "@/lib/platform-csv";
import { parseCreatorClass } from "./creator-class";

/**
 * Pemetaan satu baris sheet master "data creator" → payload tabel `creators`.
 *
 * Dipisah dari server action (`uploadCreators`) supaya bisa diuji tanpa Supabase —
 * pola yang sama dengan `import-spec.ts` untuk panel Import Kreator. Form ini
 * menerima DUA bentuk file:
 *  - sheet master lama (header Indonesia bebas: "End Date Kontrak Tertulis", dll)
 *  - template Import Kreator hasil download ("Username*", "CM*", "End Date", …)
 *
 * Penanda wajib "*" sudah dibuang oleh normalizeHeader (lihat utils/csv.ts), jadi
 * di sini header template cukup dicocokkan sebagai "username" / "cm".
 */

export const PLATFORMS = ["tiktok", "shopee"] as const;
export const SEGMENTS = ["tc", "incubation", "celeb"] as const;
export const STATUSES = ["prospek", "binding", "aktif", "nonaktif"] as const;

/**
 * Status untuk kreator BARU saat kolom Status di sheet kosong / tidak dikenali.
 *
 * `aktif`, bukan `prospek`: sheet yang diunggah lewat form ini adalah master data
 * kreator yang SUDAH bergabung, jadi menandainya prospek membuat seluruh hasil
 * import salah status dan harus dibetulkan satu per satu.
 */
export const DEFAULT_IMPORT_STATUS = "aktif";

/** "beauty; skincare, fashion" → top-3 level-2 categories. */
export function parseNiches(raw: string | undefined): string[] | null {
  if (!raw?.trim()) return null;
  const parts = raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 3) : null;
}

/** "Lv 0" / "Lv 3" / "3" → level int 1..8 (0 / kosong / tak valid → null). */
export function parseLevel(raw: string): number | null {
  const m = raw.match(/(\d)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 8 ? n : null;
}

/**
 * Field form "Tambah Kreator" — namanya SENGAJA sama dengan kunci header sheet
 * yang sudah dinormalisasi, supaya isian form bisa langsung disuap ke
 * `buildMasterCreatorRow` (form manual = import satu baris, satu parser).
 *
 * `sharing_komisi` tidak ada di sini: commission_share read-only, sync platform
 * (CLAUDE.md #3) — tidak bisa diisi manual maupun dari sheet.
 */
export const MANUAL_FIELDS = [
  "username",
  "nama_creator",
  "kategory",
  "kelas_kreator",
  "platform",
  "no_hp",
  "link_akun",
  "uid",
  "followers",
  "kualitas",
  "domisili",
  "alamat_lengkap",
  "level",
  "rc_live",
  "rc_video",
  "rate_card",
  "join_date",
  "end_date",
  "status",
] as const;

export type MasterRowOutcome =
  /** Baris kosong (baris contoh template / baris sela) — dilewati diam-diam. */
  | { kind: "empty" }
  /** Baris ditolak; tidak ada yang ditulis. */
  | { kind: "skip"; reason: string }
  | {
      kind: "row";
      username: string;
      name: string;
      /** Status untuk baris INSERT (baris UPDATE tidak mengubah status). */
      insertStatus: string;
      payload: Record<string, unknown>;
      /** Catatan "perlu review" — baris TETAP disimpan (mis. nama CM salah ketik). */
      note: string | null;
    };

/**
 * Klasifikasi + payload satu baris. Fungsi murni.
 *
 * Aturan kunci:
 *  - **Username WAJIB.** Itu identitas akun dan kunci pencocokan; baris tanpa
 *    username tidak bisa di-upsert dengan aman → ditolak.
 *  - **Nama Creator OPSIONAL.** Kosong → dipakai username (kolom `name` NOT NULL
 *    di DB). Sebelumnya nama kosong ikut menolak baris, padahal sheet operasional
 *    sering hanya mengisi username.
 *  - **CM tidak dikenal tidak menggagalkan baris** — datanya tetap masuk, tapi
 *    dilaporkan sebagai catatan supaya salah ketik tidak hilang tanpa jejak.
 *  - Kolom kosong menghasilkan null dan DIBUANG dari payload, supaya UPDATE tidak
 *    menghapus data lama (mis. sheet tanpa kolom CM tidak mengosongkan CM).
 *  - `commission_share` sengaja TIDAK pernah diambil dari sheet mana pun —
 *    read-only, sync platform (CLAUDE.md #3).
 */
export function buildMasterCreatorRow(
  raw: Record<string, string>,
  cmByName: Map<string, string>,
  /** nama akuisitor (huruf kecil) → team_members.id; kosong = kolom diabaikan. */
  acquisitorByName: Map<string, string> = new Map()
): MasterRowOutcome {
  if (Object.values(raw).every((v) => String(v ?? "").trim() === "")) return { kind: "empty" };

  const username = pick(raw, ["username"]);
  if (!username) {
    return { kind: "skip", reason: "Username kosong — baris tidak bisa dicocokkan" };
  }
  const name = pick(raw, ["nama_creator", "name"]) || username;

  const cmName = pick(raw, ["cm", "nama_cm", "creator_manager", "cpm"]);
  const cmId = cmName ? cmByName.get(cmName.toLowerCase()) : undefined;

  // Akuisitor = anggota tim grup akuisisi. Sama seperti CM: nama yang tidak
  // terdaftar TIDAK menggagalkan baris, hanya dicatat sebagai catatan review.
  const acquisitorName = pick(raw, ["akuisitor", "acquisitor", "nama_akuisitor"]);
  const acquisitorId = acquisitorName
    ? acquisitorByName.get(acquisitorName.toLowerCase())
    : undefined;

  const notes: string[] = [];
  if (cmName && !cmId) {
    notes.push(
      `CM "${cmName}" tidak terdaftar di Tim — kreator tetap disimpan, kolom CM dibiarkan kosong`
    );
  }
  if (acquisitorName && !acquisitorId) {
    notes.push(
      `Akuisitor "${acquisitorName}" tidak terdaftar sebagai tim akuisisi — kreator tetap disimpan, kolom Akuisitor dibiarkan kosong`
    );
  }
  const note = notes.length ? notes.join(" · ") : null;

  const nicheRaw = pickPrefix(raw, ["niche_(", "niche"]) || pick(raw, ["niches", "top_niches"]);
  const topNiches = parseNiches(nicheRaw);
  const platformRaw = pick(raw, ["platform"]).toLowerCase();
  const segmentRaw = pick(raw, ["segment"]).toLowerCase();
  const statusRaw = pick(raw, ["status"]).toLowerCase();

  const gmv = parseRupiah(pick(raw, ["total_gmv", "gmv"]));
  const gmvLive = parseRupiah(pick(raw, ["gmv_live"]));
  const gmvVideo = parseRupiah(pick(raw, ["gmv_video"]));

  const payload: Record<string, unknown> = {
    name,
    username,
    owner_cpm_id: cmId ?? null,
    acquisitor_id: acquisitorId ?? null,
    profile_link: pick(raw, ["link_akun", "link_profile", "profile_link"]) || null,
    phone: pick(raw, ["no_hp", "phone"]) || null,
    tim_akuisisi: pick(raw, ["tim_akuisisi"]) || null,
    uid: pick(raw, ["uid"]) || null,
    followers: pick(raw, ["followers", "follower_tier"]) || null,
    content_quality: pick(raw, ["kualitas", "kualitas_konten", "content_quality"]) || null,
    join_date: parseFlexibleDate(pickPrefix(raw, ["join_date"])),
    domisili: pickPrefix(raw, ["domisili"]) || null,
    alamat: pick(raw, ["alamat_lengkap", "alamat"]) || null,
    // "kategory" = ejaan header template Import Kreator (disengaja, sudah dipakai user).
    jenis_creator: pick(raw, ["kategory", "kategori", "jenis_creator", "jenis"]) || null,
    // Kosong / tak dikenali → dibuang di bawah, lalu DEFAULT 'reguler' di DB yang
    // berlaku untuk insert; baris update tidak kehilangan kelas lamanya.
    creator_class: parseCreatorClass(pick(raw, ["kelas_kreator", "kelas", "creator_class"])),
    niche: topNiches?.[0] ?? null,
    top_niches: topNiches,
    rc_live: pick(raw, ["rc_live", "ratecard_live"]) || null,
    rc_video: pick(raw, ["rc_video", "ratecard_vt", "ratecard_video"]) || null,
    rate_card: parseRupiah(pick(raw, ["rate_card"])),
    level: parseLevel(pick(raw, ["level_creator", "level"])),
    target_gmv_monthly: parseRupiah(pickPrefix(raw, ["target_gmv"])),
    total_konten: parseCount(pick(raw, ["total_konten"])),
    notes_endorsement: pick(raw, ["notes_endorsement", "notes"]) || null,
    // "end_date" = header template Import Kreator; dua sisanya header sheet master lama.
    contract_end_date:
      parseFlexibleDate(pick(raw, ["end_date", "end_date_kontrak_tertulis", "contract_end_date"])) ??
      parseFlexibleDate(pick(raw, ["end_date_dashboard"])),
  };
  if (PLATFORMS.includes(platformRaw as (typeof PLATFORMS)[number])) payload.platform = platformRaw;
  if (SEGMENTS.includes(segmentRaw as (typeof SEGMENTS)[number])) payload.segment = segmentRaw;
  // GMV dari sheet hanya dipakai bila terisi — sumber utama = upload /metrics.
  if (gmv !== null) payload.gmv = gmv;
  if (gmvLive !== null) payload.gmv_live = gmvLive;
  if (gmvVideo !== null) payload.gmv_video = gmvVideo;
  // Drop null/empty supaya UPDATE tidak menghapus data yang sudah ada.
  for (const k of Object.keys(payload)) if (payload[k] === null) delete payload[k];

  return {
    kind: "row",
    username,
    name,
    insertStatus: STATUSES.includes(statusRaw as (typeof STATUSES)[number])
      ? statusRaw
      : DEFAULT_IMPORT_STATUS,
    payload,
    note,
  };
}
