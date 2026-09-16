-- ============================================================
-- 0055_m7_v2_cron_config.sql
-- M7 v2 Special Project — Fase 0 / PR-04: seed app_config thresholds used by
-- later fases (CLAUDE.md: no hardcoded numbers) + schedule the daily recompute
-- for `aktif` projects at 06:00 WIB (BUILD_PLAN_M7_V2 §0.3).
--
-- No new schema here on purpose — everything below is config + a scheduled job.
-- ============================================================

insert into app_config(key, value) values
  ('m7.gmv_trend_tolerance', '0.02'),   -- V6 (Fase 1A): selisih GMV Product vs Trend Stats yang masih boleh
  ('m7.feedback_window_days', '14'),    -- R31 (Fase 3): jendela isi feedback setelah project selesai
  ('m7.shortlist_weights', '{"gmv":0.4,"niche":0.25,"level":0.2,"live":0.15}'),  -- §6.4 (Fase 2)
  ('m7.sentiment_rules', '{
     "positif": ["bagus","mantap","membantu","senang","puas","memuaskan","recommended","top","hebat","seru"],
     "negatif": ["kecewa","buruk","jelek","lambat","gagal","susah","ribet","berantakan","males","payah"]
   }')  -- B4 (Fase 3): leksikon pendukung sentimen rule-based, bisa ditambah tanpa deploy
on conflict (key) do nothing;

-- ---------- Daily recompute for aktif projects (§0.3, cron 06:00 WIB = 23:00 UTC) ----------
create or replace function run_m7_v2_daily_recompute() returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select id from special_projects where status = 'aktif' loop
    perform recompute_project_daily(r.id);
    perform recompute_project_summary(r.id);
    insert into audit_logs (actor_id, actor_label, action, entity_type, entity_id, before, after, type)
    values (null, 'system:cron_m7_v2', 'm7.summary_recompute', 'special_projects', r.id::text, null, null, 'auto');
  end loop;
end $$;

-- pg_cron isn't guaranteed enabled in every environment this migration runs against
-- (fresh local db, a Supabase project without the extension turned on yet) — degrade
-- to a notice instead of failing the whole migration; ops can wire the schedule from
-- the Supabase Dashboard (Database > Cron Jobs) or `select cron.schedule(...)` by hand.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron extension not available here — schedule run_m7_v2_daily_recompute() manually.';
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'm7_v2_daily_recompute') then
      perform cron.unschedule('m7_v2_daily_recompute');
    end if;
    perform cron.schedule('m7_v2_daily_recompute', '0 23 * * *', 'select run_m7_v2_daily_recompute();');
  else
    raise notice 'pg_cron schema not found — schedule run_m7_v2_daily_recompute() manually via Supabase Dashboard > Database > Cron Jobs (daily, 23:00 UTC = 06:00 WIB).';
  end if;
end $$;
