/**
 * Tipe campaign kartu produk (Registrasi Deal → tabel Produk TAP).
 *
 * Sengaja dipisah dari `product-card.ts` yang membawa zod: file ini di-import dua
 * komponen klien (form registrasi & tabel Produk TAP), dan tidak ada gunanya
 * mengirim skema validasi server ke browser hanya untuk membaca label dropdown.
 */

export const CAMPAIGN_TYPES = [
  { value: "paid", label: "Paid Campaign" },
  { value: "sample", label: "Campaign Sample (non-berbayar)" },
  { value: "extra_commission", label: "Komisi extra (non-berbayar)" },
] as const;

export type CampaignType = (typeof CAMPAIGN_TYPES)[number]["value"];

export const CAMPAIGN_TYPE_VALUES = CAMPAIGN_TYPES.map((t) => t.value) as [
  CampaignType,
  ...CampaignType[],
];

export const CAMPAIGN_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CAMPAIGN_TYPES.map((t) => [t.value, t.label])
);

/**
 * Tipe campaign yang mewajibkan Ads Budget & Service Fee: Paid Campaign — satu-satunya
 * tipe berbayar, jadi kedua angka itu memang selalu ada saat dealnya ditutup. Di tipe
 * non-berbayar pertanyaannya tidak ditampilkan sama sekali, jadi nilainya tetap null.
 *
 * Dipakai bersama form Registrasi Deal, form Edit di tab Produk TAP, dan validasi
 * server lewat productCardIssues() — satu aturan, bukan tiga salinan (CLAUDE.md #4).
 */
export const CAMPAIGN_TYPE_NEEDS_BUDGET: CampaignType = "paid";

/** Label tipe campaign yang mewajibkan budget — dipakai di pesan error & legend form. */
export const CAMPAIGN_TYPE_NEEDS_BUDGET_LABEL = CAMPAIGN_TYPE_LABEL[CAMPAIGN_TYPE_NEEDS_BUDGET];
