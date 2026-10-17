-- ============================================================
-- 0095_shop_period_rollup_queue.sql
-- Opsi A (disetujui user 2026-10-17): ringkasan per shop (0094) diperbarui oleh SATU job
-- pg_cron permanen yang memproses antrean, bukan oleh aplikasi.
--
-- Alasan: dari aplikasi tiap rpc kena statement_timeout 8s, sehingga refresh harus dipotong
-- ratusan irisan dan bergantung pada versi aplikasi yang ter-deploy. Job cron berjalan sebagai
-- postgres tanpa batas waktu.
--
-- Alur:
--   1. Trigger statement-level di creator_shop_period_gmv & creator_shop_period_unattributed_tap
--      (insert & delete, termasuk cascade hapus kreator) menaruh (platform, period_start) yang
--      berubah ke shop_period_rollup_queue. requested_at = waktu tulis terakhir.
--   2. Job `shop_period_rollup_queue` (tiap menit) memanggil process_shop_period_rollup_queue():
--      - ambil minggu yang sudah "tenang" ≥2 menit (upload selesai menulis);
--      - semua minggu antrean di bulan yang sama diproses sekaligus: grain minggu per minggu,
--        grain bulan sekali, lalu generasi diterbitkan (finish_shop_period_rollup);
--      - processed_at diisi requested_at yang terbaca; bila minggu itu ditulis ulang selama
--        proses, requested_at > processed_at sehingga otomatis diproses lagi.
--        Baris antrean tidak pernah dihapus (satu baris per platform × minggu).
--   Advisory lock mencegah dua proses berjalan bersamaan.
-- Angka Summary BizDev / TAP Matchmaking / Report Brand muncul ±2–10 menit setelah upload.
--
-- Tanpa pernyataan hapus objek (K23).
-- ============================================================

create table if not exists shop_period_rollup_queue (
  platform text not null,
  period_start date not null,
  requested_at timestamptz not null default now(),
  primary key (platform, period_start)
);
-- Diisi saat minggu itu selesai diproses (= requested_at yang terbaca). Baris antrean tidak
-- pernah dihapus (K23): minggu tertunda = processed_at null atau < requested_at.
alter table shop_period_rollup_queue add column if not exists processed_at timestamptz;

alter table shop_period_rollup_queue enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup_queue' and policyname = 'sprq_select') then
    create policy sprq_select on shop_period_rollup_queue for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup_queue' and policyname = 'sprq_creator_deny') then
    create policy sprq_creator_deny on shop_period_rollup_queue as restrictive for select
      using (not (select is_creator_user()));
  end if;
end $$;

comment on table shop_period_rollup_queue is
  'Antrean minggu yang ringkasan per shop-nya (shop_period_rollup/creator_shop_rollup) perlu dihitung ulang. Diisi trigger, dikosongkan job pg_cron shop_period_rollup_queue.';

