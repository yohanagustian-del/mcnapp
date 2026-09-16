-- ============================================================
-- 0057_m7_v2_reports.sql
-- M7 v2 Special Project — Fase 1C / PR-13: report peserta schema (PRD §6.8, K5).
-- Depends on 0052 (report_period_t += 'project').
--
-- Correction vs PRD §6.8: the RLS policy it asks for
-- ("cr_creator_self_final": is_creator_user() + creator_id=auth_creator_id() +
-- status='final') ALREADY EXISTS — `reports_creator_selfonly` (migration 0011)
-- is `using (not is_creator_user() or (creator_id = auth_creator_id() and
-- status = 'final'))`, which applies to every period_type including the new
-- 'project' one with no changes needed. Not re-added here (same posture as
-- BUILD_PLAN_M7_V2 §1's other "PRD says X, repo already has it" corrections).
--
-- Also deliberately NOT seeding a token_baseline row for report_type='project'
-- (the PRD literally asks for one): the ratchet in reports/actions.ts branches
-- on `!baseline` to seed the very first baseline; a pre-seeded row with
-- best_token = null would make `tokenUsed > null` coerce to `tokenUsed > 0`
-- and fire a false "token regression" alert on the very first project report.
-- Weekly/monthly never pre-seed one either (grep confirms) — leaving it out
-- keeps this consistent with the existing report types and avoids that bug.
-- ============================================================

alter table creator_reports add column project_id bigint references special_projects(id);

-- R26: at most one FINAL report per (project, creator); regenerating replaces
-- the standing draft rather than piling up duplicates ("draft lama diarsip").
create unique index creator_reports_project_final_key
  on creator_reports (project_id, creator_id) where project_id is not null and status = 'final';
create unique index creator_reports_project_draft_key
  on creator_reports (project_id, creator_id) where project_id is not null and status = 'draft';

-- ---------- Per-creator report aggregate (rank + cohort computed in SQL — CLAUDE.md #4) ----------
-- Based on project_participants (LEFT JOIN metrics), not just creators who
-- happen to have a metrics row — R29: a participant with gmv_actual=0 still
-- gets a report, and still counts toward `of`/cohort for everyone else.
create view project_creator_report_v with (security_invoker = on) as
with per_creator as (
  select
    pp.project_id,
    pp.creator_id,
    coalesce(sum(pcm.gmv_actual), 0) as gmv,
    coalesce(sum(coalesce(pcm.live_gmv, pcm.gmv_live_report, 0)), 0) as live_gmv,
    coalesce(sum(coalesce(pcm.video_gmv, 0)), 0) as video_gmv,
    coalesce(sum(coalesce(pcm.orders, 0)), 0) as orders,
    coalesce(sum(coalesce(pcm.items_sold, 0)), 0) as items,
    coalesce(count(*) filter (where pcm.gmv_actual > 0), 0) as active_days
  from project_participants pp
  left join project_creator_metrics pcm
    on pcm.project_id = pp.project_id and pcm.creator_id = pp.creator_id
  group by pp.project_id, pp.creator_id
),
with_share as (
  select *, case when gmv > 0 then live_gmv / gmv else 0 end as live_share
  from per_creator
)
select
  project_id, creator_id, gmv, live_gmv, video_gmv, orders, items, active_days, live_share,
  rank() over (partition by project_id order by gmv desc) as rank,
  count(*) over (partition by project_id) as of,
  sum(gmv) over (partition by project_id) as project_total_gmv,
  (sum(gmv) over (partition by project_id) - gmv)
    / nullif(count(*) over (partition by project_id) - 1, 0) as cohort_avg_gmv,
  (sum(live_share) over (partition by project_id) - live_share)
    / nullif(count(*) over (partition by project_id) - 1, 0) as cohort_avg_live_share,
  (sum(active_days) over (partition by project_id) - active_days)
    / nullif(count(*) over (partition by project_id) - 1, 0) as cohort_avg_active_days
from with_share;
