-- Fase 0: RBAC RLS policies per role (CLAUDE.md RBAC matrix)
-- Rules enforced here (server), not just UI:
--  - Management (director/head/spv) cross-team; staff scope sendiri; Finance dimensi pembayaran.
--  - agency_links & creators.commission_share: NO user write (engine/service role only).
--  - audit_logs immutable: users can neither write nor edit (service role only), management read.

-- ============ Helpers ============
create or replace function public.current_member_role() returns role_t
language sql stable security definer set search_path = public as $$
  select role from team_members where id = auth.uid() and active
$$;

create or replace function public.is_management() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.current_member_role() in ('director','head','spv'), false)
$$;

-- ============ Importer support ============
-- Legacy master-deal importer flags dirty rows for review (BUILD_PLAN Fase 0).
alter table brand_deals add column if not exists review_flags jsonb not null default '[]'::jsonb;

-- ============ Enable RLS on remaining tables ============
alter table app_config enable row level security;
alter table audit_logs enable row level security;
alter table platform_metrics_raw enable row level security;
alter table cpm_report_activity enable row level security;
alter table token_baseline enable row level security;
alter table transactions_all enable row level security;
alter table transactions_agency_link enable row level security;
alter table cooperating_shops enable row level security;
alter table bd_leads enable row level security;
alter table special_projects enable row level security;
alter table project_participants enable row level security;
alter table project_manpower enable row level security;
alter table project_daily_metrics enable row level security;
alter table creator_requests enable row level security;
alter table campaign_requests enable row level security;
alter table creator_contracts enable row level security;
alter table acquisitions enable row level security;
alter table referrals enable row level security;
alter table reward_tiers enable row level security;
alter table okr_key_results enable row level security;
alter table okr_actuals enable row level security;
alter table okr_snapshots enable row level security;
alter table okr_gating_events enable row level security;

-- ============ team_members ============
create policy tm_select on team_members for select to authenticated using (true);
create policy tm_insert_mgmt on team_members for insert to authenticated
  with check (public.is_management());
create policy tm_update_mgmt on team_members for update to authenticated
  using (public.is_management()) with check (public.is_management());

-- ============ app_config (thresholds; write = director only) ============
create policy cfg_select on app_config for select to authenticated using (true);
create policy cfg_write_director on app_config for all to authenticated
  using (public.current_member_role() = 'director')
  with check (public.current_member_role() = 'director');

-- ============ audit_logs (immutable; insert via service role only) ============
create policy audit_select_mgmt on audit_logs for select to authenticated
  using (public.is_management() or actor_id = auth.uid());
-- no insert/update/delete policies: users cannot touch the log (service role bypasses RLS).

-- ============ creators ============
-- read_auth (select) exists from 0001. Writes:
create policy creators_insert on creators for insert to authenticated
  with check (
    public.is_management()
    or public.current_member_role() in ('acquisition_lead','acquisition_spec','campaign_external')
  );
create policy creators_update on creators for update to authenticated
  using (
    public.is_management()
    or public.current_member_role() in ('cm_lead','cpm','acquisition_lead','acquisition_spec','creator_support')
  )
  with check (
    public.is_management()
    or public.current_member_role() in ('cm_lead','cpm','acquisition_lead','acquisition_spec','creator_support')
  );

-- commission_share = platform sync, read-only for humans even where row update is allowed.
create or replace function public.protect_commission_share() returns trigger
language plpgsql as $$
begin
  if new.commission_share is distinct from old.commission_share
     and coalesce(auth.jwt() ->> 'role', current_user) not in ('service_role','postgres','supabase_admin') then
    raise exception 'creators.commission_share is read-only (synced from platform; turun = alert, bukan edit)';
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_commission_share on creators;
create trigger trg_protect_commission_share before update on creators
  for each row execute function public.protect_commission_share();

-- ============ brand_deals ============
create policy deals_select on brand_deals for select to authenticated using (true);
create policy deals_insert on brand_deals for insert to authenticated
  with check (
    public.is_management()
    or public.current_member_role() in ('bizdev_lead','bizdev','bd_admin')
  );
create policy deals_update on brand_deals for update to authenticated
  using (
    public.is_management()
    or public.current_member_role() in ('bizdev_lead','bizdev','campaign_ops','bd_admin','finance')
  )
  with check (
    public.is_management()
    or public.current_member_role() in ('bizdev_lead','bizdev','campaign_ops','bd_admin','finance')
  );

-- ============ agency_links ============
-- select policy exists from 0001; deliberately NO insert/update/delete policy
-- (engine M4 writes via service role; link_status manual edit is forbidden for everyone).

-- ============ read-only-for-users pipeline & master tables ============
create policy shops_select on cooperating_shops for select to authenticated using (true);
create policy leads_select on bd_leads for select to authenticated using (true);
create policy txall_select on transactions_all for select to authenticated using (true);
create policy txagency_select on transactions_agency_link for select to authenticated using (true);
create policy metrics_select on platform_metrics_raw for select to authenticated using (true);
create policy reports_select on creator_reports for select to authenticated using (true);
create policy cpm_activity_select on cpm_report_activity for select to authenticated using (true);

-- ============ workspace tables (Fase 3 refines; baseline: authenticated read) ============
create policy creq_select on creator_requests for select to authenticated using (true);
create policy campreq_select on campaign_requests for select to authenticated using (true);
create policy contracts_select on creator_contracts for select to authenticated using (true);
create policy acq_select on acquisitions for select to authenticated using (true);
create policy ref_select on referrals for select to authenticated using (true);

-- ============ OKR tables (Fase 4 refines; Director owns config) ============
create policy okr_kr_select on okr_key_results for select to authenticated using (true);
create policy okr_kr_write_director on okr_key_results for all to authenticated
  using (public.current_member_role() = 'director')
  with check (public.current_member_role() = 'director');
create policy reward_select on reward_tiers for select to authenticated using (true);
create policy reward_write_director on reward_tiers for all to authenticated
  using (public.current_member_role() = 'director')
  with check (public.current_member_role() = 'director');
create policy okr_actuals_select on okr_actuals for select to authenticated using (true);
create policy okr_snapshots_select_mgmt on okr_snapshots for select to authenticated
  using (public.is_management());
create policy okr_gating_select_mgmt on okr_gating_events for select to authenticated
  using (public.is_management());
