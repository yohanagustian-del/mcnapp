-- Product×Creator Matching (deterministic, rule-based, 0 LLM): products_tap master.
-- Source of truth for the TAP product catalog is a MERGE of (a) a manually
-- uploaded master product list and (b) rows derived/enriched automatically from
-- the weekly TAP file already ingested by Module 0.5 (/ingest). Column `source`
-- distinguishes the two so a master-upload row is never silently clobbered by a
-- derived-from-TAP upsert (see upsertDerivedFromTap in src/lib/m10/products.ts).
--
-- price_segment is computed from `price` using app_config `segments.price_bounds`
-- (same bounds/enum as creator_subcat_segment_gmv, projection/gmv.ts) — never
-- hardcoded here or in application code.
--
-- RLS follows the 0016/0017 baseline: select to authenticated (app-level scoping
-- in server actions, same as cpm_activity_select/txall_select precedent), writes
-- service-role only. Creator portal ("Produk Cocok Untukmu") reads via a server
-- action using createAdminClient() — NOT direct table RLS — so creator_user is
-- hard-denied here, mirroring the deny pattern for upload_batches (0017) and
-- leakage_products (0018).

create table products_tap (
  product_id text primary key,
  product_name text,
  shop_id text not null,
  shop_name text,
  level1_category text,
  level2_category text,
  price numeric,                      -- unit price: master upload value, or gmv/items_sold estimate from TAP
  price_segment price_segment_t,      -- derived from price + segments.price_bounds; null when price unknown
  commission_pct numeric,             -- parsed commission rate (percent); null when dirty/unparseable
  commission_note text,               -- flags dirty commission source value (CLAUDE.md #7): 'not found', 'range 5-7%', etc.
  source text not null check (source in ('master_upload', 'derived_tap')),
  active boolean not null default true,
  needs_review boolean not null default false,
  first_seen date,
  last_seen date,
  updated_at timestamptz not null default now()
);

create index products_tap_level2_idx on products_tap (level2_category);
create index products_tap_segment_idx on products_tap (price_segment);
create index products_tap_shop_idx on products_tap (shop_id);

alter table products_tap enable row level security;
create policy pt_select on products_tap for select to authenticated using (true);
-- writes via service role only (master upload action + upsertDerivedFromTap orchestrator).
create policy pt_creator_deny on products_tap as restrictive for select
  using (not is_creator_user());
