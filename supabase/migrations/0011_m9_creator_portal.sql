-- ============================================================
-- 0011_m9_creator_portal.sql  (draft 0008 → renumbered; corrected to real schema)
-- Module 9: Creator Portal (external principal creator_user).
-- Self-only RLS, 0 AI token (except report self-service 1/week, M2 pipeline),
-- tiered complaint resolution (CPM may close, log immutable), agency plan strips komisi_mea.
--
-- Corrections vs README draft (verified against 0001–0009):
--   - agency plan view built on deal_products (product-level), NOT brand_deals; strips komisi_mea_pct.
--   - brand_deals/deal_products status is lowercase 'running'.
--   - cpm_health_v filters team_members.role='cpm' only (no 'cm' role exists).
--   - creator isolation enforced with RESTRICTIVE policies (existing selects are permissive using(true)).
--   - JWT helpers (auth_creator_id/is_creator_user) already created in 0010_rbac_foundation.
-- Runtime note: the portal reads via the service-role client filtered by the session's creator_id
--   (primary isolation); the RLS below is defense-in-depth and requires the Supabase auth hook to
--   inject claims role=creator_user + creator_id for a creator JWT to be constrained.
-- ============================================================

-- ---------- 1. Principal creator_user (1 creator = 1 login) ----------
create table if not exists creator_users (
  id            uuid primary key default gen_random_uuid(),
  creator_id    text not null references creators(id) on delete cascade,
  email         text not null unique,
  auth_uid      uuid unique,                 -- auth.users.id; null while invited
  status        text not null default 'invited'
                  check (status in ('invited','active','suspended')),
  invite_token  text unique,                 -- manual link until Brevo is wired
  invited_by    uuid references team_members(id),
  invited_at    timestamptz not null default now(),
  activated_at  timestamptz,
  unique (creator_id)
);
create index if not exists idx_creator_users_creator on creator_users(creator_id);
create index if not exists idx_creator_users_auth on creator_users(auth_uid);

-- ---------- 2. creator_requests: add intake source (M8 reuse) ----------
alter table creator_requests
  add column if not exists source text not null default 'cpm'
    check (source in ('cpm','creator_portal'));

-- ---------- 3. Report self-service credit (1/creator/week, expires) ----------
create table if not exists creator_report_credits (
  id          bigserial primary key,
  creator_id  text not null references creators(id) on delete cascade,
  week_start  date not null,                 -- Monday of the ISO week
  used_at     timestamptz not null default now(),
  report_id   bigint references creator_reports(id),
  unique (creator_id, week_start)            -- guard: 1 credit/creator/week
);
create index if not exists idx_report_credits_creator on creator_report_credits(creator_id);

-- ---------- 4. Complaints (tiered resolution) + replies + feedback ----------
create table if not exists creator_complaints (
  id            bigserial primary key,
  creator_id    text not null references creators(id) on delete cascade,
  category      text not null,               -- from m9.complaint_categories
  severity      text not null default 'sedang'
                  check (severity in ('rendah','sedang','tinggi')),
  body          text not null,
  status        text not null default 'baru'
                  check (status in ('baru','dalam-penyelesaian','selesai')),
  target_cpm_id uuid references team_members(id),  -- owner CPM of the creator (auto)
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references team_members(id)
);
create index if not exists idx_complaints_creator on creator_complaints(creator_id);
create index if not exists idx_complaints_target on creator_complaints(target_cpm_id);
create index if not exists idx_complaints_status on creator_complaints(status);

