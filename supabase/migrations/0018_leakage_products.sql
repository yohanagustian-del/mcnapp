-- Module 0.5 follow-up: preserve per-product leak DETAIL after drop-raw.
-- The process-on-ingest/drop-raw pipeline deletes transactions_* right after
-- aggregation, so CM lost the "which shop / which product leaked" grain — only
-- the per-creator rollup (creator_link_status) survived. This table keeps a
-- short-retention (retention.leak_detail_weeks) copy of the leaking pairs so
-- CM can still inspect + download CSV within the window, while the leak SUMMARY
-- (creator_link_status) keeps a longer window (retention.leak_summary_weeks).
-- Both windows are enforced deterministically in src/lib/ingest/run.ts, values
-- from app_config (never hardcoded). Written by the M4 engine (service role);
-- read-only for users, denied for creator portal principals.
--
-- RLS mirrors the aggregate-table baseline in 0016 (select to authenticated;
-- writes service-role only) plus the restrictive creator-isolation pattern in
-- 0017 (creator_user hard-denied — leakage detail is internal-only).

-- ============ leakage_products (M4 detail, short retention) ============
create table leakage_products (
  id bigint generated always as identity primary key,
  creator_id text not null references creators(id),
  week date not null,
  shop_id text not null,
  shop_name text,
  product_id text not null,
  product_name text,
  gmv_all numeric not null default 0,        -- creator's GMV for this pair in CSV-1 (all)
  gmv_agency numeric not null default 0,      -- allocated agency-link GMV for this pair (CSV-2)
  gmv_bocor numeric not null default 0,       -- gmv_all - gmv_agency (leak), always > 0 here
  link_status text not null,                  -- pair status (via_agency|bocor_sebagian|bocor_total|belum_ada_link)
  upload_batch text not null,                 -- m4all:<week> provenance
  created_at timestamptz default now()
);
create index leakage_products_creator_week_idx on leakage_products (creator_id, week);
create index leakage_products_batch_idx on leakage_products (upload_batch);
create index leakage_products_week_idx on leakage_products (week);
alter table leakage_products enable row level security;
create policy lp_select on leakage_products for select to authenticated using (true);
-- writes via service role only (M4 engine).
create policy lp_creator_deny on leakage_products as restrictive for select
  using (not is_creator_user());

-- ============ bd_leads: shop_name for leak/lead reports ============
-- Platform master carries shop_name; the auto-M4 lead pipeline can now persist
-- it so BizDev sees a name, not just a numeric shop_id.
alter table bd_leads add column shop_name text;

-- ============ Config seed (retention windows for leak data) ============
insert into app_config(key, value) values
  ('retention.leak_detail_weeks', '4'),     -- leakage_products download window (~1 month)
  ('retention.leak_summary_weeks', '26')    -- creator_link_status rollup window
on conflict (key) do nothing;
