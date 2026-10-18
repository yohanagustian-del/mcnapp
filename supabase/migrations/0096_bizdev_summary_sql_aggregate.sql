-- ============================================================
-- 0096_bizdev_summary_sql_aggregate.sql
-- Perbaikan production 2026-10-18: /workspace/bizdev tidak bisa terbuka (halaman
-- menggantung) untuk Management & BizDev Lead (m8.bizdev_summary_all).
--
-- Penyebab:
--   1. Halaman memuat SELURUH baris bizdev_brand_perf periode itu (Oktober 2026 =
--      51.370 baris shop) lewat 52 query berurutan @1000 baris, lalu mengagregasi di JS
--      dan mengirim ±51 ribu baris breakdown ke browser.
--   2. Tiap query itu membangun shop_key_map dari products_tap (±75 ribu baris) dan
--      policy restrictive `not is_creator_user()` di products_tap / brand_deals /
--      team_members dievaluasi PER BARIS (±1,9 dtk per query).
--
-- Perbaikan:
--   1. Policy deny ketiga tabel itu dibungkus (select ...) → initPlan, dievaluasi sekali
--      per query (pola 0092). ALTER POLICY, bukan DROP (K23). Semantik sama persis.
--   2. Agregasi Summary per BizDev pindah ke SQL (CLAUDE.md #4: agregasi di SQL, bukan JS):
--        bizdev_brand_breakdown  — satu baris per (periode × BizDev × brand)
--        bizdev_member_summary   — satu baris per (periode × BizDev) = kartu
--      Keduanya membaca bizdev_brand_perf APA ADANYA (tidak menghitung ulang GMV).
--      Aturan sama dengan buildBizdevSummary lama:
--        - brand = shop_key; shop tanpa kartu/deal (shop_key NULL) = per (platform, shop_id)
--        - brand ber-2 BizDev dihitung penuh di keduanya
--        - GMV TAP NULL (Shopee fase 1) bukan nol: penyebut %TAP/MCN hanya GMV MCN baris
--          yang GMV TAP-nya ada
--   Diukur (production, role authenticated, Oktober 2026): ±3–4,6 dtk → ±0,4 dtk.
--
-- View security_invoker → RLS tabel dasar (termasuk deny is_creator_user()) tetap
-- berlaku (CLAUDE.md #9). File ini tanpa pernyataan hapus apa pun (K23).
-- ============================================================

-- ============ 1. Policy deny: is_creator_user() sekali per query ============
alter policy pt_creator_deny on products_tap
  using (not (select is_creator_user()));
alter policy brand_deals_deny_creator on brand_deals
  using (not (select is_creator_user()));
alter policy team_members_deny_creator on team_members
  using (not (select is_creator_user()));

-- ============ 2. Breakdown per (periode × BizDev × brand) ============
create or replace view bizdev_brand_breakdown
with (security_invoker = on) as
select
  p.period_kind,
  p.period_key,
  p.member_id,
  max(p.member_name) as member_name,
  coalesce(p.shop_key, 'shop:' || p.platform || ':' || p.shop_id) as brand_key,
  p.shop_key,
  min(p.platform) as platform,
  coalesce(min(p.shop_name), p.shop_key, '#' || min(p.shop_id)) as shop_name,
  -- Teks pencarian (nama brand + nama BizDev) untuk filter ILIKE di server.
  coalesce(min(p.shop_name), p.shop_key, '#' || min(p.shop_id)) || ' ' || coalesce(max(p.member_name), '') as search_text,
  sum(coalesce(p.creator_count, 0)) as creator_count,
  sum(coalesce(p.creator_tap_count, 0)) as creator_tap_count,
  sum(coalesce(p.gmv_mcn, 0)) as gmv_mcn,
  coalesce(sum(coalesce(p.gmv_mcn, 0)) filter (where p.gmv_tap is not null), 0) as gmv_mcn_tap_known,
  coalesce(sum(coalesce(p.gmv_mcn, 0)) filter (where p.gmv_tap is null), 0) as gmv_mcn_tap_unknown,
  sum(p.gmv_tap) as gmv_tap,
  sum(p.actual_partner_commission) as actual_partner_commission
from bizdev_brand_perf p
group by
  p.period_kind,
  p.period_key,
  p.member_id,
  coalesce(p.shop_key, 'shop:' || p.platform || ':' || p.shop_id),
  p.shop_key;

-- ============ 3. Kartu per (periode × BizDev) ============
create or replace view bizdev_member_summary
with (security_invoker = on) as
select
  b.period_kind,
  b.period_key,
  b.member_id,
  max(b.member_name) as member_name,
  count(*) as brand_count,
  sum(b.gmv_mcn) as gmv_mcn,
  sum(b.gmv_mcn_tap_known) as gmv_mcn_tap_known,
  sum(b.gmv_mcn_tap_unknown) as gmv_mcn_tap_unknown,
  sum(b.gmv_tap) as gmv_tap,
  sum(b.actual_partner_commission) as actual_partner_commission
from bizdev_brand_breakdown b
group by b.period_kind, b.period_key, b.member_id;
