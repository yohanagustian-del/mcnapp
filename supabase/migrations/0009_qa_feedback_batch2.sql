-- QA feedback batch 2 (contoh data asli: data creator.csv, export platform ;-delimited,
-- data TAP, BD master data, report performance Femmy, Creator TC & Celeb).
-- Covers: creators master enrichment (kolom sheet "data creator"), tracking report
-- campaign BD per sesi live (report all creator + report khusus per creator
-- exclusive MEA), dan daftar usulan creator per campaign (TC & Celeb).

-- ============ creators: kolom master sesuai sheet "data creator" ============
alter table creators
  add column if not exists username text,                -- handle TikTok/Shopee ("vikahere")
  add column if not exists profile_link text,            -- Link Akun
  add column if not exists phone text,                   -- No HP
  add column if not exists tim_akuisisi text,
  add column if not exists uid text,                     -- UID platform
  add column if not exists followers text,               -- range "20.100 - 50.000" (as-is)
  add column if not exists content_quality text,         -- Kualitas Konten
  add column if not exists join_date date,
  add column if not exists domisili text,
  add column if not exists alamat text,
  add column if not exists jenis_creator text,           -- live & vt | vt | live
  add column if not exists rc_live text,                 -- rate card live (teks bebas sheet)
  add column if not exists rc_video text,                -- rate card video/VT
  add column if not exists target_gmv_monthly numeric,
  add column if not exists total_konten int,
  add column if not exists notes_endorsement text;
create index if not exists creators_username_idx on creators (lower(username));

-- ============ deal_live_sessions: tracking report campaign BD per sesi live ============
-- Contoh: "Femmy Fyber x MEA - Report Performance" (all creator & per-creator).
-- Report all creator = semua baris deal; report khusus creator exclusive = filter
-- per creator_name (1 brand bisa punya >1 kreator exclusive MEA).
create table if not exists deal_live_sessions (
  id bigserial primary key,
  deal_id text references brand_deals(id) not null,
  creator_id text references creators(id),
  creator_name text not null,                            -- persis seperti di report BD
  session_date date,
  event text,                                            -- Payday | Reguler | Twindate | Special Session | ...
  support_ads text,                                      -- deal support ads per sesi ("$100" / "-")
  ads_spend_usd numeric,                                 -- Ads Spending ($)
  ads_spend_idr numeric,                                 -- IDR
  ss_link text,                                          -- SS Dashboard (link)
  gmv numeric default 0,
  roas numeric,
  upload_batch text,                                     -- null = input manual; batch upload replace
  created_by uuid references team_members(id),
  created_at timestamptz default now()
);
create index if not exists dls_deal_idx on deal_live_sessions (deal_id);
create index if not exists dls_deal_creator_idx on deal_live_sessions (deal_id, creator_name);
alter table deal_live_sessions enable row level security;
create policy dls_read on deal_live_sessions for select to authenticated using (true);

-- ============ deal_creator_proposals: daftar creator campaign (TC & Celeb) ============
create table if not exists deal_creator_proposals (
  id bigserial primary key,
  deal_id text references brand_deals(id) not null,
  username text not null,
  profile_link text,
  cm_name text,                                          -- Creator Manager
  tipe_kreator text,                                     -- Celebrity/Influencer | TC | ...
  channel text,                                          -- Live & VT | VT | Live
  gmv_l30d numeric,                                      -- GMV L30D (otomatis)
  requirement text,                                      -- Creator Requirement (SOW & ADS Support)
  rc_live text,
  rc_vt text,
  product_link text,
  domisili text,
  alamat text,
  phone text,
  brand_approval text,
  creator_approval text,
  shipping_status text,
  resi text,
  notes text,
  link_vt text,
  boost_code text,
  is_exclusive boolean default false,                    -- kreator exclusive MEA utk brand ini
  upload_batch text,
  created_at timestamptz default now()
);
create index if not exists dcp_deal_idx on deal_creator_proposals (deal_id);
alter table deal_creator_proposals enable row level security;
create policy dcp_read on deal_creator_proposals for select to authenticated using (true);
