/**
 * Shopee's own level-2 product category taxonomy (262 names, official/normalized
 * list supplied 2026-09-16) — distinct from TikTok's category names, which come
 * straight from each TikTok MCN/TAP export's own "Level 2 Category" column and
 * need no separate lookup. Shopee's Conversion Report exports raw category text
 * per row (`kategori_l2`) that can vary in casing/spacing across exports, so a
 * normalization step is needed before it can feed `creators.niche`/`top_niches`
 * or `creator_subcat_segment_gmv` (CLAUDE.md #7: dirty input gets flagged, not
 * guessed at) — this is that lookup.
 */
export const SHOPEE_L2_CATEGORIES: readonly string[] = [
  "Aksesoris Rambut", "Aksesoris Tambahan", "Anting", "Cincin", "Dasi", "Gelang Kaki",
  "Gelang Tangan & Bangle", "Ikat Pinggang", "Kacamata & Aksesoris", "Kalung", "Sarung Tangan",
  "Set & Paket Aksesoris", "Syal & Selendang", "Topi", "Logam Mulia", "Perhiasan Berharga",
  "Aksesoris Fashion Lainnya", "Aksesoris Bayi & Anak", "Pakaian Anak Laki-Laki",
  "Pakaian Anak Perempuan", "Pakaian Bayi", "Sepatu Anak Laki-Laki", "Sepatu Anak Perempuan",
  "Sepatu Bayi", "Fashion Bayi & Anak Lainnya", "Pakaian Muslim Wanita",
  "Mukena & Perlengkapan Sholat", "Outerwear", "Pakaian Muslim Anak", "Pakaian Muslim Pria",
  "Set", "Fashion Muslim Lainnya", "Aksesoris Jam Tangan", "Jam Tangan Couple",
  "Jam Tangan Pria", "Jam Tangan Wanita", "Jam Tangan Lainnya", "Tas Travel",
  "Aksesoris Travel", "Koper", "Koper & Tas Travel Lainnya", "Kaos Kaki", "Atasan",
  "Celana Panjang", "Celana Panjang Jeans", "Celana Pendek", "Hoodie & Sweatshirt",
  "Jaket, Mantel, & Rompi", "Jas Formal", "Kostum", "Pakaian Dalam", "Pakaian Kerja",
  "Pakaian Tidur", "Pakaian Tradisional", "Set Pakaian Pria", "Sweater & Cardigan",
  "Pakaian Pria Lainnya", "Kaos Kaki & Stocking", "Baju Hamil", "Celana Jeans",
  "Celana Panjang & Legging", "Dress", "Jumpsuit, Playsuit, & Overall", "Kain",
  "Pakaian Tidur & Piyama", "Rok", "Wedding Dress", "Pakaian Wanita Lainnya",
  "Aksesoris & Perawatan Sepatu", "Boot", "Loafer", "Oxford", "Sandal", "Slip-On & Mules",
  "Sneakers", "Sepatu Pria Lainnya", "Boots", "Heels", "Sandal Jepit & Sandal Lainnya",
  "Sepatu Flat", "Wedges", "Sepatu Wanita Lainnya", "Clutch", "Dompet", "Ransel Pria",
  "Tas Kerja", "Tas Laptop", "Tas Pinggang Pria", "Tas Selempang & Bahu Pria", "Tote Bag",
  "Tas Pria Lainnya", "Aksesoris Tas", "Dompet Wanita", "Ransel Wanita", "Tas Pinggang Wanita",
  "Tas Selempang & Bahu Wanita", "Top Handle Bag", "Tas Wanita Lainnya", "Mainan",
  "Keamanan Bayi", "Kesehatan Kehamilan", "Perlengkapan Ibu Hamil", "Perlengkapan Makan Bayi",
  "Perlengkapan Travelling Bayi", "Popok & Pispot", "Kamar Bayi", "Kesehatan Bayi",
  "Perlengkapan Mandi", "Set & Paket Hadiah", "Susu Formula & Makanan Bayi",
  "Ibu & Bayi Lainnya", "Perawatan Diri", "Obat-obatan & Alat Kesehatan", "Kesehatan Seksual",
  "Suplemen Makanan", "Kesehatan Lainnya", "Makanan Ringan", "Bahan Pokok", "Minuman",
  "Minuman Alkohol", "Set Hadiah & Hampers", "Makanan Instan", "Roti & Kue", "Susu & Olahan",
  "Bahan Baking", "Kebutuhan Memasak", "Makanan Segar & Beku", "Menu Sarapan",
  "Makanan & Minuman Lainnya", "Alat Kecantikan", "Kosmetik", "Paket & Set Kecantikan",
  "Parfum & Wewangian", "Perawatan Pria", "Perawatan Rambut", "Perawatan Tangan, Kaki & Kuku",
  "Perawatan Tubuh", "Perawatan Wajah", "Perawatan & Kecantikan Lainnya", "Media Player",
  "Amplifier & Mixer", "Kabel & Konverter Audio & Video", "Mikrofon & Aksesoris",
  "Perangkat Audio & Speaker", "Earphone, Headphone, & Headset", "Audio Lainnya",
  "Kelistrikan", "Baterai", "Peralatan Listrik Besar", "Peralatan Listrik Kecil",
  "Remot Kontrol", "Rokok Elektronik & Shisha", "Perangkat Dapur", "TV & Aksesoris",
  "Proyektor & Aksesoris", "Elektronik Lainnya", "Konsol Game", "Video Game",
  "Aksesoris Konsol", "Gaming & Konsol Lainnya", "Aksesoris", "Perangkat Wearable",
  "Kartu Perdana", "Walkie Talkie", "Handphone", "Tablet", "Handphone & Aksesoris Lainnya",
  "Aksesoris Kamera", "Kamera Keamanan", "Perawatan Kamera", "Aksesoris Drone",
  "Aksesoris Lensa", "Drone", "Kamera", "Lensa", "Kamera & Drone Lainnya",
  "Aksesoris Desktop & Laptop", "Keyboard & Mouse", "Komponen Network", "Software",
  "Komponen Desktop & Laptop", "Desktop", "Laptop", "Monitor", "Penyimpanan Data",
  "Peralatan Kantor", "Printer & Scanner", "Komputer & Aksesoris Lainnya",
  "Perlengkapan Menggambar", "Pembungkus Kado & Kemasan", "Perlengkapan Sekolah & Kantor",
  "Alat Tulis", "Buku Tulis & Kertas", "Surat-Menyurat", "Buku & Alat Tulis Lainnya",
  "Majalah & Koran", "Buku Bacaan", "E-Book", "Buku & Majalah Lainnya",
  "Aksesoris Hewan Peliharaan", "Grooming Hewan", "Litter & Toilet", "Makanan Hewan",
  "Pakaian & Aksesoris Hewan", "Perawatan Kesehatan Hewan", "Hewan Peliharaan Lainnya",
  "Alat & Aksesoris Musik", "Album Foto", "CD, DVD & Bluray", "Koleksi", "Mainan & Games",
  "Perlengkapan Menjahit", "Piringan Hitam", "Souvenir & Hadiah", "Hobi & Koleksi Lainnya",
  "Suku Cadang Mobil", "Oli & Pelumas Kendaraan", "Aksesoris Eksterior Mobil",
  "Aksesoris Interior Mobil", "Gantungan & Sarung Kunci Kendaraan", "Perawatan Kendaraan",
  "Perkakas & Perlengkapan Kendaraan", "Mobil", "Mobil Lainnya",
  "Aksesoris Olahraga & Aktivitas Outdoor", "Alat Rekreasi Olahraga & Aktivitas Outdoor",
  "Pakaian Olahraga & Aktivitas Outdoor", "Sepatu Olahraga", "Olahraga & Outdoor Lainnya",
  "Alat Pengaman", "Alat Pertukangan & Renovasi Rumah", "Dekorasi", "Furniture", "Kamar Mandi",
  "Kamar Tidur", "Organizer Rumah", "Penghangat Tangan & Kantong Kompres",
  "Pengharum Ruangan & Aromaterapi", "Peralatan Makan", "Perawatan Rumah",
  "Perlengkapan Dapur", "Perlengkapan Keagamaan", "Taman", "Lampu", "Perlengkapan Pesta",
  "Perlengkapan Rumah Lainnya", "Aksesoris Sepeda Motor", "Helm & Aksesoris Pengendara Motor",
  "Suku Cadang Motor", "Sepeda Motor", "Sepeda Motor Lainnya", "Belanja", "Layanan",
  "Listrik, Gas, & Air", "Makanan & Minuman", "Shopee", "Streaming", "Telco", "Tiket Event",
  "Travel & Tour", "Gaming", "E-Money",
];

const LOOKUP: ReadonlyMap<string, string> = new Map(
  SHOPEE_L2_CATEGORIES.map((c) => [c.trim().toLowerCase(), c])
);

/**
 * Maps a raw category string from the Shopee Conversion Report (`kategori_l2`)
 * to its canonical spelling — case/whitespace-insensitive exact match only, no
 * fuzzy matching (a near-miss silently mapped to the wrong category would
 * pollute niche ranking and GMV-per-category rollups). Unrecognized text
 * (blank, or not in the official list) returns null — the caller skips that
 * row's contribution rather than guessing.
 */
export function normalizeShopeeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return LOOKUP.get(raw.trim().toLowerCase()) ?? null;
}
