-- 0099: Adopsi Sistem (/okr) — agregasi jam pemakaian & last activity di database.
--
-- Bug (feedback Tim OD 2026-10-26): tabel "Adopsi Sistem — Jam Pemakaian Tools" hanya
-- menampilkan ±2 minggu terakhir. Halaman menarik baris mentah tool_usage_logs lalu
-- mengagregasi di JS, tetapi PostgREST memotong tiap response di `max_rows` (1000),
-- di luar kendali `.limit(20000)`. Sejak PR #19 middleware juga mencatat navigasi RSC &
-- Server Action → prod 2026-10-28: 8.685 baris dalam 92 hari, baris ke-1000 terbaru =
-- 2026-10-22, jadi minggu sebelum itu hilang. audit_logs sama (54.629 baris/92 hari →
-- Last Activity hanya ±2 hari terakhir).
--
-- Fix: kedua fungsi mengembalikan SATU nilai jsonb (bukan set baris), sehingga tidak
-- terkena max_rows berapa pun volume log maupun jumlah member × minggu.
--
-- usage_hours_by_week = port SQL dari aggregateUsageByWeek (src/lib/m3/usage.ts), yang
-- tetap satu-satunya definisi: gap & durasi minimal dikirim dari konstanta JS
-- (SESSION_GAP_MIN / MIN_SESSION_MIN), pembulatan & urutan tetap di JS
-- (finalizeWeeklyUsage). Sesi = view berurutan dengan selisih ≤ gap; durasi = last−first,
-- minimal p_min_session_minutes; sesi masuk ke minggu (Senin, UTC) tempat ia DIMULAI.
-- Kesetaraan dijaga src/lib/m3/__tests__/usage-sql.test.ts.
--
-- Gate: Director/Head/SPV & *_lead (sama dengan isLead di /okr). security invoker → RLS
-- tabel dasar tetap berlaku (audit_logs: management semua, lead hanya aksinya sendiri —
-- persis perilaku halaman sebelumnya). Tidak ada tabel/log baru: tool_usage_logs &
-- audit_logs tetap satu-satunya sumber.

create or replace function public.can_view_usage_adoption() returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce(
    public.current_member_role() in ('director','head','spv')
    or public.current_member_role()::text like '%\_lead',
    false)
$$;

create or replace function public.usage_hours_by_week(
  p_from timestamptz,
  p_gap_minutes int default 30,
  p_min_session_minutes int default 5
) returns jsonb
language sql stable security invoker set search_path = public as $$
  with logs as (
    select l.id, l.member_id, l.occurred_at,
           lag(l.occurred_at) over w as prev_at
    from tool_usage_logs l
    where public.can_view_usage_adoption()
      and l.occurred_at >= p_from
    window w as (partition by l.member_id order by l.occurred_at, l.id)
  ),
  numbered as (
    select member_id, occurred_at,
           sum(case when prev_at is null
                      or occurred_at - prev_at > make_interval(mins => p_gap_minutes)
                    then 1 else 0 end)
             over (partition by member_id order by occurred_at, id rows unbounded preceding) as session_no
    from logs
  ),
  sessions as (
    select member_id,
           min(occurred_at) as started_at,
           max(occurred_at) as ended_at,
           count(*)         as views
    from numbered
    group by member_id, session_no
  ),
  weekly as (
    select member_id,
           date_trunc('week', started_at at time zone 'UTC')::date as week_start,
           sum(greatest(extract(epoch from ended_at - started_at), p_min_session_minutes * 60)) as seconds,
           count(*)   as sessions,
           sum(views) as page_views,
           max(max(ended_at)) over (partition by member_id) as last_access
    from sessions
    group by member_id, week_start
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'member_id',   member_id,
           'week_start',  week_start,
           'seconds',     seconds,
           'sessions',    sessions,
           'page_views',  page_views,
           'last_access', last_access)), '[]'::jsonb)
  from weekly
$$;

-- Last Activity: aksi audit_logs terbaru per actor dalam jendela (DISTINCT ON), bukan
-- 1000 aksi terbaru lintas semua actor.
create or replace function public.latest_audit_activity(p_from timestamptz) returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'actor_id', actor_id, 'action', action, 'created_at', created_at)), '[]'::jsonb)
  from (
    select distinct on (a.actor_id) a.actor_id, a.action, a.created_at
    from audit_logs a
    where public.can_view_usage_adoption()
      and a.created_at >= p_from
      and a.actor_id is not null
    order by a.actor_id, a.created_at desc
  ) latest
$$;

revoke all on function public.usage_hours_by_week(timestamptz, int, int) from public, anon;
revoke all on function public.latest_audit_activity(timestamptz) from public, anon;
revoke all on function public.can_view_usage_adoption() from public, anon;
grant execute on function public.usage_hours_by_week(timestamptz, int, int) to authenticated;
grant execute on function public.latest_audit_activity(timestamptz) to authenticated;
grant execute on function public.can_view_usage_adoption() to authenticated;
