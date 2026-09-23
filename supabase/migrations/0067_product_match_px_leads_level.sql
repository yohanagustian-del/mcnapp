-- ============================================================
-- 0067_product_match_px_leads_level.sql
-- Fondasi skema untuk: (A) Creator Product Match satu-engine, (B) BD Value
-- Predictor pool model, (C) katalog PX Exchange via bridge CDPS→MCN,
-- (D) Brand Lead Bank BizDev, (E) level kreator vs tabel TikTok Affiliate.
-- Rencana lengkap: upload sesi ini "PLAN_MCN_PRODUCT_MATCH_PREDICTOR_LEADBANK_PX.md".
-- ============================================================

-- ---------- C. Katalog PX Exchange ("Seller manage by MEA") ----------
-- Snapshot PENUH dari CDPS (view px_catalog_item_v), dikirim lewat bridge
-- POST /api/bridge/px-catalog (Ticket 6). Tanpa GMV/pesanan/harga (D-06: angka
-- volume berhenti di CDPS) dan tanpa identitas kreator (K-2, sama seperti
-- Flow C sisi PX-M3-A). price_segment adalah data milik CDPS sendiri (bukan
-- dihitung ulang di sini) — reuse enum price_segment_t supaya satu taksonomi
-- dengan products_tap, bukan berarti dihitung dengan rumus yang sama.
create table px_catalog_items (
  client_platform_id text not null,
  platform_product_id text not null,
  nama_produk text,
  platform text,
  client_id text,
  nama_toko text,
  level2_category text,
  price_segment price_segment_t,
  sudah_afiliasi boolean not null default false,
  dihitung_pada timestamptz,
  active boolean not null default true,
  batch_key text not null,
  received_at timestamptz not null default now(),
  primary key (client_platform_id, platform_product_id)
);
create index px_catalog_items_level2_idx on px_catalog_items (level2_category);
create index px_catalog_items_active_idx on px_catalog_items (active) where active;
alter table px_catalog_items enable row level security;
create policy pxci_select on px_catalog_items for select to authenticated using (true);
-- Pola sama products_tap (pt_creator_deny): kreator tidak baca tabel ini
-- langsung — permukaan portal kreator (Ticket 10) lewat server action admin.
create policy pxci_creator_deny on px_catalog_items as restrictive for select
  using (not is_creator_user());
comment on table px_catalog_items is
  'Katalog PX Exchange dari CDPS (bridge POST /api/bridge/px-catalog). Snapshot PENUH tiap push: baris yang tidak terbawa di push terbaru → active=false (bukan dihapus). Tanpa GMV/harga/identitas kreator — lihat docs/BRIDGE_PX_CATALOG_CONTRACT.md.';
comment on column px_catalog_items.sudah_afiliasi is
  'Dari CDPS: SKU ini sudah terafiliasi (punya kreator terhubung) atau belum. Dipakai untuk urutan tampil di Product Match (belum afiliasi diprioritaskan).';

-- Log payload mentah tiap push (kunci idempotensi Idempotency-Key = batch_key).
-- Payload disimpan APA ADANYA untuk audit/replay; jangan pernah mutasi baris ini.
create table px_catalog_pushes (
  batch_key text primary key,
  payload jsonb not null,
  rows_received int not null,
  received_at timestamptz not null default now()
);
alter table px_catalog_pushes enable row level security;
-- Tanpa policy select/insert untuk authenticated: hanya service role (route
-- handler bridge) yang menyentuh tabel ini — payload mentah tidak untuk UI.
comment on table px_catalog_pushes is
  'Ledger idempotensi + arsip payload mentah tiap POST /api/bridge/px-catalog. batch_key = Idempotency-Key header. Immutable — retry dengan key sama mengembalikan hasil asli tanpa insert baris baru.';

