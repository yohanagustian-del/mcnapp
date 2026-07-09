-- Leak Artifact Rollup: accept the weekly "Agency Leaked Generator" artifact output.
-- The M4 agency-leak ANALYSIS is now produced by an external tool (artifact) that
-- each CM runs weekly per creator, yielding two Excel files. The platform no longer
-- computes leak in /ingest; it only STORES the rollup per creator per week (product
-- detail stays in the Excel). This migration widens creator_link_status to carry the
-- extra artifact bullets, and records provenance ('engine' vs 'artifact').
--
-- Existing creator_link_status columns (0004): creator_id, week, gmv_deal_total,
-- gmv_bocor, leak_ratio, link_status, computed_at. gmv_deal_total / gmv_bocor /
-- leak_ratio / link_status are still recomputed deterministically on the platform
-- (same formula & app_config thresholds as the M4 engine) from the artifact bullets.

-- ============ creator_link_status: extra artifact rollup fields ============
-- All new numeric columns are nullable (engine-origin rows leave them null).
alter table creator_link_status
  add column if not exists gmv_affiliate_total numeric,  -- "Total Affiliate GMV" bullet
  add column if not exists gmv_tap numeric,              -- "Agency Link GMV (TAP)" bullet
  add column if not exists bd_opportunity_gmv numeric,   -- "Peluang BD (Non-Partnered Shops)" bullet
  add column if not exists direct_gmv numeric;           -- "Direct GMV" bullet

-- Provenance: engine (in-platform M4) vs artifact (external Agency Leaked Generator).
alter table creator_link_status
  add column if not exists source text not null default 'engine'
    check (source in ('engine', 'artifact'));

comment on column creator_link_status.gmv_affiliate_total is 'Artifact bullet: Total Affiliate GMV (all shops).';
comment on column creator_link_status.gmv_tap is 'Artifact bullet: Agency Link GMV via TAP.';
comment on column creator_link_status.bd_opportunity_gmv is 'Artifact bullet: BD opportunity GMV on non-partnered shops.';
comment on column creator_link_status.direct_gmv is 'Artifact bullet: Direct (non-affiliate) GMV.';
comment on column creator_link_status.source is 'Rollup origin: engine (in-platform M4) | artifact (external Agency Leaked Generator upload).';

-- ============ bd_leads.source: allow 'artifact' ============
-- 0001 constrained source to ('auto_m4','manual_cm'). The BD_Shop_Summary sheet of
-- the artifact creates/updates leads with source='artifact' (metrics-only update on
-- existing leads, never clobbering BizDev-managed status). Extend the CHECK.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'bd_leads'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source%';
  if c is not null then
    execute format('alter table bd_leads drop constraint %I', c);
  end if;
end $$;
alter table bd_leads
  add constraint bd_leads_source_check
  check (source in ('auto_m4', 'manual_cm', 'artifact'));
