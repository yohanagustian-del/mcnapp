import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Notifikasi PIC TAP di sidebar: jadwal live brand yang PIC TAP-nya akun ini.
 *
 * Alurnya: form slot jadwal live menautkan slot ke SHOP dari tabel "Shop dari Produk
 * TAP" (live_schedule_slots.shop_key = products_tap.shop_key, migrasi 0045). Kartu
 * produk shop itu punya kolom `pic_tap`. Kalau PIC TAP-nya adalah akun yang sedang
 * login, jadwal live brand tersebut perlu dia ketahui — karena dialah yang menyiapkan
 * produk/campaign-nya di TAP.
 *
 * Deterministik penuh (dua query, tanpa LLM), dan tidak menyimpan apa pun: notifikasi
 * dihitung dari sumbernya setiap kali sidebar dirender (CLAUDE.md #4).
 */
export interface PicTapScheduleItem {
  slotId: number;
  scheduleDate: string;
  /** Nama brand pada slot; jatuh ke shop_key kalau slotnya tidak mengisi brand. */
  brandLabel: string;
  startTime: string | null;
}

export interface PicTapScheduleAlert {
  /** Jumlah slot live (hari ini ke depan) untuk brand yang PIC TAP-nya akun ini. */
  count: number;
  /** Nama brand/shop yang terlibat — dipakai sebagai tooltip badge. */
  shopNames: string[];
  /** Slot terdekat lebih dulu — dipakai panel notifikasi di halaman Jadwal Live. */
  items: PicTapScheduleItem[];
}

/** Batas shop yang ikut diperiksa; satu PIC TAP tidak realistis memegang lebih dari ini. */
const SHOP_LIMIT = 500;
/** Batas slot yang ditarik untuk mengumpulkan nama brand pada tooltip. */
const SLOT_LIMIT = 200;

export async function loadPicTapScheduleAlert(memberId: string): Promise<PicTapScheduleAlert> {
  const admin = createAdminClient();

  // 1. Shop yang PIC TAP-nya akun ini. shop_key = kolom generated (0043), kunci yang
  //    sama dengan yang disimpan slot — tidak ada ekspresi grup yang disalin ulang.
  const { data: shopRows } = await admin
    .from("products_tap")
    .select("shop_key")
    .eq("pic_tap", memberId)
    .limit(SHOP_LIMIT * 20);
  const shopKeys = [...new Set((shopRows ?? []).map((r) => r.shop_key as string).filter(Boolean))]
    .slice(0, SHOP_LIMIT);
  if (shopKeys.length === 0) return { count: 0, shopNames: [], items: [] };

  // 2. Slot live yang menautkan shop itu, dari hari ini ke depan. Slot yang sudah
  //    lewat atau sudah diverifikasi (done) bukan lagi hal yang perlu diingatkan.
  const today = new Date().toISOString().slice(0, 10);
  const { data: slots } = await admin
    .from("live_schedule_slots")
    .select("id, shop_key, brand_name, schedule_date, start_time")
    .in("shop_key", shopKeys)
    .gte("schedule_date", today)
    .in("status", ["scheduled", "tentative"])
    .order("schedule_date", { ascending: true })
    .limit(SLOT_LIMIT);

  const items: PicTapScheduleItem[] = (slots ?? []).map((s) => ({
    slotId: s.id as number,
    scheduleDate: s.schedule_date as string,
    brandLabel: (s.brand_name as string | null)?.trim() || (s.shop_key as string),
    startTime: (s.start_time as string | null) ?? null,
  }));
  const shopNames = [...new Set(items.map((i) => i.brandLabel))];
  return { count: items.length, shopNames, items };
}