-- Replies append-only (immutable). Internal roles add; nobody edits/deletes.
create table if not exists complaint_replies (
  id            bigserial primary key,
  complaint_id  bigint not null references creator_complaints(id) on delete cascade,
  author_id     uuid references team_members(id),
  author_role   text not null,               -- cpm / cm_lead / director
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_replies_complaint on complaint_replies(complaint_id);

-- Non-complaint feedback (suggestion/appreciation) — never scored negative.
create table if not exists creator_feedback (
  id          bigserial primary key,
  creator_id  text not null references creators(id) on delete cascade,
  body        text not null,
  sentiment   text default 'netral' check (sentiment in ('positif','netral','saran')),
  created_at  timestamptz not null default now()
);

-- ---------- 5. Special project join request ----------
create table if not exists project_join_requests (
  id          bigserial primary key,
  project_id  bigint not null references special_projects(id) on delete cascade,
  creator_id  text not null references creators(id) on delete cascade,
  status      text not null default 'diajukan'
                check (status in ('diajukan','diterima','ditolak')),
  created_at  timestamptz not null default now(),
  decided_by  uuid references team_members(id),
  decided_at  timestamptz,
  unique (project_id, creator_id)
);

alter table special_projects
  add column if not exists open_for_signup boolean not null default false,
  add column if not exists join_requirements text;   -- shown in portal

-- ============================================================
-- 6. VIEWS (surface, strip sensitive data)
-- ============================================================

-- 6a. Agency plan — ALL active plans, ONLY komisi_kreator (komisi_mea/margin stripped).
-- security_invoker=on: the portal reads this via the service-role client (BYPASSRLS) so it sees
-- every active plan; a raw creator JWT is denied on deal_products (see RLS below) and reaches
-- plans only through the portal server layer. komisi_mea_pct/ads_budget/service_fee never selected.
create or replace view creator_agency_plan_v with (security_invoker = on) as
select
  dp.deal_id,
  dp.product_id,
  dp.product_name,
  dp.product_link          as link,
  dp.niche,
  dp.komisi_kreator_pct    as komisi_kreator,   -- TikTok figure already net of MEA cut
  dp.exp_date,
  dp.status
from deal_products dp
where dp.status = 'running'
  and (dp.exp_date is null or dp.exp_date > now());

-- 6b. Own performance (M2 aggregate). security_invoker → self-filtered by platform_metrics_raw RLS.
create or replace view creator_metrics_v
with (security_invoker = on) as
select m.creator_id, m.period, m.metric, m.value, m.source
from platform_metrics_raw m;

-- 6c. Own project contribution (no margin). security_invoker → self-filtered by RLS.
create or replace view creator_project_progress_v
with (security_invoker = on) as
select pcm.project_id, pcm.creator_id, pcm.date, pcm.gmv_actual, pcm.items_sold,
       sp.name as project_name, sp.target_gmv
from project_creator_metrics pcm
join special_projects sp on sp.id = pcm.project_id;

-- 6d. CPM health (dual-signal) — for CM Lead/Director only (NOT creators).
-- Includes complaints with status='selesai' (closing does not erase the signal).
-- security_invoker=on: internal dashboards read via service role (full data); a creator JWT
-- gets nothing (base-table RLS denies), closing the definer-view leak flagged by the advisor.
create or replace view cpm_health_v with (security_invoker = on) as
select
  tm.id   as cpm_id,
  tm.name as cpm_name,
  coalesce(ra.report_count, 0)     as report_count,
  coalesce(ra.creators_covered, 0) as creators_covered,
  coalesce(c.complaint_count, 0)   as complaint_count,
  coalesce(c.weighted_severity, 0) as complaint_weighted,
  coalesce(c.repeat_creators, 0)   as repeat_complaint_creators
from team_members tm
left join (
  select cpm_id, count(*) report_count, count(distinct creator_id) creators_covered
  from cpm_report_activity group by cpm_id
) ra on ra.cpm_id = tm.id
left join (
  select target_cpm_id,
         count(*) complaint_count,
         sum(case severity when 'tinggi' then 3 when 'sedang' then 2 else 1 end) weighted_severity,
         count(*) filter (where rn > 1) repeat_creators
  from (
    select target_cpm_id, creator_id, severity,
           row_number() over (partition by target_cpm_id, creator_id order by created_at) rn
    from creator_complaints
  ) x
  group by target_cpm_id
) c on c.target_cpm_id = tm.id
where tm.role = 'cpm';

-- ============================================================
-- 7. RLS — new M9 tables (creator self-only; internal via service role)
-- ============================================================
alter table creator_users          enable row level security;
alter table creator_report_credits enable row level security;
alter table creator_complaints     enable row level security;
alter table complaint_replies      enable row level security;
alter table creator_feedback       enable row level security;
alter table project_join_requests  enable row level security;

create policy cu_self_read on creator_users
  for select using (is_creator_user() and creator_id = auth_creator_id());

create policy credit_self_read on creator_report_credits
  for select using (is_creator_user() and creator_id = auth_creator_id());
create policy credit_self_insert on creator_report_credits
  for insert with check (is_creator_user() and creator_id = auth_creator_id());

create policy comp_self_read on creator_complaints
  for select using (is_creator_user() and creator_id = auth_creator_id());
create policy comp_self_insert on creator_complaints
  for insert with check (is_creator_user() and creator_id = auth_creator_id());

-- Replies: append-only. Creator reads replies to own complaints; update/delete denied for all.
create policy reply_self_read on complaint_replies
  for select using (
    is_creator_user()
    and exists (select 1 from creator_complaints cc
                where cc.id = complaint_replies.complaint_id
                  and cc.creator_id = auth_creator_id())
  );
create policy reply_no_update on complaint_replies as restrictive for update using (false);
create policy reply_no_delete on complaint_replies as restrictive for delete using (false);

create policy feedback_self_insert on creator_feedback
  for insert with check (is_creator_user() and creator_id = auth_creator_id());
create policy feedback_self_read on creator_feedback
  for select using (is_creator_user() and creator_id = auth_creator_id());

create policy pjr_self_read on project_join_requests
  for select using (is_creator_user() and creator_id = auth_creator_id());
create policy pjr_self_insert on project_join_requests
  for insert with check (is_creator_user() and creator_id = auth_creator_id());

-- ---------- Complaint immutability (CPM can close, cannot alter body/creator/severity/category) ----------
create or replace function guard_complaint_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.body <> old.body or new.creator_id <> old.creator_id
     or new.severity <> old.severity or new.category <> old.category then
    raise exception 'complaint body/creator/severity/category is immutable';
  end if;
  return new;
end $$;
drop trigger if exists trg_complaint_immutable on creator_complaints;
create trigger trg_complaint_immutable before update on creator_complaints
  for each row execute function guard_complaint_immutable();

-- ============================================================
-- 8. RLS — restrictive isolation of the creator_user principal on shared tables
--    (existing permissive using(true) selects stay for internal; these AND on top).
--    For internal roles is_creator_user()=false → every clause is TRUE → no change.
-- ============================================================

-- 8a. Self-only visibility for creators.
create policy creators_creator_selfonly on creators as restrictive for select
  using (not is_creator_user() or id = auth_creator_id());
create policy pmr_creator_selfonly on platform_metrics_raw as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());
create policy reports_creator_selfonly on creator_reports as restrictive for select
  using (not is_creator_user() or (creator_id = auth_creator_id() and status = 'final'));
