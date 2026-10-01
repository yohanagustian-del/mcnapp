import { z } from "zod";
import { parseRupiah } from "@/lib/utils/rupiah";

/**
 * Validasi form "Registrasi Lead" (Brand Lead Bank, BizDev) — dipakai bersama
 * server & klien (CLAUDE.md #4), pola sama seperti lib/deals/product-card.ts.
 *
 * Tidak ada field yang wajib per-kolom kecuali `source` (asal lead) — sama
 * semangatnya dengan Registrasi Deal (CLAUDE.md #6): memaksa isian yang belum
 * diketahui memancing data karangan. Satu-satunya syarat gerbang: minimal
 * Nama Toko ATAU satu kontak PIC terisi (kalau tidak, lead tidak punya cara
 * ditindaklanjuti sama sekali).
 */

export const BRAND_LEAD_SOURCES = ["matchmaking", "event", "iklan", "rekomendasi", "scouting", "others"] as const;
export type BrandLeadSource = (typeof BRAND_LEAD_SOURCES)[number];

export const BRAND_LEAD_PLATFORMS = ["shopee", "tiktok_shop"] as const;
export type BrandLeadPlatform = (typeof BRAND_LEAD_PLATFORMS)[number];

export const BRAND_LEAD_SUPPORT = ["tap", "ads_support", "hsl", "sample", "rate_card", "flash_sale"] as const;
export type BrandLeadSupport = (typeof BRAND_LEAD_SUPPORT)[number];

export const BRAND_LEAD_STATUSES = ["baru", "kontak", "nego", "deal", "batal"] as const;
export type BrandLeadStatus = (typeof BRAND_LEAD_STATUSES)[number];

/** UI labels (Bahasa Indonesia) — shared by the form, the list page and the upload template. */
export const BRAND_LEAD_SOURCE_LABELS: Record<BrandLeadSource, string> = {
  matchmaking: "Matchmaking",
  event: "Event",
  iklan: "Iklan",
  rekomendasi: "Rekomendasi",
  scouting: "Scouting",
  others: "Lainnya",
};
export const BRAND_LEAD_PLATFORM_LABELS: Record<BrandLeadPlatform, string> = { shopee: "Shopee", tiktok_shop: "TikTok Shop" };
export const BRAND_LEAD_SUPPORT_LABELS: Record<BrandLeadSupport, string> = {
  tap: "TAP",
  ads_support: "Ads Support",
  hsl: "HSL",
  sample: "Sample",
  rate_card: "Rate Card",
  flash_sale: "Flash Sale",
};
export const BRAND_LEAD_STATUS_LABELS: Record<BrandLeadStatus, string> = {
  baru: "Baru",
  kontak: "Kontak",
  nego: "Nego",
  deal: "Deal",
  batal: "Batal",
};

/** Teks kosong dari input yang tidak diisi → undefined (pola sama product-card.ts). */
function blankToUndefined(v: unknown) {
  return typeof v === "string" && v.trim() === "" ? undefined : v;
}

const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

/** "081234..." / "62812..." / "+62812..." → "+62812...". null bila kosong atau tidak ada digit sama sekali. */
export function normalizePhoneId(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+62")) return cleaned;
  if (cleaned.startsWith("62")) return `+${cleaned}`;
  if (cleaned.startsWith("0")) return `+62${cleaned.slice(1)}`;
  if (cleaned.startsWith("+")) return cleaned; // nomor asing — dibiarkan apa adanya, bukan dipaksa +62
  // No Indonesian mobile prefix starts with 86 once the trunk 0 is dropped (81x-89x
  // except 86x), so a bare "86 191 …" is a Chinese +86 number, not +6286….
  if (cleaned.startsWith("86")) return `+${cleaned}`;
  return `+62${cleaned}`;
}

const phoneField = z.preprocess((v) => {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  return normalizePhoneId(v) ?? v;
}, z.string().regex(/^(\+62\d{8,13}|\+\d{6,15})$/, "Nomor HP tidak valid").optional());

const emailField = z.preprocess(blankToUndefined, z.string().trim().toLowerCase().email("Email tidak valid").optional());

/** Rupiah-formatted text ("Rp5.000.000") atau angka murni → number. Gagal parse → undefined (bukan 0). */
function rupiahField() {
  return z.preprocess((v) => {
    if (v === null || v === undefined) return undefined;
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() === "") return undefined;
    const parsed = parseRupiah(v as string);
    return parsed ?? undefined;
  }, z.number().nonnegative().optional());
}

const nonNegativeNumberField = z.preprocess((v) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string" && v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}, z.number().nonnegative().optional());

export const brandLeadContactSchema = z.object({
  lead_name: optionalText,
  phone: phoneField,
  email: emailField,
});
export type BrandLeadContactInput = z.infer<typeof brandLeadContactSchema>;

function isEmptyContact(c: BrandLeadContactInput): boolean {
  return !c.lead_name && !c.phone && !c.email;
}

export const brandLeadSchema = z
  .object({
    source: z.enum(BRAND_LEAD_SOURCES, { errorMap: () => ({ message: "Pilih asal lead" }) }),
    source_other: optionalText,
    shop_name: optionalText,
    city: optionalText,
    business_category: optionalText,
    store_link: optionalText,
    bizdev_names: optionalText,
    brand_group: optionalText,
    ads_scheme: optionalText,
    platforms: z.array(z.enum(BRAND_LEAD_PLATFORMS)).default([]),
    marketing_budget: rupiahField(),
    target_roas: nonNegativeNumberField,
    brand_support: z.array(z.enum(BRAND_LEAD_SUPPORT)).default([]),
    status: z.enum(BRAND_LEAD_STATUSES).default("baru"),
    notes: optionalText,
    contacts: z.array(brandLeadContactSchema).default([]),
  })
  .refine((data) => Boolean(data.shop_name) || data.contacts.some((c) => !isEmptyContact(c)), {
    message: "Isi minimal Nama Toko atau satu kontak PIC (nama/HP/email)",
    path: ["shop_name"],
  });

export type BrandLeadInput = z.infer<typeof brandLeadSchema>;

export function isEmptyBrandLeadContact(c: BrandLeadContactInput): boolean {
  return isEmptyContact(c);
}

/** Escape LIKE wildcards so the value matches literally (ILIKE without % = case-insensitive equals). */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Search box "Cari Nama Brand" → one ILIKE pattern per word (ANDed by the caller),
 * so "greney underwear" finds "GRENEY.Underwear.id". LIKE wildcards typed by the
 * user are escaped; `*` is dropped because PostgREST reads it as a wildcard too.
 */
export function brandLeadSearchPatterns(q: string | undefined): string[] {
  return (q ?? "")
    .replace(/\*/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => `%${escapeLike(word)}%`);
}
