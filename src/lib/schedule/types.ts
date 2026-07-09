// M13 live-schedule domain types. Row shapes are hand-declared (no generated supabase
// types in this repo) to match the `live_schedule_slots` select (snake_case columns).

export type SlotStatus = "scheduled" | "tentative" | "off" | "done";
export type DealsBy = "bd" | "cm" | "creator";
export type AdsPayer = "brand" | "mea" | "invoicing_mea" | "organik";

/** A row as returned by `select * from live_schedule_slots` (snake_case). */
export interface LiveScheduleSlot {
  id: number;
  creator_id: string;
  schedule_date: string; // YYYY-MM-DD
  start_time: string | null; // HH:MM or HH:MM:SS
  end_time: string | null;
  status: SlotStatus;
  off_reason: string | null;
  brand_name: string | null;
  deal_id: string | null;
  deals_by: DealsBy | null;
  ads_payer: AdsPayer | null;
  ads_note: string | null;
  pk_ready: boolean;
  product_set_title: string | null;
  product_connected_tap: boolean;
  fokus_produk: string | null;
  actual_start: string | null;
  actual_end: string | null;
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
  deals_by: DealsBy | null;
  ads_payer: AdsPayer | null;
  ads_note: string | null;
  pk_ready: boolean;
  product_set_title: string | null;
  product_connected_tap: boolean;
  fokus_produk: string | null;
  created_by: string;
}
