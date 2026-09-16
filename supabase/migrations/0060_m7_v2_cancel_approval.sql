-- ============================================================
-- 0060_m7_v2_cancel_approval.sql
-- M7 v2 Special Project — cancelling a project ("dibatalkan") now requires
-- Director approval before it takes effect (CLAUDE.md #2: human action that
-- could harm the company → approval before it applies), instead of taking
-- effect immediately for anyone with m7.manage like every other status
-- transition. Mirrors the existing project_join_requests request/decide
-- shape (decided_by/decided_at columns), not a new enum value — a project
-- awaiting cancellation decision stays fully operative (uploads, reports,
-- etc. all keep working) under its current status until a Director decides.
-- ============================================================

alter table special_projects
  add column if not exists cancellation_requested_at timestamptz,
  add column if not exists cancellation_requested_by uuid references team_members(id),
  add column if not exists cancellation_reason text,
  add column if not exists cancellation_decided_at timestamptz,
  add column if not exists cancellation_decided_by uuid references team_members(id);
