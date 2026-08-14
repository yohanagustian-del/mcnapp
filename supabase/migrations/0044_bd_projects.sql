-- Project BD: pengelompokan beberapa shop (brand) jadi satu project yang dipantau
-- bersama.
--
-- Kenapa ada: satu campaign BD sering menggarap BEBERAPA brand sekaligus (payday
-- bareng, event kolaborasi, project retainer). Tab Deal Brand memandang dunia per
-- shop; tab ini memandangnya per project, dan isinya TIDAK menghitung ulang apa
-- pun — shop, kartu produk, dan nominalnya dibaca dari `products_tap` /
-- `products_tap_shop_summary` (CLAUDE.md #4: satu sumber kebenaran).
--
-- Anggota project disimpan sebagai `shop_key`, kunci grup yang sama dengan tabel
-- "Shop dari Produk TAP" (kolom generated products_tap.shop_key, migrasi 0043).
-- SENGAJA bukan foreign key: shop bukan entitas tersendiri di database ini
-- melainkan hasil pengelompokan kartu produk, jadi tidak ada baris untuk direferensi.
-- Konsekuensinya jujur: kalau Shop Name diganti, kunci lama tidak lagi cocok dan
-- shop itu tampil sebagai "tidak ditemukan" di detail project — bukan hilang diam-diam.

create table bd_projects (
  id text primary key,                                   -- PRJ-xxxxx
  name text not null,
  notes text,
  status text check (status in ('running', 'hold', 'done')) default 'running',
  created_by uuid references team_members(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table bd_project_shops (
  project_id text references bd_projects(id) on delete cascade not null,
  -- = products_tap.shop_key. Bukan FK (lihat catatan di atas).
  shop_key text not null,
  primary key (project_id, shop_key)
);

create index bd_project_shops_shop_idx on bd_project_shops (shop_key);

comment on table bd_projects is
  'Project BD: beberapa shop/brand yang digarap sebagai satu campaign. Angkanya dibaca dari products_tap, tidak disimpan ulang.';
comment on column bd_project_shops.shop_key is
  'products_tap.shop_key (Shop Name → #shop_id). Bukan FK: shop adalah hasil grouping kartu produk, bukan tabel.';

alter table bd_projects enable row level security;
alter table bd_project_shops enable row level security;
-- Baca untuk semua akun tim; menulis lewat service role (server action yang sudah
-- menegakkan requirePermission), pola yang sama dengan products_tap (0019).
create policy bd_projects_read on bd_projects for select to authenticated using (true);
create policy bd_project_shops_read on bd_project_shops for select to authenticated using (true);

-- ============ Tracking report campaign: satu pipeline, dua pemilik ============
--
-- Report performance per sesi live & daftar creator (TC & Celeb) sudah punya
-- importer sendiri untuk brand deal. Project BD memakai format file yang sama
-- persis, jadi tabelnya DIPERLUAS — bukan digandakan jadi bd_project_sessions /
-- bd_project_creators. Menggandakannya berarti dua parser dan dua definisi ROAS
-- yang bisa berbeda diam-diam (CLAUDE.md #4).
--
-- Tepat satu pemilik per baris: deal ATAU project, tidak boleh dua-duanya dan
-- tidak boleh kosong (num_nonnulls = 1).

alter table deal_live_sessions
  alter column deal_id drop not null,
  add column project_id text references bd_projects(id) on delete cascade;
alter table deal_live_sessions
  add constraint dls_owner_chk check (num_nonnulls(deal_id, project_id) = 1);
create index dls_project_idx on deal_live_sessions (project_id);

alter table deal_creator_proposals
  alter column deal_id drop not null,
  add column project_id text references bd_projects(id) on delete cascade;
alter table deal_creator_proposals
  add constraint dcp_owner_chk check (num_nonnulls(deal_id, project_id) = 1);
create index dcp_project_idx on deal_creator_proposals (project_id);

comment on column deal_live_sessions.project_id is
  'Pemilik alternatif baris ini: Project BD. Tepat satu dari (deal_id, project_id) terisi.';
comment on column deal_creator_proposals.project_id is
  'Pemilik alternatif baris ini: Project BD. Tepat satu dari (deal_id, project_id) terisi.';
