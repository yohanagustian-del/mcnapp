// M13 live-schedule domain types. Row shapes are hand-declared (no generated supabase
// types in this repo) to match the `live_schedule_slots` select (snake_case columns).

export type SlotStatus = "scheduled" | "tentative" | "off" | "done" | "cancelled";
export type DealsBy = "bd" | "cm" | "creator";
export type AdsPayer = "brand" | "mea" | "invoicing_mea" | "organik";
/** How actual_start/actual_end were set (PLAN_MSDPS Paket A/B, migration 0073/0076). */
export type ActualTimeSource = "sesuai_rencana" | "input_manual" | "auto_sistem";

/** A row as returned by `select * from live_schedule_slots` (snake_case). */
export interface LiveScheduleSlot {
  id: number;
  creator_id: string;
  schedule_date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM or HH:MM:SS
  end_time: string | null;
  status: SlotStatus;
  off_reason: string | null;
  /** Alasan bebas saat status='cancelled' (diisi di verifikasi). Beda dari off_reason (direncanakan sejak awal). */
  cancel_reason: string | null;
  brand_name: string | null;
  deal_id: string | null;
  /**
   * Shop dari tabel "Shop dari Produk TAP" (= products_tap.shop_key, migrasi 0045).
   * Inilah tautan brand yang dipakai form slot sekarang; `deal_id` tetap ada untuk
   * slot lama yang menunjuk brand_deals.
   */
  shop_key: string | null;
  deals_by: DealsBy | null;
  ads_payer: AdsPayer | null;
  ads_note: string | null;
  pk_ready: boolean;
  product_set_title: string | null;
  product_connected_tap: boolean;
  fokus_produk: string | null;
  actual_start: string | null;
  actual_end: string | null;
  /** How actual_start/actual_end were set; null for slots not yet verified or verified before migration 0073. */
  actual_time_source: ActualTimeSource | null;
  /** Focus product/promo actually used during the live, filled at verification (separate from the plan's fokus_produk). */
  fokus_produk_live: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Minimal creator projection needed to render a schedule row. */
export interface RosterCreator {
  id: string;
  name: string;
  owner_cpm_id: string | null;
}

/** Payload shape for inserting a slot (service-role insert; snake_case). */
export interface SlotInsert {
  creator_id: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  status: SlotStatus;
  off_reason: string | null;
  brand_name: string | null;
  deal_id: string | null;
  shop_key: string | null;
  deals_by: DealsBy | null;
  ads_payer: AdsPayer | null;
  ads_note: string | null;
  pk_ready: boolean;
  product_set_title: string | null;
  product_connected_tap: boolean;
  fokus_produk: string | null;
  created_by: string;
}
