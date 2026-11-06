/**
 * Spesifikasi pendanaan Request Ads — SATU sumber (D-2026-10-31-3). Client-safe
 * (tanpa import server): dipakai form, badge, server action, dan test.
 *
 * Empat tipe pendanaan; kreator & brand bisa bayar cash di awal atau lewat invoice.
 * Brand juga bisa "Ads by Brand" (D-2026-11-06-1): brand menjalankan/membayar ads sendiri,
 * tidak ada uang lewat MEA → tanpa ACC Finance/Director, langsung siap dieksekusi.
 * Jangan buat daftar/label kedua di komponen — impor dari sini.
 */

export const FUNDING_TYPES = ["mea_budget", "creator_budget", "brand_budget", "tiktok_ads_credit"] as const;
export type FundingType = (typeof FUNDING_TYPES)[number];

export const FUNDING_LABELS: Record<FundingType, string> = {
  mea_budget: "Budget MEA",
  creator_budget: "Creator Budget",
  brand_budget: "Brand Budget",
  tiktok_ads_credit: "TikTok Ads Credit",
};

export const PAYMENT_METHODS = ["cash_upfront", "invoice", "ads_by_brand"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash_upfront: "Cash di awal",
  invoice: "Invoice (bayar belakangan)",
  ads_by_brand: "Ads by Brand (tanpa ACC)",
};

/** Label pendek untuk badge ("Brand Budget · Ads by Brand"). */
const PAYMENT_METHOD_SHORT: Record<PaymentMethod, string> = {
  cash_upfront: "Cash",
  invoice: "Invoice",
  ads_by_brand: "Ads by Brand",
};

/** Metode yang sah per pendanaan. `ads_by_brand` hanya untuk Brand Budget (D-2026-11-06-1). */
export function paymentMethodsFor(ft: FundingType): readonly PaymentMethod[] {
  if (ft === "brand_budget") return PAYMENT_METHODS;
  if (ft === "creator_budget") return ["cash_upfront", "invoice"];
  return [];
}

export function isFundingType(v: unknown): v is FundingType {
  return typeof v === "string" && (FUNDING_TYPES as readonly string[]).includes(v);
}
export function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (PAYMENT_METHODS as readonly string[]).includes(v);
}

/** Tipe yang dibayar pihak luar (kreator/brand) → wajib memilih cash/invoice. */
export function fundingNeedsPaymentMethod(ft: FundingType): boolean {
  return ft === "creator_budget" || ft === "brand_budget";
}

/**
 * Ads by Brand: brand mengeksekusi/membayar ads sendiri — tidak ada ACC Finance/Head/Director,
 * tidak ada cek uang masuk, tidak ada invoice (D-2026-11-06-1, mengganti sebagian D-2026-10-31-3).
 */
export function fundingSkipsAcc(ft: FundingType, pm: PaymentMethod | null): boolean {
  return ft === "brand_budget" && pm === "ads_by_brand";
}

/** Cash di awal: Finance wajib mencatat uang masuk sebelum request lanjut. */
export function fundingNeedsCashCheck(ft: FundingType, pm: PaymentMethod | null): boolean {
  return fundingNeedsPaymentMethod(ft) && pm === "cash_upfront";
}

/** Invoice terbit saat ACC untuk tipe berbayar lewat invoice. */
export function fundingProducesInvoice(ft: FundingType, pm: PaymentMethod | null): boolean {
  return fundingNeedsPaymentMethod(ft) && pm === "invoice";
}

/** Siapa yang ditagih — dipakai invoice (`bill_to_type`). */
export function billToTypeOf(ft: FundingType): "creator" | "brand" | null {
  if (ft === "creator_budget") return "creator";
  if (ft === "brand_budget") return "brand";
  return null;
}

/**
 * Label ringkas pendanaan + metode, untuk badge kalender/tabel.
 * mis. "Creator Budget · Invoice", "Budget MEA".
 */
export function fundingBadgeLabel(ft: FundingType | null, pm: PaymentMethod | null): string | null {
  if (!ft) return null;
  const base = FUNDING_LABELS[ft];
  if (fundingNeedsPaymentMethod(ft) && pm) {
    return `${base} · ${PAYMENT_METHOD_SHORT[pm]}`;
  }
  return base;
}

/**
 * Pemetaan nilai lama `live_schedule_slots.ads_payer` (migrasi 0023) ke pendanaan
 * baru — hanya untuk prefill form & tampilan slot lama; `organik` = tidak ada ads.
 */
export function legacyAdsPayerToFunding(
  payer: "brand" | "mea" | "invoicing_mea" | "organik" | null
): { fundingType: FundingType; paymentMethod: PaymentMethod | null } | null {
  switch (payer) {
    case "mea":
      return { fundingType: "mea_budget", paymentMethod: null };
    case "brand":
      return { fundingType: "brand_budget", paymentMethod: null };
    case "invoicing_mea":
      return { fundingType: "creator_budget", paymentMethod: "invoice" };
    default:
      return null;
  }
}
