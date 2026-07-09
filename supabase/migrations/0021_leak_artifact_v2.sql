-- Leak Artifact v2: support the NEW "Agency Leaked Generator" export format.
-- The external tool now ships two renamed/reshaped sheets per file:
--   File 1 "MEA_Agency_Link_Detail_*.xlsx": "Ringkasan Creator" (period + CM-level
--     totals + per-creator GMV only — no per-creator leak/TAP/status breakdown) and
--     "Produk Bocor (Partnered Shops)" (product detail, not persisted).
--   File 2 "MEA_BD_Opportunity_*.xlsx": a shop-level BD summary sheet (name varies:
--     "Ringkasan Shop Non-Partnered" / "Ringkasan Peluang BD Shops" — detected by
--     probing header content, not sheet name), routed through the existing bd_leads
--     writer unchanged.
--
-- Format v2 cannot fill per-creator link_status/gmv_bocor/leak_ratio (the source
-- report has no per-creator leak breakdown) — those columns must become nullable.
-- The CM-level totals (Total Creator Affiliate GMV / Total TAP GMV / Potential
-- Leak) that v2 DOES have are stored once per (week, uploader) in a new table,
-- leak_week_summary, instead of being force-distributed across creators.

-- ============ creator_link_status: widen for v2 (unknown-per-creator rollup) ============
-- 0004 declared link_status / gmv_bocor / gmv_deal_total NOT NULL because the M4
-- engine (source='engine') always computes a full rollup. Format-v2 artifact rows
-- (source='artifact', partial data) legitimately have no per-creator basis for
-- these fields — drop NOT NULL so the v2 pipeline can store "unknown" as null
-- instead of a fabricated 0/status. leak_ratio was already nullable (0004).
alter table creator_link_status alter column link_status drop not null;
alter table creator_link_status alter column gmv_bocor drop not null;
alter table creator_link_status alter column gmv_deal_total drop not null;

comment on column creator_link_status.link_status is
  'Rollup status (via_agency|bocor_sebagian|bocor_total|belum_ada_link). NULL only for source=''artifact'' format-v2 rows where the per-creator leak breakdown is unavailable (unknown, not zero).';
comment on column creator_link_status.gmv_bocor is
  'Leaked GMV on partnered/ber-deal shops. NULL only for source=''artifact'' format-v2 rows (unknown, not zero) — see gmv_affiliate_total for the only figure v2 provides per creator.';
comment on column creator_link_status.gmv_deal_total is
  'GMV on partnered/ber-deal shops (gmv_tap + gmv_bocor). NULL only for source=''artifact'' format-v2 rows (unknown, not zero).';

-- ============ leak_week_summary: CM-level totals from format-v2 uploads ============
-- One row per (week, uploader): the three headline figures format v2 DOES carry
-- (Total Creator Affiliate GMV / Total TAP (Agency Link) GMV / Potential Leak),
-- kept at CM-granularity instead of being force-split across creators. Also used
-- by format-v1 uploads going forward (source_format='artifact_v1') so both formats
-- leave a comparable weekly trail.
create table leak_week_summary (
  id bigserial primary key,
  week date not null,               -- = artifact period_start (creator_link_status.week key)
  period_end date not null,
  gmv_affiliate_total numeric,      -- "Total Creator Affiliate GMV" / v1 sum of per-creator bullet
  gmv_tap numeric,                  -- "Total TAP (Agency Link) GMV" / v1 sum of per-creator bullet
  gmv_leak_potential numeric,       -- "Potential Leak (Partnered shops GMV not fully in TAP campaigns)"
  source_format text not null check (source_format in ('artifact_v1', 'artifact_v2')),
  uploaded_by uuid references team_members(id),
  created_at timestamptz default now(),
  unique (week, uploaded_by)
);
create index on leak_week_summary (week);
alter table leak_week_summary enable row level security;
create policy lws_select on leak_week_summary for select to authenticated using (true);
-- writes via service role only (uploadLeakArtifact orchestrator) — no user insert/update/delete policy.

comment on table leak_week_summary is
  'CM-level weekly totals from the external Agency Leaked Generator artifact (format v1 or v2). One row per (week, uploaded_by); delete-then-insert on re-upload. Per-creator detail lives in creator_link_status.';
comment on column leak_week_summary.week is 'Artifact period_start — same key as creator_link_status.week.';
comment on column leak_week_summary.gmv_affiliate_total is 'CM-level "Total Creator/Affiliate GMV" figure for the period.';
comment on column leak_week_summary.gmv_tap is 'CM-level "Total TAP (Agency Link) GMV" figure for the period.';
comment on column leak_week_summary.gmv_leak_potential is 'CM-level "Potential Leak" figure for the period (partnered-shop GMV not fully captured via TAP).';
comment on column leak_week_summary.source_format is 'Which artifact export format produced this row: artifact_v1 (Executive Summary/Creator_Detail_Sections) or artifact_v2 (Ringkasan Creator/Produk Bocor).';
