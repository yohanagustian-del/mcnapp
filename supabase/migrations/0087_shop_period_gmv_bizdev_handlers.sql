-- ============================================================
-- 0087_shop_period_gmv_bizdev_handlers.sql
-- Revisi BizDev 2026-10 (docs/plans/REVISI_BIZDEV_2026-10.md §3, T3).
--
-- 1. creator_shop_period_gmv — agregat kreator × shop × periode yang ditulis ingest
--    mingguan dari baris MCN + TAP yang SAMA dengan analisa bocor (tanpa parse ulang,
--    CLAUDE.md #4). SATU-SATUNYA sumber GMV per shop: summary BizDev, TAP Matchmaking,
--    dan Report Brand v2 membacanya, tidak menghitung ulang. Batch lama (sebelum
--    migrasi ini) tidak punya baris → UI bilang "belum diupload dengan versi baru",
--    bukan nol.
-- 2. brand_bizdev_handlers — BizDev penanggung jawab brand (maks 2 per shop_key).
--    Shop tanpa baris = "Non BD Handle".
-- 3. View shop_period_summary & bizdev_brand_perf (security_invoker) — agregasi di SQL.
-- 4. brand_reports v2 (Report Brand berbasis shop, 0 LLM) + tambal restrictive deny
--    is_creator_user() yang tertinggal sejak 0006.
-- 5. Seed app_config m8.brand_report_rules & m8.bizdev_summary.
--
-- Tulis ke tabel baru HANYA lewat service role (server action / ingest); RLS select
-- authenticated + restrictive deny creator (CLAUDE.md #9). Constraint
-- platform_alerts_alert_type_check TIDAK disentuh (drift, lihat HANDOFF 2026-10-01).
-- Idempotent: aman dijalankan ulang lewat apply_migration.
-- ============================================================

-- ============ 1. creator_shop_period_gmv ============
create table if not exists creator_shop_period_gmv (
  platform text not null default 'tiktok' check (platform in ('tiktok', 'shopee')),
  -- on delete cascade: baris turunan murni dari upload mingguan (sama sifatnya dengan
  -- DERIVED_CHILDREN di lib/creators/delete.ts) — tidak boleh menghalangi hapus kreator.
  creator_id text not null references creators(id) on delete cascade,
  shop_id text not null,
  shop_name text,
  period_start date not null,
  period_end date not null,
  upload_batch text not null,
  -- MCN (semua transaksi affiliate kreator di shop ini)
  gmv_mcn numeric not null default 0,
  gmv_mcn_live numeric not null default 0,
  gmv_mcn_video numeric not null default 0,
  orders_mcn int not null default 0,
  items_sold_mcn int not null default 0,
  -- TAP (lewat link agency). NULL = tidak ada data TAP untuk platform/batch ini
  -- (Shopee fase 1, Q4; atau upload tanpa file TAP) — BUKAN nol.
  gmv_tap numeric,
  gmv_tap_live numeric,
  gmv_tap_video numeric,
  orders_tap int,
  est_partner_commission numeric,
  actual_partner_commission numeric,
  est_creator_commission numeric,
  actual_creator_commission numeric,
  created_at timestamptz not null default now(),
  primary key (platform, creator_id, shop_id, period_start, upload_batch)
);
create index if not exists creator_shop_period_gmv_shop_idx on creator_shop_period_gmv (shop_id, period_start);
create index if not exists creator_shop_period_gmv_creator_idx on creator_shop_period_gmv (creator_id, period_start);
create index if not exists creator_shop_period_gmv_batch_idx on creator_shop_period_gmv (upload_batch);

alter table creator_shop_period_gmv enable row level security;
drop policy if exists cspg_select on creator_shop_period_gmv;
create policy cspg_select on creator_shop_period_gmv for select to authenticated using (true);
drop policy if exists cspg_creator_deny on creator_shop_period_gmv;
create policy cspg_creator_deny on creator_shop_period_gmv as restrictive for select
  using (not is_creator_user());

comment on table creator_shop_period_gmv is
  'Agregat kreator × shop × periode dari ingest mingguan (MCN + TAP). Satu-satunya sumber GMV per shop (CLAUDE.md #4). gmv_tap NULL = data TAP tidak tersedia (Shopee fase 1 / tanpa file TAP), bukan nol.';

-- ============ 2. brand_bizdev_handlers ============
create table if not exists brand_bizdev_handlers (
  shop_key text not null,
  member_id uuid not null references team_members(id),
  assigned_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  primary key (shop_key, member_id)
);
create index if not exists brand_bizdev_handlers_member_idx on brand_bizdev_handlers (member_id);

-- Maks 2 BizDev per brand — ditegakkan juga di server action (pesan Bahasa Indonesia).
create or replace function brand_bizdev_handlers_max2() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from brand_bizdev_handlers where shop_key = new.shop_key) >= 2 then
    raise exception 'Maksimal 2 BizDev per brand (shop_key %)', new.shop_key
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_brand_bizdev_handlers_max2 on brand_bizdev_handlers;
create trigger trg_brand_bizdev_handlers_max2
  before insert on brand_bizdev_handlers
  for each row execute function brand_bizdev_handlers_max2();

alter table brand_bizdev_handlers enable row level security;
drop policy if exists bbh_select on brand_bizdev_handlers;
create policy bbh_select on brand_bizdev_handlers for select to authenticated using (true);
drop policy if exists bbh_creator_deny on brand_bizdev_handlers;
create policy bbh_creator_deny on brand_bizdev_handlers as restrictive for select
  using (not is_creator_user());

comment on table brand_bizdev_handlers is
  'BizDev penanggung jawab brand per shop_key (= products_tap/brand_deals.shop_key), maks 2. Tanpa baris = "Non BD Handle".';

-- ============ 3a. shop_period_summary ============
create or replace view shop_period_summary
with (security_invoker = on) as
select
  g.platform,
  g.shop_id,
  max(nullif(btrim(g.shop_name), '')) as shop_name,
  g.period_start,
  max(g.period_end) as period_end,
  count(distinct g.creator_id) as creator_count,
  count(distinct g.creator_id) filter (where coalesce(g.gmv_tap, 0) > 0) as creator_tap_count,
  sum(g.gmv_mcn) as gmv_mcn,
  sum(g.gmv_mcn_live) as gmv_mcn_live,
  sum(g.gmv_mcn_video) as gmv_mcn_video,
  sum(g.orders_mcn) as orders_mcn,
  sum(g.items_sold_mcn) as items_sold_mcn,
  -- sum() atas semua NULL = NULL → "GMV TAP belum tersedia" tetap jujur, bukan 0.
  sum(g.gmv_tap) as gmv_tap,
  sum(g.gmv_tap_live) as gmv_tap_live,
  sum(g.gmv_tap_video) as gmv_tap_video,
  sum(g.orders_tap) as orders_tap,
  sum(g.est_partner_commission) as est_partner_commission,
  sum(g.actual_partner_commission) as actual_partner_commission,
  sum(g.est_creator_commission) as est_creator_commission,
  sum(g.actual_creator_commission) as actual_creator_commission
from creator_shop_period_gmv g
group by g.platform, g.shop_id, g.period_start;

-- ============ 3b. bizdev_brand_perf ============
-- (platform, shop_id) → shop_key lewat products_tap/brand_deals di SQL (ekspresi
-- shop_key TIDAK disalin ke aplikasi, CLAUDE.md #4/#6). Satu shop_id bisa muncul di
-- beberapa kartu dengan ejaan nama berbeda → distinct on memilih satu shop_key
-- (kartu produk didahulukan) supaya GMV tidak terhitung dua kali. Shop yang tidak
-- punya kartu/deal (bukan brand ber-deal) tidak masuk view ini. Brand dengan 2
-- handler muncul 2 baris (dihitung penuh di keduanya); tanpa handler → member_id NULL
-- ("Non BD Handle").
create or replace view bizdev_brand_perf
with (security_invoker = on) as
with shop_map as (
  select distinct on (m.platform, m.shop_id) m.platform, m.shop_id, m.shop_key
  from (
    select p.platform, btrim(p.shop_id) as shop_id, p.shop_key, 1 as pri
      from products_tap p
     where p.shop_id is not null and btrim(p.shop_id) <> ''
    union all
    select d.platform, btrim(d.shop_id) as shop_id, d.shop_key, 2 as pri
      from brand_deals d
     where d.shop_id is not null and btrim(d.shop_id) <> ''
  ) m
  order by m.platform, m.shop_id, m.pri, m.shop_key
)
select
  s.platform,
  s.shop_id,
  s.shop_name,
  m.shop_key,
  s.period_start,
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
join shop_map m on m.platform = s.platform and m.shop_id = s.shop_id
left join brand_bizdev_handlers h on h.shop_key = m.shop_key
left join team_members tm on tm.id = h.member_id;

-- ============ 4. brand_reports v2 ============
alter table brand_reports alter column deal_id drop not null;
alter table brand_reports add column if not exists shop_key text;
alter table brand_reports add column if not exists platform text
  check (platform is null or platform in ('tiktok', 'shopee'));
alter table brand_reports add column if not exists schema_version int not null default 1;
alter table brand_reports add column if not exists edits_json jsonb;
alter table brand_reports add column if not exists status text not null default 'draft';
alter table brand_reports add column if not exists finalized_by uuid references team_members(id);
alter table brand_reports add column if not exists finalized_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brand_reports_status_check') then
    alter table brand_reports add constraint brand_reports_status_check check (status in ('draft', 'final'));
  end if;
  -- v1 = per deal (deal_id wajib), v2 = per shop (shop_key wajib).
  if not exists (select 1 from pg_constraint where conname = 'brand_reports_owner_check') then
    alter table brand_reports add constraint brand_reports_owner_check
      check (deal_id is not null or shop_key is not null);
  end if;
end $$;
create index if not exists brand_reports_shop_key_idx on brand_reports (shop_key, period_start);

-- Portal kreator tidak boleh membaca report brand (dulu hanya policy select
-- authenticated using(true) dari 0006) — pola sama products_tap/brand_leads.
drop policy if exists brand_reports_creator_deny on brand_reports;
create policy brand_reports_creator_deny on brand_reports as restrictive for select
  using (not is_creator_user());

comment on column brand_reports.schema_version is
  '1 = report lama per deal (upload file + LLM opsional, read-only sejak 2026-10); 2 = Report Brand v2 per shop dari creator_shop_period_gmv, 0 LLM.';

-- ============ 5. app_config ============
insert into app_config (key, value) values
  ('m8.brand_report_rules', '{
    "tap_share_low": 0.5,
    "tap_share_high": 0.8,
    "wow_growth_up": 0.1,
    "wow_growth_down": -0.1,
    "live_share_high": 0.6,
    "video_share_high": 0.6,
    "top_creators": 10,
    "untapped_creator_gmv_min": 1000000
  }'::jsonb),
  ('m8.bizdev_summary', '{ "default_period": "month" }'::jsonb)
on conflict (key) do nothing;
