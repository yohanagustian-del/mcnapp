-- ============================================================
-- 0052_m7_v2_enums.sql
-- M7 v2 Special Project — Fase 0 / PR-01: enum-only migration.
--
-- Postgres forbids using a new enum value in the same transaction that added it
-- via ALTER TYPE ... ADD VALUE, and Supabase migrations run inside one transaction
-- each — so this file adds ALL new M7 v2 enum types/values and NOTHING else
-- (BUILD_PLAN_M7_V2.md §Fase 0.1). 0053 depends on these labels already existing.
-- ============================================================

-- R1: project type, replacing free-text special_projects.type (mapped in 0053).
create type project_type_t as enum (
  'bootcamp', 'training', 'event', 'showcase', 'campaign', 'trip', 'other'
);

-- §6.2: project_manpower.role, replacing free-text (mapped in 0053).
create type manpower_role_t as enum (
  'pic', 'project_manager', 'cm', 'cpm', 'akuisisi', 'bizdev', 'support', 'other'
);

-- R2: project status gains a terminal cancelled state.
alter type project_status_t add value if not exists 'dibatalkan';

-- K5 / §6.8: creator_reports reused for project reports (period_type='project').
alter type report_period_t add value if not exists 'project';