-- ---------- D. Brand Lead Bank (BizDev) ----------
-- Lead BRAND ber-kontak (bukan bd_leads = lead SHOP otomatis dari M4/manual CM).
-- Semua BD lihat semua lead (permintaan user); edit oleh pembuat atau
-- bizdev_lead/management — gerbang per-baris di server action (pola K4 PX-M1),
-- bukan cuma daftar role.
create table brand_leads (
  id text primary key,
  source text not null check (source in ('matchmaking','event','iklan','rekomendasi','scouting','others')),
  source_other text,
  shop_name text,
  city text,
  business_category text,
  store_link text,
  platforms text[] not null default '{}' check (platforms <@ array['shopee','tiktok_shop']::text[]),
  marketing_budget numeric,
  target_roas numeric,
  brand_support text[] not null default '{}'
    check (brand_support <@ array['tap','ads_support','hsl','sample','rate_card']::text[]),
  status text not null default 'baru' check (status in ('baru','kontak','nego','deal','batal')),
  notes text,
  created_by uuid references team_members(id),
  bd_lead_id bigint references bd_leads(id),
  converted_deal_id text references brand_deals(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index brand_leads_status_idx on brand_leads (status);
create index brand_leads_created_by_idx on brand_leads (created_by);
alter table brand_leads enable row level security;
create policy brand_leads_select on brand_leads for select to authenticated using (true);
comment on table brand_leads is
  'Brand Lead Bank BizDev: lead brand ber-kontak (form Registrasi Lead), beda dari bd_leads (lead SHOP otomatis M4). Semua BD lihat semua baris; tulis via service role, gerbang edit (pembuat/bizdev_lead/management) di server action.';
comment on column brand_leads.bd_lead_id is
  'Opsional: terisi bila lead brand ini berasal dari shop potensial M4 (bd_leads).';
comment on column brand_leads.converted_deal_id is
  'Terisi setelah tombol "Buat Deal" dipakai dan deal-nya tersimpan di brand_deals.';

-- Baris-berulang "Data Prospek" (kontak PIC brand) di form Registrasi Lead.
create table brand_lead_contacts (
  id bigserial primary key,
  lead_id text not null references brand_leads(id) on delete cascade,
  lead_name text,
  phone text,
  email text,
  sort_order int not null default 0
);
create index brand_lead_contacts_lead_idx on brand_lead_contacts (lead_id);
alter table brand_lead_contacts enable row level security;
create policy brand_lead_contacts_select on brand_lead_contacts for select to authenticated using (true);
comment on table brand_lead_contacts is
  'Kontak PIC per brand lead (baris-berulang form Registrasi Lead). Minimal satu kontak ATAU shop_name terisi di brand_leads — divalidasi di lib/leads/brand-lead.ts, bukan di DB.';

-- ---------- E. Level kreator 0-8 ----------
-- L0 sekarang valid (TikTok Affiliate Level dimulai dari L0). Constraint lama
-- (migrasi 0024) hanya 1-8; dilonggarkan jadi 0-8. parseLevel (Ticket 4)
-- mengikuti pelonggaran ini.
alter table creators drop constraint if exists creators_level_check;
alter table creators add constraint creators_level_check check (level between 0 and 8);

-- ---------- app_config: threshold & tabel baru (CLAUDE.md — jangan hardcode) ----------
insert into app_config(key, value) values
  -- Jumlah produk TAP/PX ditampilkan per kategori kreator di Product Match.
  ('product_match.top_n', '8'),
  -- Konstanta rumus BD Value Predictor (pool model), disalin apa adanya dari
  -- HTML tim BD Value Predictor — Ticket 3 baca semuanya dari sini, jangan hardcode.
  ('m6.pool_model', '{
    "ramp_default": 0.70,
    "spread_base": 0.45,
    "spread_per_creator": 0.02,
    "spread_roas_factor": 0.012,
    "spread_min": 0.12,
    "spread_max": 0.45,
    "confidence_per_creator": 9,
    "confidence_roas_factor": 1.6,
    "confidence_roas_base": 6,
    "confidence_roas_cap": 20,
    "confidence_low_max": 40,
    "confidence_medium_max": 70,
    "roas_benchmark_pct": 8
  }'),
  -- Tabel level TikTok Affiliate (L0-L8): syarat hari aktif MTD TIDAK bisa
  -- diverifikasi dari data platform (agregat per periode) — hanya GMV MTD
  -- yang dipakai untuk estimasi batas-atas level (lib/creators/affiliate-level.ts).
  ('creators.affiliate_levels', '[
    {"level": 0, "minActiveDays": 1, "minGmv": 0},
    {"level": 1, "minActiveDays": 5, "minGmv": 0},
    {"level": 2, "minActiveDays": 15, "minGmv": 6500000},
    {"level": 3, "minActiveDays": 20, "minGmv": 20000000},
    {"level": 4, "minActiveDays": 25, "minGmv": 65000000},
    {"level": 5, "minActiveDays": 0, "minGmv": 196000000},
    {"level": 6, "minActiveDays": 0, "minGmv": 654000000},
    {"level": 7, "minActiveDays": 0, "minGmv": 6545000000},
    {"level": 8, "minActiveDays": 0, "minGmv": 20000000000}
  ]')
on conflict (key) do nothing;

-- projection.level_factors sudah ada (Fase 2, hanya kunci "1".."6") — tambah
-- 0/7/8 tanpa mengubah nilai 1-6 yang sudah dipakai M5/M6 (merge jsonb, bukan
-- timpa seluruh value; CLAUDE.md #4 — satu sumber, jangan bikin key kedua).
update app_config
set value = value || '{"0": 0.8, "7": 1.3, "8": 1.35}'::jsonb
where key = 'projection.level_factors';
