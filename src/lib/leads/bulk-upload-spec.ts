import { canonicalHeader } from "@/lib/creators/import-spec";
import type { HeaderProbe } from "@/lib/utils/sheet";
import {
  BRAND_LEAD_PLATFORMS,
  BRAND_LEAD_SUPPORT,
  brandLeadContactSchema,
  brandLeadSchema,
  normalizePhoneId,
  type BrandLeadContactInput,
  type BrandLeadInput,
  type BrandLeadPlatform,
  type BrandLeadSource,
  type BrandLeadSupport,
} from "./brand-lead";

/**
 * Upload massal Brand Lead Bank dari spreadsheet matchmaking BizDev (request user
 * 2026-10-01, contoh: sheet "Data Contoh Matchmaking").
 *
 * Satu sumber kebenaran untuk kolom template DAN parser file yang diunggah — pola
 * sama dengan partnership-spec.ts / import-spec.ts: template yang di-download dan
 * parser yang membacanya kembali memakai `BRAND_LEAD_UPLOAD_COLUMNS` (dijaga test
 * round-trip). Setiap baris akhirnya divalidasi `brandLeadSchema` — skema yang SAMA
 * dengan form Registrasi Lead, bukan aturan kedua.
 *
 * Pure (no DB): matching ke lead yang sudah ada terjadi di server action lewat
 * `brandLeadKey()` + `mergeBrandLead()`.
 */

export type BrandLeadUploadColumnKey =
  | "shop_name"
  | "bizdev_names"
  | "business_category"
  | "store_link"
  | "contacts"
  | "brand_group"
  | "brand_support"
  | "ads_scheme"
  | "city"
  | "platforms"
  | "notes";

export interface BrandLeadUploadColumn {
  key: BrandLeadUploadColumnKey;
  /** Header written to the template. */
  label: string;
  /** Canonical (a-z0-9) header forms accepted when reading. */
  aliases: string[];
  /** Canonical prefixes also accepted ("namabrand" matches "Nama Brand (WAJIB …)"). */
  prefixes?: string[];
  /** Format note for the "Petunjuk" sheet. */
  note: string;
}

/** Order here = template column order; the first 8 mirror the matchmaking sheet. */
export const BRAND_LEAD_UPLOAD_COLUMNS: BrandLeadUploadColumn[] = [
  {
    key: "shop_name",
    label: "Nama Brand (WAJIB SESUAI DISPLAY PLATFORM)",
    aliases: ["namabrand", "brand", "brandname", "namatokobrand", "namatoko", "shopname", "namashop"],
    prefixes: ["namabrand"],
    note: "Nama brand/toko persis seperti tampil di TikTok Shop/Shopee. Brand yang sudah ada di Brand Lead Bank (nama sama, abaikan huruf besar/kecil, spasi & tanda baca) TIDAK dibuat dua kali — kontak & kolom yang masih kosong ditambahkan ke lead lama.",
  },
  {
    key: "bizdev_names",
    label: "Bizdev",
    aliases: ["bizdev", "bd", "namabd", "picbd", "picbizdev", "bizdevpic", "picmea"],
    note: "Nama BD MEA yang memegang lead, boleh lebih dari satu (contoh: Erlina, Mizan).",
  },
  {
    key: "business_category",
    label: "Niche",
    aliases: ["niche", "nichebrand", "kategori", "kategoribisnis", "businesscategory", "category"],
    note: "Niche/kategori brand (contoh: Beauty & Personal Care, Food & Beverages). Dipakai untuk filter Niche di Brand Lead Bank.",
  },
  {
    key: "store_link",
    label: "Link Toko Seller / Brand",
    aliases: ["linktokosellerbrand", "linktoko", "linktokobrand", "linktokoseller", "storelink", "link"],
    note: "Link toko di TikTok Shop/Shopee.",
  },
  {
    key: "contacts",
    label: "Contact PIC Brand",
    aliases: ["contactpicbrand", "kontakpicbrand", "contactpic", "kontakpic", "picbrand", "kontak", "contact"],
    note: "Nama + nomor HP PIC brand. Boleh lebih dari satu kontak dalam satu sel (contoh: \"milfan : 888-0955-5993 / nurul : 878-7356-7327\"). Nomor dibaca otomatis jadi +62…; link (Lark dll.) disimpan di Catatan.",
  },
  {
    key: "brand_group",
    label: "Grup Brand",
    aliases: ["grupbrand", "groupbrand", "grupwa", "grupwhatsapp", "grup", "group"],
    note: "Nama grup koordinasi atau link grup WhatsApp/Lark dengan brand.",
  },
  {
    key: "brand_support",
    label: "Sample, Flash Sale & Ads",
    aliases: ["sampleflashsaleads", "sampleflashsaledanads", "dukunganbrand", "brandsupport", "support"],
    note: "Dukungan yang diberikan brand, pisahkan dengan koma: Sample, Flash Sale, Ads, TAP, HSL, Rate Card.",
  },
  {
    key: "ads_scheme",
    label: "Ads Brand",
    aliases: ["adsbrand", "skemaads", "ads"],
    note: "Skema ads brand (contoh: Ads By Brand - Minta Barcode, Brand Invoice One Time - Cek BD, Tidak Support Ads).",
  },
  {
    key: "city",
    label: "Kota",
    aliases: ["kota", "city"],
    note: "Opsional.",
  },
  {
    key: "platforms",
    label: "Platform",
    aliases: ["platform", "platforms"],
    note: "Opsional. TikTok Shop dan/atau Shopee, pisahkan dengan koma.",
  },
  {
    key: "notes",
    label: "Catatan",
    aliases: ["catatan", "notes", "note", "keterangan"],
    note: "Opsional.",
  },
];

