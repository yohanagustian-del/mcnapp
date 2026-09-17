-- ============================================================
-- 0062_m7_v2_live_session_products.sql
-- M7 v2 Special Project — simpan baris PER PRODUK dari file Product sesi live,
-- plus perbaikan dedupe V4 agar sesi yang dibatalkan bisa di-upload ulang.
--
-- Kenapa (QA produksi 2026-09-17): report peserta harus memakai angle KREATOR,
-- dan bagian "Produk terlaris" adalah satu-satunya bagian yang memberitahu
-- kreator APA yang laku — bukan sekadar berapa. Selama ini file Product hanya
-- di-SUM jadi total sesi lalu barisnya dibuang, sehingga project live-only tidak
-- punya sumber produk sama sekali (`project_creator_products` hanya diisi jalur
-- upload metrik produk, bukan jalur live).
-- ============================================================

-- ---------- 1. project_live_session_products (§9, baris file Product) ----------
create table project_live_session_products (
  id bigserial primary key,
  session_id bigint references project_live_sessions(id) on delete cascade not null,
  product_id text not null,
  product_name text,
  gmv numeric not null default 0,
  items int not null default 0,
  orders int not null default 0,
  customers int not null default 0,
  product_impressions int not null default 0,
  product_clicks int not null default 0,
  added_to_cart int not null default 0,
  created_at timestamptz not null default now(),
  -- Satu baris per produk per sesi: itulah bentuk file Product-nya (satu SKU
  -- muncul sekali). Duplikat = file cacat, ditolak daripada digandakan.
  unique (session_id, product_id)
);
create index idx_live_session_products_session on project_live_session_products (session_id);

-- RLS: sama persis dengan project_live_sessions/intervals (0056) — tim internal
-- boleh baca, creator_user ditolak restrictive. Portal kreator TIDAK membaca
-- tabel ini; angka produk sampai ke kreator lewat snapshot `creator_reports.data_json`.
alter table project_live_session_products enable row level security;
create policy live_session_products_select on project_live_session_products
  for select to authenticated using (true);
create policy live_session_products_deny_creator on project_live_session_products
  as restrictive for select using (not is_creator_user());

-- ---------- 2. Dedupe V4 hanya berlaku untuk sesi yang masih hidup ----------
-- Sebelumnya unique index mencakup SEMUA baris, termasuk yang `voided`. Akibatnya
-- membatalkan sesi tidak ada gunanya: file yang sama tidak akan pernah bisa
-- di-upload ulang, padahal "batalkan lalu upload ulang" adalah satu-satunya jalur
-- koreksi yang dipunyai tim (§10.2/§10.3). V4 tetap menolak file yang sama selama
-- sesinya masih dihitung — yang memang tujuannya.
drop index if exists idx_live_sessions_hash_product;
drop index if exists idx_live_sessions_hash_trend;
create unique index idx_live_sessions_hash_product
  on project_live_sessions (file_hash_product)
  where file_hash_product is not null and attribution_status <> 'voided';
create unique index idx_live_sessions_hash_trend
  on project_live_sessions (file_hash_trend)
  where file_hash_trend is not null and attribution_status <> 'voided';
