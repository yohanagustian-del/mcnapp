-- ============================================================
-- 0084_brand_leads_bulk_search.sql
-- Brand Lead Bank (0067/0068): pencarian Nama Brand & Niche + upload massal
-- dari spreadsheet matchmaking (request user 2026-10-01).
--
-- Kolom baru mengikuti spreadsheet matchmaking BizDev ("Data Contoh
-- Matchmaking"): Bizdev, Grup Brand, Ads Brand. Kolom lain di file itu sudah
-- punya rumah (Nama Brand → shop_name, Niche → business_category, Link Toko →
-- store_link, Contact PIC → brand_lead_contacts, Sample/Flash Sale/Ads →
-- brand_support). Semuanya teks bebas & opsional — sama semangatnya dengan
-- form Registrasi Lead (lib/leads/brand-lead.ts): tidak ada kolom wajib selain
-- asal lead.
-- ============================================================

alter table brand_leads
  add column if not exists bizdev_names text,
  add column if not exists brand_group text,
  add column if not exists ads_scheme text;

comment on column brand_leads.bizdev_names is
  'Nama BD MEA yang memegang/menemukan lead (teks bebas, mis. "Erlina, Mizan") — kolom "Bizdev" di spreadsheet matchmaking. Bukan FK: nama di sheet lama tidak selalu sama dengan team_members.name.';
comment on column brand_leads.brand_group is
  'Grup koordinasi dengan brand (nama grup / link WhatsApp / Lark) — kolom "Grup Brand" di spreadsheet matchmaking.';
comment on column brand_leads.ads_scheme is
  'Skema ads brand (mis. "Ads By Brand - Minta Barcode", "Brand Invoice One Time - Cek BD", "Tidak Support Ads") — kolom "Ads Brand" di spreadsheet matchmaking.';

-- "Flash Sale" adalah dukungan brand yang paling sering muncul di spreadsheet
-- matchmaking selain Sample & Ads, tapi belum ada di enum 0067.
-- The 0067 check was declared inline (auto-named); drop it by definition rather
-- than trusting the generated name.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'brand_leads'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%brand_support%'
  loop
    execute format('alter table brand_leads drop constraint %I', c.conname);
  end loop;
end $$;
alter table brand_leads add constraint brand_leads_brand_support_check
  check (brand_support <@ array['tap','ads_support','hsl','sample','rate_card','flash_sale']::text[]);

-- Pencarian Nama Brand di /leads memakai ILIKE '%q%'; indeks btree biasa tidak
-- menolong pola itu, jadi cukup indeks niche untuk filter dropdown.
create index if not exists brand_leads_business_category_idx on brand_leads (lower(business_category));

-- Pilihan dropdown "Niche" di /leads: agregasi di SQL, bukan JS (CLAUDE.md).
-- Dikelompokkan case-insensitive supaya "Fashion" dan "fashion" tidak muncul
-- dua kali; label = ejaan terbanyak dipakai. security_invoker → RLS brand_leads
-- (termasuk deny is_creator_user 0068) tetap berlaku lewat view ini.
create or replace view brand_lead_niches with (security_invoker = on) as
select
  mode() within group (order by business_category) as niche,
  count(*)::int as lead_count
from brand_leads
where business_category is not null and btrim(business_category) <> ''
group by lower(btrim(business_category));

comment on view brand_lead_niches is
  'Daftar niche (business_category) Brand Lead Bank + jumlah lead, untuk filter dropdown /leads.';
