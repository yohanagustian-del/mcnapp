-- ============================================================
-- 0093_shop_period_month_column.sql
-- Lanjutan 0092 (2026-10-16): /workspace/bizdev MASIH timeout untuk user biasa.
-- 0092 diuji sebagai superuser (tanpa RLS) → index kunci bulan terpakai. Sebagai role
-- authenticated, view security_invoker menerapkan RLS, dan Postgres TIDAK BOLEH
-- mendorong filter yang memakai fungsi non-leakproof (date_trunc) ke bawah policy →
-- index ekspresi 0092 tidak dipakai, kembali Seq Scan ±766rb baris per halaman →
-- statement timeout 8s (direproduksi: set role authenticated + explain).
--
-- Perbaikan: kunci bulan disimpan sebagai kolom GENERATED STORED `period_month` di kedua
-- tabel sumber. View memfilter `period_month = <tanggal>` — operator date = date
-- leakproof, jadi boleh lewat RLS dan memakai index. Nilai sama persis dengan 0092.
-- Index ekspresi 0092 dibiarkan (tanpa pernyataan hapus apa pun, K23).
-- Penulis ingest (shop-period-write.ts) meng-insert kolom eksplisit → tidak menyentuh
-- kolom generated.
-- ============================================================

alter table creator_shop_period_gmv
  add column if not exists period_month date
  generated always as (date_trunc('month', period_start::timestamp)::date) stored;
alter table creator_shop_period_unattributed_tap
  add column if not exists period_month date
  generated always as (date_trunc('month', period_start::timestamp)::date) stored;

create index if not exists creator_shop_period_gmv_period_month_idx
  on creator_shop_period_gmv (period_month);
create index if not exists cspu_tap_period_month_idx
  on creator_shop_period_unattributed_tap (period_month);

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
  select 'month'::text, g.period_month,
         g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, u.period_month,
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
  select 'month'::text, g.period_month,
         g.platform, g.creator_id, g.shop_id, g.shop_name,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, u.period_month,
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
