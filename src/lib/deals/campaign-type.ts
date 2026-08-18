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

/*
 * CATATAN: dulu ada CAMPAIGN_TYPE_NEEDS_BUDGET di sini — tipe campaign yang mewajibkan
 * Ads Budget & Service Fee. Aturan itu hilang bersama pertanyaannya: kedua nominal
 * bukan lagi atribut kartu produk melainkan milik pasangan (project, shop) di tab
 * Project BD, jadi tidak ada tipe campaign yang bisa mewajibkan pengisiannya di form
 * registrasi/upload. Tipe campaign sendiri tetap dipakai (kolom di tabel Produk TAP &
 * tombol Edit shop di tab Deal Brand).
 */
