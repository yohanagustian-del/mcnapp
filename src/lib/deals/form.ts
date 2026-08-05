/**
 * Helper deterministik untuk Deal Registration Form & form Edit deal (CLAUDE.md #6).
 *
 * Dipisah dari server action supaya aturannya bisa diuji tanpa Next/Supabase, dan
 * supaya registrasi & edit memakai SATU aturan yang sama (CLAUDE.md #4) — bukan dua
 * salinan yang bisa menyimpang.
 */

/**
 * Teks komisi yang disimpan di `komisi_*_raw`, dibangun dari min/max hasil form.
 *
 * Range ditulis "5-7%" — bentuk yang sama seperti sheet lama — tapi di sini ia
 * BUKAN data kotor: min & max datang dari dua input angka terpisah, jadi
 * `komisi_*_pct` (= min) selalu punya nilai yang bisa dipakai hitungan.
 * `null` = komisi belum diketahui (kolom dikosongkan).
 */
export function commissionRaw(
  min: number | null | undefined,
  max: number | null | undefined
): string | null {
  if (min === null || min === undefined) return null;
  return max !== null && max !== undefined && max !== min ? `${min}-${max}%` : `${min}%`;
}

/**
 * `review_flags` untuk baris yang baru lewat form tervalidasi.
 *
 * Setelah form (shop_id numeric, exp_date dari date picker, komisi angka %, Rupiah
 * angka murni) satu-satunya masalah yang mungkin tersisa adalah kolom yang memang
 * masih KOSONG — masalah format sudah tidak mungkin lolos. Karena itu flags
 * dihitung ulang dari nilai tersimpan, bukan diwarisi apa adanya dari import legacy:
 * kalau tidak, flag "shop_id tidak numeric" ikut menempel selamanya walau BizDev
 * sudah memperbaikinya.
 */
export function dealReviewFlags({
  shopId,
  expDate,
}: {
  shopId: string | null;
  expDate: string | null;
}): string[] {
  const flags: string[] = [];
  if (!shopId) flags.push("shop_id kosong");
  if (!expDate) {
    flags.push("exp_date kosong (deal_end tidak bisa dipakai alert kadaluarsa M4)");
  }
  return flags;
}
