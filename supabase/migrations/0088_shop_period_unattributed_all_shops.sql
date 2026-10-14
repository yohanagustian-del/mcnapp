-- ============================================================
-- 0088_shop_period_unattributed_all_shops.sql
-- Revisi BizDev 2026-10 — jawaban user 2026-10-14 atas keputusan tertunda (plan §7, F3):
--
-- K6: GMV TAP yang tidak bisa dikaitkan ke kreator file MCN (baris TAP tanpa nama di
--     file multi-kreator, nama tak ter-resolve, atau shop tanpa GMV MCN) TIDAK lagi
--     dibagi proporsional / dibuang: dicatat per shop di creator_shop_period_unattributed_tap
--     dan ikut terhitung di GMV TAP shop dengan label "Nama kreator tidak ada"
--     (creator_id NULL di view).
-- K4: bizdev_brand_perf memuat SEMUA shop (left join shop_key_map) — shop tanpa kartu/
--     deal ikut "Non BD Handle" (shop_key NULL).
-- K5: shop_key_map tidak lagi memilih satu shop_key per shop_id — satu shop_id dengan
--     beberapa ejaan Shop Name tampil di tiap shop_key (GMV tampil dobel, disengaja).
--
-- Bentuk kolom keempat view TIDAK berubah (create or replace view). File ini SENGAJA
-- tanpa pernyataan hapus policy/trigger: apply_migration Supabase menggantung pada pernyataan
-- itu di sesi cloud (HANDOFF 2026-10-13, K23) — policy dibuat lewat blok idempotent.
-- Tulis HANYA lewat service role (ingest); RLS select authenticated + restrictive deny
-- is_creator_user() (CLAUDE.md #9).
-- ============================================================

-- ============ 1. creator_shop_period_unattributed_tap ============
create table if not exists creator_shop_period_unattributed_tap (
  platform text not null default 'tiktok' check (platform in ('tiktok', 'shopee')),
  shop_id text not null,
  shop_name text,
  period_start date not null,
  period_end date not null,
  upload_batch text not null,
  -- Kreator file MCN pasangannya — lingkup hapus-lalu-tulis saat upload ulang (sama
  -- dengan creator_shop_period_gmv yang dihapus per kreator × minggu).
  source_creator_ids text[] not null default '{}',
  gmv_tap numeric not null default 0,
  gmv_tap_live numeric not null default 0,
  gmv_tap_video numeric not null default 0,
  orders_tap int not null default 0,
  est_partner_commission numeric,
  actual_partner_commission numeric,
  est_creator_commission numeric,
  actual_creator_commission numeric,
  created_at timestamptz not null default now(),
  primary key (platform, shop_id, period_start, upload_batch)
);
create index if not exists cspu_tap_period_idx on creator_shop_period_unattributed_tap (platform, period_start);
create index if not exists cspu_tap_sources_idx on creator_shop_period_unattributed_tap using gin (source_creator_ids);

alter table creator_shop_period_unattributed_tap enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_period_unattributed_tap' and policyname = 'cspu_tap_select') then
    create policy cspu_tap_select on creator_shop_period_unattributed_tap for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_period_unattributed_tap' and policyname = 'cspu_tap_creator_deny') then
    create policy cspu_tap_creator_deny on creator_shop_period_unattributed_tap as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

comment on table creator_shop_period_unattributed_tap is
  'GMV TAP per shop × periode yang tidak bisa dikaitkan ke kreator file MCN (K6). Ikut terhitung di shop_period_summary/creator_shop_perf sebagai creator_id NULL = "Nama kreator tidak ada".';

-- ============ 2. shop_period_summary (+ baris tanpa kreator) ============
create or replace view shop_period_summary
with (security_invoker = on) as
with base as (
  select g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_start, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select u.platform, null::text, u.shop_id, u.shop_name, u.period_start, u.period_end,
         0::numeric, 0::numeric, 0::numeric, 0, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap,
         u.est_partner_commission, u.actual_partner_commission,
         u.est_creator_commission, u.actual_creator_commission
    from creator_shop_period_unattributed_tap u
),
grained as (
  select 'week'::text as period_kind, b.period_start as period_key, b.* from base b
  union all
  select 'month'::text, date_trunc('month', b.period_start)::date, b.* from base b
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

-- ============ 3. shop_key_map (K5: semua shop_key per shop_id) ============
create or replace view shop_key_map
with (security_invoker = on) as
select distinct m.platform, m.shop_id, m.shop_key
from (
  select p.platform, btrim(p.shop_id) as shop_id, p.shop_key
    from products_tap p
   where p.shop_id is not null and btrim(p.shop_id) <> ''
  union all
  select d.platform, btrim(d.shop_id) as shop_id, d.shop_key
    from brand_deals d
   where d.shop_id is not null and btrim(d.shop_id) <> ''
) m;

-- ============ 4. bizdev_brand_perf (K4: semua shop) ============
create or replace view bizdev_brand_perf
with (security_invoker = on) as
select
  s.platform,
  s.shop_id,
  s.shop_name,
  m.shop_key,
  s.period_kind,
  s.period_key,
  s.period_end,
  s.creator_count,
  s.creator_tap_count,
  s.gmv_mcn,
  s.gmv_mcn_live,
  s.gmv_mcn_video,
  s.orders_mcn,
  s.gmv_tap,
  s.gmv_tap_live,
  s.gmv_tap_video,
  s.orders_tap,
  s.est_partner_commission,
  s.actual_partner_commission,
  h.member_id,
  tm.name as member_name
from shop_period_summary s
left join shop_key_map m on m.platform = s.platform and m.shop_id = s.shop_id
left join brand_bizdev_handlers h on h.shop_key = m.shop_key
left join team_members tm on tm.id = h.member_id;

-- ============ 5. creator_shop_perf (+ baris tanpa kreator) ============
create or replace view creator_shop_perf
with (security_invoker = on) as
with base as (
  select g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_start,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select u.platform, null::text, u.shop_id, u.shop_name, u.period_start,
         0::numeric, 0::numeric, 0::numeric, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap, u.actual_partner_commission
    from creator_shop_period_unattributed_tap u
),
grained as (
  select 'week'::text as period_kind, b.period_start as period_key, b.* from base b
  union all
  select 'month'::text, date_trunc('month', b.period_start)::date, b.* from base b
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
