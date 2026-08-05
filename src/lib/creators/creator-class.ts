/**
 * Kelas kreator (`creators.creator_class`) — Reguler / Kreator Prioritas / Influencer.
 *
 * CATATAN soal duplikasi: ini BUKAN `creators.segment`
 * (enum creator_segment_t: tc | incubation | celeb = Top Creator / Incubation /
 * Celebrity). `segment` sudah dipakai logika lain — gating e-sign kontrak hanya
 * untuk segmen tc/celeb, dan pembagian tim CM — dan tidak punya padanan
 * "Reguler", sementara "kelas" tidak punya padanan "Incubation". Keduanya sengaja
 * dibiarkan sebagai dua sumbu terpisah; jangan menurunkan yang satu dari yang lain.
 *
 * Nilai DB disimpan snake_case (konvensi enum proyek: link_status, price_segment,
 * status), label tampilan dipetakan lewat CREATOR_CLASS_LABEL. Nilai `top_creator`
 * SENGAJA tidak diganti walau labelnya kini "Kreator Prioritas": mengganti nilai
 * enum berarti migrasi data + menyentuh setiap baris kreator yang sudah ada, dan
 * label memang lapisan tampilan (lihat CREATOR_CLASS_LABEL).
 */

export const CREATOR_CLASSES = ["reguler", "top_creator", "influencer"] as const;
export type CreatorClass = (typeof CREATOR_CLASSES)[number];

/** Kelas yang berlaku saat kolom dikosongkan (juga default kolom di DB). */
export const DEFAULT_CREATOR_CLASS: CreatorClass = "reguler";

/** Label Bahasa Indonesia untuk UI & template. */
export const CREATOR_CLASS_LABEL: Record<CreatorClass, string> = {
  reguler: "Reguler",
  top_creator: "Kreator Prioritas",
  influencer: "Influencer",
};

/** Urutan pilihan seperti yang diminta bisnis (Reguler dulu, karena default). */
export const CREATOR_CLASS_OPTIONS = CREATOR_CLASSES.map((value) => ({
  value,
  label: CREATOR_CLASS_LABEL[value],
}));

/**
 * Teks bebas dari sheet → CreatorClass, atau null kalau tidak dikenali.
 *
 * Toleran terhadap variasi penulisan manusia: beda kapital, spasi/underscore/
 * hyphen, dan ejaan Inggris "regular". Nilai yang tidak dikenali TIDAK dipaksa
 * jadi default di sini — pemanggil yang memutuskan (biar bisa memberi catatan
 * ke user, CLAUDE.md #7: jangan crash, jangan diam-diam salah).
 *
 * Label lama "Top Creator" tetap diterima: sheet yang beredar di tim (dan template
 * yang sudah ter-download sebelum penggantian label) masih memakai istilah itu.
 */
export function parseCreatorClass(raw: string): CreatorClass | null {
  const key = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  if (key === "reguler" || key === "regular") return "reguler";
  if (key === "kreatorprioritas" || key === "prioritas") return "top_creator";
  if (key === "topcreator" || key === "top") return "top_creator";
  if (key === "influencer") return "influencer";
  return null;
}

/** Label untuk ditampilkan; null/nilai asing → Reguler (default kolom). */
export function creatorClassLabel(value: string | null | undefined): string {
  const known = CREATOR_CLASSES.find((c) => c === value);
  return CREATOR_CLASS_LABEL[known ?? DEFAULT_CREATOR_CLASS];
}