const COL = Object.fromEntries(BRAND_LEAD_UPLOAD_COLUMNS.map((c) => [c.key, c])) as Record<
  BrandLeadUploadColumnKey,
  BrandLeadUploadColumn
>;

function headerMatches(column: BrandLeadUploadColumn, header: string): boolean {
  const canon = canonicalHeader(header);
  return column.aliases.includes(canon) || (column.prefixes ?? []).some((p) => canon.startsWith(p));
}

/** parseSheet header probe: the real header row is the one carrying the brand-name column. */
export const BRAND_LEAD_HEADER_PROBE: HeaderProbe = Object.assign(
  (keys: string[]) => keys.some((k) => headerMatches(COL.shop_name, k)),
  { description: "Nama Brand" }
);

function cell(row: Record<string, string>, column: BrandLeadUploadColumn): string {
  for (const [key, value] of Object.entries(row)) {
    if (headerMatches(column, key)) return String(value ?? "").trim();
  }
  return "";
}

// ---------------------------------------------------------------- merge key

/**
 * Merge key for "is this the same brand?": lower-case letters/digits only, so
 * "GRENEY.Underwear.id", "Greney Underwear ID" and "greney underwear id " collapse
 * to one key. null when the name has no letters/digits at all.
 */
export function brandLeadKey(name: string | null | undefined): string | null {
  const key = (name ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return key || null;
}

// ---------------------------------------------------------------- contacts

const URL_RE = /https?:\/\/\S+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// A run of digits with spaces/dots/hyphens inside (never newlines: two numbers on
// two lines are two contacts). Digit count is checked separately.
const PHONE_RE = /\+?\d[\d .-]{6,}\d/g;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;

const SEPARATORS = /^[\s:;,@\-–—/|()[\]]+|[\s:;,@\-–—/|()[\]]+$/g;
const cleanName = (raw: string) => raw.replace(SEPARATORS, "").replace(/\s+/g, " ").trim();

type Token = { kind: "phone" | "email"; raw: string; start: number; end: number };

function findTokens(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    tokens.push({ kind: "email", raw: m[0], start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(PHONE_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (tokens.some((t) => t.kind === "email" && start < t.end && end > t.start)) continue; // digits inside an email
    const digits = m[0].replace(/\D/g, "").length;
    if (digits < MIN_PHONE_DIGITS || digits > MAX_PHONE_DIGITS) continue;
    tokens.push({ kind: "phone", raw: m[0], start, end });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

export interface ParsedContactCell {
  contacts: BrandLeadContactInput[];
  /** Links found in the cell (Lark/WA invite…) — no contact field holds them, so they go to notes. */
  links: string[];
  /** Non-fatal notes (a number that failed validation…). */
  issues: string[];
}

/**
 * One "Contact PIC Brand" cell → contacts. Handles the shapes seen in the
 * matchmaking sheet: "Erlia - 822-9868-4200", "Kayla +62 851-1123-6551",
 * "Joshua\n0811-8720-132", "milfan : 888-…\nnurul : 878-…",
 * "6287839892632 (Ganar)\n6281211541302 (Awang)", a bare number, or a name with
 * a Lark link and no number. Deterministic — never guesses beyond the text.
 */
export function parseContactCell(raw: string): ParsedContactCell {
  const links = [...raw.matchAll(URL_RE)].map((m) => m[0]);
  const text = raw.replace(URL_RE, " ");
  const tokens = findTokens(text);
  const issues: string[] = [];

  if (tokens.length === 0) {
    const name = cleanName(text);
    return { contacts: name ? [{ lead_name: name }] : [], links, issues };
  }

  // gaps[i] = text before token i; gaps[n] = text after the last token.
  const gaps = tokens.map((t, i) => cleanName(text.slice(i === 0 ? 0 : tokens[i - 1].end, t.start)));
  gaps.push(cleanName(text.slice(tokens[tokens.length - 1].end)));

  // Group tokens into contacts: a phone and an email with nothing between them
  // belong to the same person.
  const groups: { first: number; last: number; phone?: string; email?: string }[] = [];
  tokens.forEach((t, i) => {
    const prev = groups[groups.length - 1];
    if (prev && !gaps[i] && !prev[t.kind]) {
      prev[t.kind] = t.raw;
      prev.last = i;
    } else {
      groups.push({ first: i, last: i, [t.kind]: t.raw });
    }
  });

  // Names come before the numbers ("Kayla 0812…") unless the cell starts with a
  // number, in which case they follow it ("0812… (Ganar)").
  const namesBefore = Boolean(gaps[0]);
  const contacts: BrandLeadContactInput[] = groups.map((g, gi) => {
    let name = namesBefore ? gaps[g.first] : gaps[g.last + 1];
    const trailing = gaps[tokens.length];
    if (namesBefore && gi === groups.length - 1 && trailing) name = name ? `${name} (${trailing})` : trailing;
    return toContact(name, g.phone, g.email, issues);
  });
  return { contacts, links, issues };
}

/** Validate one contact with the form's own schema; an invalid number is kept as text, not dropped. */
function toContact(name: string, phone: string | undefined, email: string | undefined, issues: string[]) {
  const candidate = { lead_name: name || undefined, phone: phone ? normalizePhoneId(phone) ?? phone : undefined, email };
  const parsed = brandLeadContactSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const kept = [name, phone, email].filter(Boolean).join(" ");
  issues.push(`Kontak "${kept}" tidak terbaca sebagai nomor HP/email valid — disimpan sebagai teks nama kontak`);
  return { lead_name: kept };
}

// ---------------------------------------------------------------- list cells

const canon = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (raw: string) =>
  raw
    .split(/[,;/&+\n]|\bdan\b|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

const SUPPORT_ALIASES: Record<string, BrandLeadSupport> = {
  sample: "sample",
  sampel: "sample",
  samples: "sample",
  flashsale: "flash_sale",
  fs: "flash_sale",
  ads: "ads_support",
  ad: "ads_support",
  iklan: "ads_support",
  adssupport: "ads_support",
  tap: "tap",
  hsl: "hsl",
  ratecard: "rate_card",
};

const PLATFORM_ALIASES: Record<string, BrandLeadPlatform> = {
  tiktok: "tiktok_shop",
  tiktokshop: "tiktok_shop",
  tts: "tiktok_shop",
  tokopedia: "tiktok_shop",
  shopee: "shopee",
};

/** "Sample, Flash Sale, Ads" → known values + the raw tokens nothing matched. */
export function parseListCell<T extends string>(
  raw: string,
  aliases: Record<string, T>,
  allowed: readonly T[]
): { values: T[]; unknown: string[] } {
  const values: T[] = [];
  const unknown: string[] = [];
  for (const token of splitList(raw)) {
    const v = aliases[canon(token)] ?? (allowed.includes(canon(token) as T) ? (canon(token) as T) : undefined);
    if (v) {
      if (!values.includes(v)) values.push(v);
    } else unknown.push(token);
  }
  return { values, unknown };
}

// ---------------------------------------------------------------- rows

export interface ParsedBrandLeadRow {
  /** 1-based row numbers in the sheet (several when duplicate brand rows were folded together). */
  rowNumbers: number[];
  shopName: string;
  /** brandLeadKey(shop_name); null = no brand name → always a new lead. */
  key: string | null;
  lead: BrandLeadInput | null;
  issues: string[];
  /** Fatal: the row is skipped. */
  error: string | null;
}

/**
 * Sheet rows (headers normalized by parseSheet) → validated leads. Never throws on
 * dirty input (CLAUDE.md #7): unreadable values are flagged and kept in notes, not
 * guessed or silently dropped. Rows of the same brand inside one file are folded
 * into one lead (the matchmaking sheet lists "DiliDili.Shop" twice with two PICs).
 *
 * `headerRowNumber`: sheet row of the header (parseSheet may have skipped
 * super-header rows), so messages point at the right spreadsheet row.
 */
export function buildBrandLeadUploadRows(
  rows: Record<string, string>[],
  source: BrandLeadSource,
  headerRowNumber = 1
): ParsedBrandLeadRow[] {
  const out: ParsedBrandLeadRow[] = [];
  const byKey = new Map<string, ParsedBrandLeadRow>();

  rows.forEach((row, i) => {
    if (Object.values(row).every((v) => !String(v ?? "").trim())) return; // blank / template rows
    const parsed = parseRow(row, headerRowNumber + 1 + i, source);
    const existing = parsed.key && parsed.lead ? byKey.get(parsed.key) : undefined;
    if (existing?.lead && parsed.lead) {
      const { patch, addContacts } = mergeBrandLead(existing.lead, parsed.lead);
      existing.lead = {
        ...existing.lead,
        ...(patch as Partial<BrandLeadInput>),
        contacts: [...existing.lead.contacts, ...addContacts],
      };
      existing.rowNumbers.push(...parsed.rowNumbers);
      existing.issues.push(...parsed.issues);
      return;
    }
    out.push(parsed);
    if (parsed.key && parsed.lead) byKey.set(parsed.key, parsed);
  });
  return out;
}

function parseRow(row: Record<string, string>, rowNumber: number, source: BrandLeadSource): ParsedBrandLeadRow {
  const shopName = cell(row, COL.shop_name);
  const issues: string[] = [];
  const extraNotes: string[] = [];

  const contactCell = parseContactCell(cell(row, COL.contacts));
  issues.push(...contactCell.issues);
  if (contactCell.links.length) extraNotes.push(`Link kontak PIC: ${contactCell.links.join(" ")}`);

  const support = parseListCell(cell(row, COL.brand_support), SUPPORT_ALIASES, BRAND_LEAD_SUPPORT);
  if (support.unknown.length) {
    issues.push(`Dukungan brand tidak dikenal: ${support.unknown.join(", ")} — disimpan di Catatan`);
    extraNotes.push(`Dukungan lain: ${support.unknown.join(", ")}`);
  }
  const platforms = parseListCell(cell(row, COL.platforms), PLATFORM_ALIASES, BRAND_LEAD_PLATFORMS);
  if (platforms.unknown.length) {
    issues.push(`Platform tidak dikenal: ${platforms.unknown.join(", ")} — disimpan di Catatan`);
    extraNotes.push(`Platform lain: ${platforms.unknown.join(", ")}`);
  }

  const notes = [cell(row, COL.notes), ...extraNotes].filter(Boolean).join("\n");
  const parsed = brandLeadSchema.safeParse({
    source,
    status: "baru",
    shop_name: shopName,
    bizdev_names: cell(row, COL.bizdev_names),
    business_category: cell(row, COL.business_category),
    store_link: cell(row, COL.store_link),
    brand_group: cell(row, COL.brand_group),
    ads_scheme: cell(row, COL.ads_scheme),
    city: cell(row, COL.city),
    notes,
    brand_support: support.values,
    platforms: platforms.values,
    contacts: contactCell.contacts,
  });

  const base = { rowNumbers: [rowNumber], shopName, key: brandLeadKey(shopName), issues };
  if (!parsed.success) {
    const message = parsed.error.issues.some((i) => i.path[0] === "shop_name")
      ? "Nama Brand dan Contact PIC kosong — baris dilewati"
      : parsed.error.issues.map((i) => i.message).join("; ");
    return { ...base, lead: null, error: message };
  }
  return { ...base, lead: parsed.data, error: null };
}

// ---------------------------------------------------------------- merge

/**
 * Text columns an upload may fill on an existing lead — only while they are still
 * empty. Notes are handled apart: new lines are appended, never replaced.
 */
export const MERGE_TEXT_FIELDS = [
  "shop_name",
  "bizdev_names",
  "business_category",
  "store_link",
  "brand_group",
  "ads_scheme",
  "city",
] as const;
type MergeTextField = (typeof MERGE_TEXT_FIELDS)[number];

export interface BrandLeadSnapshot {
  shop_name?: string | null;
  bizdev_names?: string | null;
  business_category?: string | null;
  store_link?: string | null;
  brand_group?: string | null;
  ads_scheme?: string | null;
  city?: string | null;
  notes?: string | null;
  platforms: string[];
  brand_support: string[];
  contacts: BrandLeadContactInput[];
}

export interface BrandLeadMerge {
  /** Columns to write; empty = nothing new. Never overwrites a filled value. */
  patch: Partial<Record<MergeTextField | "notes", string>> & { platforms?: string[]; brand_support?: string[] };
  /** Contacts not already on the lead (same phone, email, or — without either — same name). */
  addContacts: BrandLeadContactInput[];
}

function contactKeys(c: BrandLeadContactInput): string[] {
  const keys: string[] = [];
  if (c.phone) keys.push(`p:${c.phone.replace(/\D/g, "")}`);
  if (c.email) keys.push(`e:${c.email.toLowerCase()}`);
  if (!keys.length && c.lead_name) keys.push(`n:${c.lead_name.toLowerCase().replace(/\s+/g, " ").trim()}`);
  return keys;
}

/**
 * Additive merge of an uploaded row into a lead that already exists: fills empty
 * columns, unions the checkbox lists, appends new contacts. It never replaces or
 * removes anything, and never touches source/status — which is why an upload may
 * merge into a lead another BD created without the per-row edit gate (CLAUDE.md
 * #2: an action that loses nothing applies automatically, with an audit entry).
 */
export function mergeBrandLead(existing: BrandLeadSnapshot, incoming: BrandLeadSnapshot): BrandLeadMerge {
  const patch: BrandLeadMerge["patch"] = {};
  for (const f of MERGE_TEXT_FIELDS) {
    const next = incoming[f]?.trim();
    if (next && !existing[f]?.trim()) patch[f] = next;
  }
  const oldNotes = existing.notes?.trim() ?? "";
  const newLines = (incoming.notes ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !oldNotes.includes(l));
  if (newLines.length) patch.notes = [oldNotes, ...newLines].filter(Boolean).join("\n");

  const union = (a: string[], b: string[]) => [...a, ...b.filter((v) => !a.includes(v))];
  const platforms = union(existing.platforms, incoming.platforms);
  if (platforms.length !== existing.platforms.length) patch.platforms = platforms;
  const support = union(existing.brand_support, incoming.brand_support);
  if (support.length !== existing.brand_support.length) patch.brand_support = support;

  const seen = new Set(existing.contacts.flatMap(contactKeys));
  const addContacts: BrandLeadContactInput[] = [];
  for (const c of incoming.contacts) {
    const keys = contactKeys(c);
    if (!keys.length || keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    addContacts.push(c);
  }
  return { patch, addContacts };
}

export function isEmptyMerge(m: BrandLeadMerge): boolean {
  return Object.keys(m.patch).length === 0 && m.addContacts.length === 0;
}