-- ============ irisan: generasi tidak pernah mundur ============
-- Selama aplikasi lama (yang masih me-refresh sendiri dari ingest) berjalan bersamaan dengan job
-- cron, dua generasi bisa menulis irisan yang sama. Cap baris = generasi TERBARU yang pernah
-- menulisnya (greatest), sehingga tulisan generasi lebih tua yang datang belakangan tidak
-- menyembunyikan baris dari view publik. Angkanya tetap hasil hitung terakhir dari data dasar.
create or replace function refresh_shop_period_rollup_slice(
  p_platform text, p_period_start date, p_grain text, p_slice int, p_generation timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key date;
begin
  if p_grain = 'week' then
    v_key := p_period_start;
  elsif p_grain = 'month' then
    v_key := date_trunc('month', p_period_start::timestamp)::date;
  else
    raise exception 'grain tidak dikenal: %', p_grain;
  end if;
  if p_slice < 0 or p_slice > 127 then
    raise exception 'irisan di luar 0..127: %', p_slice;
  end if;

  insert into shop_period_rollup
    select l.*, p_generation from shop_period_summary_live l
     where l.platform = p_platform and l.period_kind = p_grain and l.period_key = v_key
       and (hashtext(l.shop_id) & 31) = (p_slice & 31)  -- cocok dengan index irisan *_slice_*
       and (hashtext(l.shop_id) & 127) = p_slice
  on conflict (platform, shop_id, period_kind, period_key) do update set
    shop_name = excluded.shop_name, period_end = excluded.period_end,
    creator_count = excluded.creator_count, creator_tap_count = excluded.creator_tap_count,
    gmv_mcn = excluded.gmv_mcn, gmv_mcn_live = excluded.gmv_mcn_live,
    gmv_mcn_video = excluded.gmv_mcn_video, orders_mcn = excluded.orders_mcn,
    items_sold_mcn = excluded.items_sold_mcn, gmv_tap = excluded.gmv_tap,
    gmv_tap_live = excluded.gmv_tap_live, gmv_tap_video = excluded.gmv_tap_video,
    orders_tap = excluded.orders_tap,
    est_partner_commission = excluded.est_partner_commission,
    actual_partner_commission = excluded.actual_partner_commission,
    est_creator_commission = excluded.est_creator_commission,
    actual_creator_commission = excluded.actual_creator_commission,
    refreshed_at = greatest(shop_period_rollup.refreshed_at, excluded.refreshed_at);
  insert into creator_shop_rollup
    select l.*, p_generation from creator_shop_perf_live l
     where l.platform = p_platform and l.period_kind = p_grain and l.period_key = v_key
       and (hashtext(l.shop_id) & 31) = (p_slice & 31)  -- cocok dengan index irisan *_slice_*
       and (hashtext(l.shop_id) & 127) = p_slice
  on conflict (platform, creator_id, shop_id, period_kind, period_key) do update set
    shop_name = excluded.shop_name, gmv_mcn = excluded.gmv_mcn,
    gmv_mcn_live = excluded.gmv_mcn_live, gmv_mcn_video = excluded.gmv_mcn_video,
    orders_mcn = excluded.orders_mcn, gmv_tap = excluded.gmv_tap,
    gmv_tap_live = excluded.gmv_tap_live, gmv_tap_video = excluded.gmv_tap_video,
    orders_tap = excluded.orders_tap,
    actual_partner_commission = excluded.actual_partner_commission,
    refreshed_at = greatest(creator_shop_rollup.refreshed_at, excluded.refreshed_at);
end $$;

-- ============ trigger: catat minggu yang berubah ============
create or replace function enqueue_shop_period_rollup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into shop_period_rollup_queue (platform, period_start, requested_at)
  select distinct c.platform, c.period_start, now() from changed c
  on conflict (platform, period_start) do update set requested_at = excluded.requested_at;
  return null;
end $$;

revoke all on function enqueue_shop_period_rollup() from public, anon, authenticated;

create or replace trigger cspg_rollup_enqueue_ins
  after insert on creator_shop_period_gmv
  referencing new table as changed
  for each statement execute function enqueue_shop_period_rollup();
create or replace trigger cspg_rollup_enqueue_del
  after delete on creator_shop_period_gmv
  referencing old table as changed
  for each statement execute function enqueue_shop_period_rollup();
create or replace trigger cspu_rollup_enqueue_ins
  after insert on creator_shop_period_unattributed_tap
  referencing new table as changed
  for each statement execute function enqueue_shop_period_rollup();
create or replace trigger cspu_rollup_enqueue_del
  after delete on creator_shop_period_unattributed_tap
  referencing old table as changed
  for each statement execute function enqueue_shop_period_rollup();

-- ============ pemroses antrean (dipanggil job cron) ============
create or replace function process_shop_period_rollup_queue(p_quiet interval default interval '2 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_platform text;
  v_first date;
  v_month date;
  v_gen timestamptz := clock_timestamp();
  v_weeks date[];
  v_seen timestamptz[];
  v_week date;
  v_slice int;
  i int;
begin
  if not pg_try_advisory_xact_lock(hashtext('shop_period_rollup_queue')) then
    return 0;
  end if;

  select q.platform, q.period_start into v_platform, v_first
    from shop_period_rollup_queue q
   where q.requested_at < now() - p_quiet
     and (q.processed_at is null or q.processed_at < q.requested_at)
   order by q.requested_at
   limit 1;
  if v_platform is null then
    return 0;
  end if;
  v_month := date_trunc('month', v_first::timestamp)::date;

  select array_agg(q.period_start order by q.period_start), array_agg(q.requested_at order by q.period_start)
    into v_weeks, v_seen
    from shop_period_rollup_queue q
   where q.platform = v_platform
     and date_trunc('month', q.period_start::timestamp)::date = v_month
     and q.requested_at < now() - p_quiet
     and (q.processed_at is null or q.processed_at < q.requested_at);

  foreach v_week in array v_weeks loop
    for v_slice in 0..127 loop
      perform refresh_shop_period_rollup_slice(v_platform, v_week, 'week', v_slice, v_gen);
    end loop;
  end loop;
  for v_slice in 0..127 loop
    perform refresh_shop_period_rollup_slice(v_platform, v_month, 'month', v_slice, v_gen);
  end loop;

  for i in 1..array_length(v_weeks, 1) loop
    perform finish_shop_period_rollup(v_platform, v_weeks[i], v_gen);
    update shop_period_rollup_queue set processed_at = v_seen[i]
     where platform = v_platform and period_start = v_weeks[i];
  end loop;
  return array_length(v_weeks, 1);
end $$;

revoke all on function process_shop_period_rollup_queue(interval) from public, anon, authenticated;
grant execute on function process_shop_period_rollup_queue(interval) to service_role;

-- ============ job cron (tiap menit, tanpa statement_timeout) ============
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron extension not available here — schedule process_shop_period_rollup_queue() manually.';
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'shop_period_rollup_queue') then
      perform cron.schedule(
        'shop_period_rollup_queue', '* * * * *',
        'set statement_timeout = 0; select process_shop_period_rollup_queue();'
      );
    end if;
  else
    raise notice 'pg_cron schema not found — schedule process_shop_period_rollup_queue() every minute via Supabase Dashboard > Database > Cron Jobs.';
  end if;
end $$;