create policy creq_creator_selfonly on creator_requests as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());
create policy pcm_creator_selfonly on project_creator_metrics as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());
create policy pp_creator_selfonly on project_participants as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());

-- 8b. Projects: creators see only open-for-signup or ones they participate in.
create policy sp_creator_scope on special_projects as restrictive for select
  using (
    not is_creator_user()
    or open_for_signup = true
    or exists (select 1 from project_participants pp
               where pp.project_id = special_projects.id and pp.creator_id = auth_creator_id())
  );

-- 8c. Hard deny for the creator_user principal on internal/margin/other-creator tables.
--     (komisi_mea lives in brand_deals + deal_products → creators reach plans only via the view.)
do $$
declare t text;
begin
  foreach t in array array[
    'team_members','brand_deals','deal_products','project_daily_metrics',
    'transactions_all','transactions_agency_link','campaign_requests',
    'creator_contracts','acquisitions','referrals','cooperating_shops'
  ] loop
    execute format(
      'create policy %I_deny_creator on %I as restrictive for select using (not is_creator_user());',
      t, t);
  end loop;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 9. app_config (M9)
-- ============================================================
insert into app_config (key, value) values
  ('m9.complaint_categories', '["cm_tidak_responsif","pembayaran_komisi","masalah_campaign","teknis_platform","lainnya"]'::jsonb),
  ('m9.severity_weights',     '{"rendah":1,"sedang":2,"tinggi":3}'::jsonb),
  ('m9.complaint_weight',     '1.0'::jsonb),
  ('m9.report_credit_window', '"weekly"'::jsonb)
on conflict (key) do nothing;
