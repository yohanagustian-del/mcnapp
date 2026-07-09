-- ============================================================
-- 0013_m11_governance.sql  (draft 0010 → renumbered; corrected to real schema)
-- Module 11: OD Portal (od_viewer read-only) + Multi-Director.
--
-- Multi-Director + guard_last_director + is_od_viewer() already shipped in 0010_rbac_foundation.
-- This migration adds:
--   - od_oversight_v: cross-team read-only KPI surface (read via service role by the /od page).
--   - Restrictive write-deny policies for the od_viewer principal on every mutable table
--     (INSERT/UPDATE/DELETE) — defense-in-depth beyond requirePermission (server-side).
--     SELECT is intentionally NOT denied (od_viewer is read-all).
-- Note: internal writes go through the service-role client (BYPASSRLS); these restrictive
--       policies only further-constrain a hypothetical od_viewer JWT (internal → not is_od_viewer()
--       → TRUE → unaffected).
-- ============================================================

-- ---------- 1. OD oversight view (cross-team, read-only) ----------
-- security_invoker=on: the /od page reads via service role (full data); a raw od_viewer JWT is
-- limited by base-table RLS (defense-in-depth). Avoids the SECURITY DEFINER advisor error.
create or replace view od_oversight_v with (security_invoker = on) as
select
  h.cpm_id,
  h.cpm_name,
  h.report_count,
  h.creators_covered,
  h.complaint_count,
  h.complaint_weighted,
  h.repeat_complaint_creators
from cpm_health_v h;

-- ---------- 2. od_viewer write-deny (SELECT allowed, mutations rejected) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'creators','brand_deals','deal_products','agency_links','cooperating_shops',
    'creator_requests','campaign_requests','creator_contracts','acquisitions','referrals',
    'special_projects','project_participants','project_manpower','project_daily_metrics',
    'project_creator_metrics','platform_metrics_raw','creator_reports','cpm_report_activity',
    'okr_key_results','okr_actuals','okr_snapshots','okr_gating_events','reward_tiers',
    'app_config','team_members',
    'creator_users','creator_report_credits','creator_complaints','complaint_replies',
    'creator_feedback','project_join_requests','ads_briefs','ads_campaign_results'
  ] loop
    execute format(
      'create policy %I_od_no_insert on %I as restrictive for insert with check (not is_od_viewer());', t, t);
    execute format(
      'create policy %I_od_no_update on %I as restrictive for update using (not is_od_viewer());', t, t);
    execute format(
      'create policy %I_od_no_delete on %I as restrictive for delete using (not is_od_viewer());', t, t);
  end loop;
exception when duplicate_object then null;
end $$;
