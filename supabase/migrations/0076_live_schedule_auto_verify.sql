-- PLAN_MSDPS_mcnapp.md Paket B (R3, disetujui pemilik 2026-09-28): jadwal live yang
-- terlewat > m13.auto_verify_hours tanpa verifikasi manual dianggap live sesuai
-- jadwal (ASUMSI sistem, bukan fakta — CLAUDE.md #6/#7: jam aktual dibiarkan NULL,
-- ditandai actual_time_source='auto_sistem', bukan disamarkan sebagai jam manual).
-- Butuh migrasi 0073 (kolom actual_time_source) sudah ada.

insert into app_config(key, value) values
  ('m13.auto_verify_hours', '24'),
  -- Q5: CM tetap boleh mengoreksi slot auto_sistem (ke jam baru / tidak jadi live)
  -- dalam N hari setelah auto-verify — ditegakkan di server action, bukan di sini.
  ('m13.auto_verify_correction_days', '7')
on conflict (key) do nothing;

create or replace function run_m13_auto_verify() returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  auto_verify_hours numeric;
  r record;
begin
  select (value #>> '{}')::numeric into auto_verify_hours
  from app_config where key = 'm13.auto_verify_hours';
  if auto_verify_hours is null then auto_verify_hours := 24; end if;

  -- Batas dihitung dari JAM SELESAI rencana di WIB, bukan tanggal UTC server (bug
  -- yang sama dengan A-00) — slot tanpa end_time dianggap selesai jam 23:59 hari itu.
  for r in
    select id
    from live_schedule_slots
    where status in ('scheduled', 'tentative')
      and (schedule_date + coalesce(end_time, time '23:59')) at time zone 'Asia/Jakarta'
          + (auto_verify_hours || ' hours')::interval < now()
  loop
    update live_schedule_slots
    set status = 'done',
        actual_time_source = 'auto_sistem',
        actual_start = null,
        actual_end = null,
        verified_by = null,
        verified_at = now(),
        updated_at = now()
    where id = r.id;

    insert into audit_logs (actor_id, actor_label, action, entity_type, entity_id, before, after, type)
    values (
      null, 'system:auto_verify_m13', 'schedule.verify_slot', 'live_schedule_slots', r.id::text,
      jsonb_build_object('status', 'scheduled_or_tentative'),
      jsonb_build_object('status', 'done', 'actual_time_source', 'auto_sistem'),
      'auto'
    );
  end loop;
end $$;

comment on function run_m13_auto_verify() is
  'PLAN_MSDPS Paket B: auto-verifies live_schedule_slots left unverified > m13.auto_verify_hours after their planned end time (WIB). actual_start/end left NULL (asumsi, bukan fakta) — only status + actual_time_source are set. Scheduled hourly via pg_cron.';

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron extension not available here — schedule run_m13_auto_verify() manually.';
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'm13_auto_verify') then
      perform cron.unschedule('m13_auto_verify');
    end if;
    perform cron.schedule('m13_auto_verify', '0 * * * *', 'select run_m13_auto_verify();');
  else
    raise notice 'pg_cron schema not found — schedule run_m13_auto_verify() manually via Supabase Dashboard > Database > Cron Jobs (hourly).';
  end if;
end $$;
