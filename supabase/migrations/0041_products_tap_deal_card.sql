-- Produk TAP: kolom kartu deal (Registrasi Deal → tabel Produk TAP).
--
-- Konteks: form "Registrasi Deal" sekarang mendaftarkan KARTU PRODUK — isinya
-- persis header tabel Produk TAP (export TAP "Export link") ditambah dimensi
-- komersial yang tidak ada di export platform: tipe campaign, ads budget,
-- service fee, siapa yang menutup deal, dan PIC TAP. Barisnya masuk ke
-- products_tap, bukan tabel terpisah, supaya katalog produk tetap SATU sumber
-- (CLAUDE.md #4) dan kartu hasil registrasi bisa langsung dipakai matching.

alter table products_tap
  -- Non-berbayar dibedakan dua macam sesuai istilah BizDev: sample vs komisi extra.
  add column campaign_type text check (campaign_type in ('paid', 'sample', 'extra_commission')),
  -- Rupiah murni (form menolak teks); null = tidak relevan untuk tipe campaign ini.
  add column ads_budget numeric,
  add column service_fee numeric,
  -- Yang menutup deal (CM atau BizDev) dan PIC TAP-nya. Beda dengan uploaded_by:
  -- uploaded_by = akun yang menginput baris, deal_by = yang membawa dealnya.
  add column deal_by uuid references team_members(id),
  add column pic_tap uuid references team_members(id);

-- Sumber baru: baris yang lahir dari form Registrasi Deal, bukan upload file
-- export dan bukan derive ingest mingguan.
alter table products_tap drop constraint products_tap_source_check;
alter table products_tap add constraint products_tap_source_check
  check (source in ('master_upload', 'derived_tap', 'deal_register'));

create index products_tap_deal_by_idx on products_tap (deal_by);
create index products_tap_pic_tap_idx on products_tap (pic_tap);

comment on column products_tap.campaign_type is
  'paid | sample | extra_commission. Diisi form Registrasi Deal; export platform tidak membawanya.';
comment on column products_tap.ads_budget is
  'Ads budget (Rp murni). Wajib saat campaign_type = extra_commission.';
comment on column products_tap.service_fee is
  'Service fee (Rp murni). Wajib saat campaign_type = extra_commission.';
comment on column products_tap.deal_by is
  'team_members yang menutup deal (role CM atau BizDev). Bukan peng-input baris (uploaded_by).';
comment on column products_tap.pic_tap is
  'team_members yang jadi PIC TAP untuk kartu produk ini.';
comment on column products_tap.source is
  'master_upload = upload file export TAP; derived_tap = derive ingest mingguan; deal_register = form Registrasi Deal.';
