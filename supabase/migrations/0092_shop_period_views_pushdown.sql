-- ============================================================
-- 0092_shop_period_views_pushdown.sql
-- Perbaikan production 2026-10-16: /workspace/bizdev "Application error" (digest
-- 3485366862) — "Gagal memuat bizdev_brand_perf: canceling statement due to statement
-- timeout" (role authenticated: statement_timeout 8s).
--
-- Penyebab: shop_period_summary & creator_shop_perf (0088) membangun grain minggu+bulan
-- dari CTE `base` yang dirujuk DUA kali → Postgres MEMATERIALISASI seluruh
-- creator_shop_period_gmv (±766 ribu baris setelah upload ulang September) di setiap
-- query, baru kemudian memfilter period_kind/period_key. Satu halaman ±7 detik.
--
-- Perbaikan (bentuk kolom keempat view TIDAK berubah — create or replace view):
--   1. Grain ditulis sebagai 4 cabang UNION ALL yang masing-masing membaca tabel
--      langsung (tanpa CTE yang dirujuk dua kali) → filter periode turun ke tiap cabang,
--      cabang grain lain tereliminasi ('week' = 'month' → false).
--   2. Kunci bulan memakai date_trunc('month', period_start::timestamp)::date — IMMUTABLE
--      (timestamp tanpa zona), jadi bisa di-index. Nilainya sama dengan versi lama
--      (date_trunc pada timestamptz) untuk tanggal murni.
--   3. Index period_start + index ekspresi kunci bulan di kedua tabel sumber.
--   4. Policy deny is_creator_user() dibungkus (select ...) → dievaluasi sekali per
--      query (initPlan), bukan per baris. ALTER POLICY, bukan DROP (K23).
-- File ini tanpa pernyataan hapus apa pun (K23).
-- ============================================================

create index if not exists creator_shop_period_gmv_period_idx
  on creator_shop_period_gmv (period_start);
create index if not exists creator_shop_period_gmv_month_idx
  on creator_shop_period_gmv ((date_trunc('month', period_start::timestamp)::date));
create index if not exists cspu_tap_month_idx
  on creator_shop_period_unattributed_tap ((date_trunc('month', period_start::timestamp)::date));

alter policy cspg_creator_deny on creator_shop_period_gmv using (not (select is_creator_user()));
alter policy cspu_tap_creator_deny on creator_shop_period_unattributed_tap using (not (select is_creator_user()));
alter policy bbh_creator_deny on brand_bizdev_handlers using (not (select is_creator_user()));

-- ============ shop_period_summary ============
create or replace view shop_period_summary
with (security_invoker = on) as
with grained as (
  select 'week'::text as period_kind, g.period_start as period_key,
         g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select 'week'::text, u.period_start,
         u.platform, null::text, u.shop_id, u.shop_name, u.period_end,
         0::numeric, 0::numeric, 0::numeric, 0, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap,
         u.est_partner_commission, u.actual_partner_commission,
         u.est_creator_commission, u.actual_creator_commission
    from creator_shop_period_unattributed_tap u
  union all
  select 'month'::text, date_trunc('month', g.period_start::timestamp)::date,
         g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, date_trunc('month', u.period_start::timestamp)::date,
         u.platform, null::text, u.shop_id, u.shop_name, u.period_end,
         0::numeric, 0::numeric, 0::numeric, 0, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap,
         u.est_partner_commission, u.actual_partner_commission,
         u.est_creator_commission, u.actual_creator_commission
    from creator_shop_period_unattributed_tap u
)
select
  x.platform,
  x.shop_id,
  max(nullif(btrim(x.shop_name), '')) as shop_name,
  x.period_kind,
  x.period_key,
  max(x.period_end) as period_end,
  -- count(distinct) mengabaikan NULL: baris "Nama kreator tidak ada" tidak dihitung kreator.
  count(distinct x.creator_id) as creator_count,
  count(distinct x.creator_id) filter (where coalesce(x.gmv_tap, 0) > 0) as creator_tap_count,
  sum(x.gmv_mcn) as gmv_mcn,
  sum(x.gmv_mcn_live) as gmv_mcn_live,
  sum(x.gmv_mcn_video) as gmv_mcn_video,
  sum(x.orders_mcn) as orders_mcn,
  sum(x.items_sold_mcn) as items_sold_mcn,
  sum(x.gmv_tap) as gmv_tap,
  sum(x.gmv_tap_live) as gmv_tap_live,
  sum(x.gmv_tap_video) as gmv_tap_video,
  sum(x.orders_tap) as orders_tap,
  sum(x.est_partner_commission) as est_partner_commission,
  sum(x.actual_partner_commission) as actual_partner_commission,
  sum(x.est_creator_commission) as est_creator_commission,
  sum(x.actual_creator_commission) as actual_creator_commission
from grained x
group by x.platform, x.shop_id, x.period_kind, x.period_key;

-- ============ creator_shop_perf ============
create or replace view creator_shop_perf
with (security_invoker = on) as
with grained as (
  select 'week'::text as period_kind, g.period_start as period_key,
         g.platform, g.creator_id, g.shop_id, g.shop_name,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select 'week'::text, u.period_start,
         u.platform, null::text, u.shop_id, u.shop_name,
         0::numeric, 0::numeric, 0::numeric, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap, u.actual_partner_commission
    from creator_shop_period_unattributed_tap u
  union all
  select 'month'::text, date_trunc('month', g.period_start::timestamp)::date,
         g.platform, g.creator_id, g.shop_id, g.shop_name,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, date_trunc('month', u.period_start::timestamp)::date,
         u.platform, null::text, u.shop_id, u.shop_name,
         0::numeric, 0::numeric, 0::numeric, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap, u.actual_partner_commission
    from creator_shop_period_unattributed_tap u
)
select
  x.platform,
  x.creator_id,
  x.shop_id,
  max(nullif(btrim(x.shop_name), '')) as shop_name,
  x.period_kind,
  x.period_key,
  sum(x.gmv_mcn) as gmv_mcn,
  sum(x.gmv_mcn_live) as gmv_mcn_live,
  sum(x.gmv_mcn_video) as gmv_mcn_video,
  sum(x.orders_mcn) as orders_mcn,
  sum(x.gmv_tap) as gmv_tap,
  sum(x.gmv_tap_live) as gmv_tap_live,
  sum(x.gmv_tap_video) as gmv_tap_video,
  sum(x.orders_tap) as orders_tap,
  sum(x.actual_partner_commission) as actual_partner_commission
from grained x
group by x.platform, x.creator_id, x.shop_id, x.period_kind, x.period_key;
