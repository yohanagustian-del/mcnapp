-- ============================================================
-- 0094_shop_period_rollup.sql
-- Lanjutan 0092/0093 (2026-10-16): /workspace/bizdev masih timeout untuk periode BULAN.
-- 0093 membuat index kunci bulan terpakai di bawah RLS, tapi bulan September = ±700 ribu
-- baris creator_shop_period_gmv: view menghitung ULANG seluruh agregat (count distinct per
-- shop, ±25 detik untuk creator_shop_perf) di SETIAP halaman 1000 baris → statement timeout
-- 8s. Index tidak menolong ketika semua baris memang dibutuhkan.
--
-- Perbaikan: agregat grain minggu & bulan DISIMPAN di tabel ringkasan (shop_period_rollup,
-- creator_shop_rollup), ditulis ulang SEKALI per upload oleh penulis satu-satunya
-- (lib/ingest/shop-period-write.ts → lib/ingest/shop-period-rollup.ts). Logika agregasi tetap
-- SATU tempat: view *_live (= definisi 0093, hanya dibaca fungsi refresh).
-- shop_period_summary & creator_shop_perf tetap ada dengan kolom yang SAMA (create or replace
-- view), kini membaca tabel ringkasan → bizdev_brand_perf, TAP Matchmaking, Report Brand v2
-- tidak berubah (CLAUDE.md #4).
--
-- Refresh dipotong 32 IRISAN shop (hashtext(shop_id) & 31, di-index): satu irisan bulan
-- penuh ±22 ribu baris sumber → tiap panggilan rpc jauh di bawah statement_timeout 8s
-- (service_role lewat PostgREST mewarisi 8s authenticator; SET di fungsi tidak memperpanjang
-- statement yang sedang jalan). Tanpa job terjadwal: aplikasi memanggil 2 grain × 32 irisan
-- lalu finish_shop_period_rollup.
--
-- Generasi: tiap refresh memberi cap `refreshed_at` (= p_generation) pada baris yang ditulis
-- (UPSERT), finish mencatatnya di shop_period_rollup_runs. View publik membaca baris dengan
-- refreshed_at >= generasi tercatat: baris shop yang hilang dari upload ulang otomatis tidak
-- terbaca setelah finish, tanpa pernyataan hapus (apply_migration MCP menggantung pada
-- DELETE/DROP, K23); selama refresh berjalan tidak ada baris yang hilang dari pembaca.
-- RLS: select authenticated + restrictive deny is_creator_user() (CLAUDE.md #9). Tulis hanya
-- lewat fungsi refresh (security definer, execute hanya service_role).
--
-- ingest_jobs: status upload mingguan TikTok yang diproses di latar belakang. Upload besar
-- (MCN + Academy + TAP ±1 juta baris) diproses ±7 menit; koneksi browser putus sebelum
-- server selesai → "Failed to fetch" padahal batch sukses. Kini server action langsung
-- mengembalikan id job, proses berjalan via after(), browser mem-poll status job ini.
--
-- File ini tanpa pernyataan hapus objek apa pun (K23).
-- ============================================================

-- ============ shop_period_summary_live (logika agregasi — satu-satunya) ============
create or replace view shop_period_summary_live
with (security_invoker = on) as
with grained as (
  select 'week'::text as period_kind, g.period_start as period_key,
         g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select 'week'::text, u.period_start,
         u.platform, null::text, u.shop_id, u.shop_name, u.period_end,
         0::numeric, 0::numeric, 0::numeric, 0, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap,
         u.est_partner_commission, u.actual_partner_commission,
         u.est_creator_commission, u.actual_creator_commission
    from creator_shop_period_unattributed_tap u
  union all
  select 'month'::text, g.period_month,
         g.platform, g.creator_id, g.shop_id, g.shop_name, g.period_end,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn, g.items_sold_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap,
         g.est_partner_commission, g.actual_partner_commission,
         g.est_creator_commission, g.actual_creator_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, u.period_month,
         u.platform, null::text, u.shop_id, u.shop_name, u.period_end,
         0::numeric, 0::numeric, 0::numeric, 0, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap,
         u.est_partner_commission, u.actual_partner_commission,
         u.est_creator_commission, u.actual_creator_commission
    from creator_shop_period_unattributed_tap u
)
select
  x.platform,
  x.shop_id,
  max(nullif(btrim(x.shop_name), '')) as shop_name,
  x.period_kind,
  x.period_key,
  max(x.period_end) as period_end,
  -- count(distinct) mengabaikan NULL: baris "Nama kreator tidak ada" tidak dihitung kreator.
  count(distinct x.creator_id) as creator_count,
  count(distinct x.creator_id) filter (where coalesce(x.gmv_tap, 0) > 0) as creator_tap_count,
  sum(x.gmv_mcn) as gmv_mcn,
  sum(x.gmv_mcn_live) as gmv_mcn_live,
  sum(x.gmv_mcn_video) as gmv_mcn_video,
  sum(x.orders_mcn) as orders_mcn,
  sum(x.items_sold_mcn) as items_sold_mcn,
  sum(x.gmv_tap) as gmv_tap,
  sum(x.gmv_tap_live) as gmv_tap_live,
  sum(x.gmv_tap_video) as gmv_tap_video,
  sum(x.orders_tap) as orders_tap,
  sum(x.est_partner_commission) as est_partner_commission,
  sum(x.actual_partner_commission) as actual_partner_commission,
  sum(x.est_creator_commission) as est_creator_commission,
  sum(x.actual_creator_commission) as actual_creator_commission
from grained x
group by x.platform, x.shop_id, x.period_kind, x.period_key;

-- ============ creator_shop_perf_live ============
create or replace view creator_shop_perf_live
with (security_invoker = on) as
with grained as (
  select 'week'::text as period_kind, g.period_start as period_key,
         g.platform, g.creator_id, g.shop_id, g.shop_name,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select 'week'::text, u.period_start,
         u.platform, null::text, u.shop_id, u.shop_name,
         0::numeric, 0::numeric, 0::numeric, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap, u.actual_partner_commission
    from creator_shop_period_unattributed_tap u
  union all
  select 'month'::text, g.period_month,
         g.platform, g.creator_id, g.shop_id, g.shop_name,
         g.gmv_mcn, g.gmv_mcn_live, g.gmv_mcn_video, g.orders_mcn,
         g.gmv_tap, g.gmv_tap_live, g.gmv_tap_video, g.orders_tap, g.actual_partner_commission
    from creator_shop_period_gmv g
  union all
  select 'month'::text, u.period_month,
         u.platform, null::text, u.shop_id, u.shop_name,
         0::numeric, 0::numeric, 0::numeric, 0,
         u.gmv_tap, u.gmv_tap_live, u.gmv_tap_video, u.orders_tap, u.actual_partner_commission
    from creator_shop_period_unattributed_tap u
)
select
  x.platform,
  x.creator_id,
  x.shop_id,
  max(nullif(btrim(x.shop_name), '')) as shop_name,
  x.period_kind,
  x.period_key,
  sum(x.gmv_mcn) as gmv_mcn,
  sum(x.gmv_mcn_live) as gmv_mcn_live,
  sum(x.gmv_mcn_video) as gmv_mcn_video,
  sum(x.orders_mcn) as orders_mcn,
  sum(x.gmv_tap) as gmv_tap,
  sum(x.gmv_tap_live) as gmv_tap_live,
  sum(x.gmv_tap_video) as gmv_tap_video,
  sum(x.orders_tap) as orders_tap,
  sum(x.actual_partner_commission) as actual_partner_commission
from grained x
group by x.platform, x.creator_id, x.shop_id, x.period_kind, x.period_key;

revoke all on shop_period_summary_live from anon, authenticated;
revoke all on creator_shop_perf_live from anon, authenticated;

-- ============ tabel ringkasan ============
create table if not exists shop_period_rollup as
  select * from shop_period_summary with no data;
create table if not exists creator_shop_rollup as
  select * from creator_shop_perf with no data;
alter table shop_period_rollup add column if not exists refreshed_at timestamptz not null default now();
alter table creator_shop_rollup add column if not exists refreshed_at timestamptz not null default now();

create table if not exists shop_period_rollup_runs (
  platform text not null,
  period_kind text not null,
  period_key date not null,
  refreshed_at timestamptz not null,
  primary key (platform, period_kind, period_key)
);

-- Kunci unik = kunci group by view _live (shop_id/creator_id bisa NULL → nulls not distinct).
create unique index if not exists shop_period_rollup_key
  on shop_period_rollup (platform, shop_id, period_kind, period_key) nulls not distinct;
create unique index if not exists creator_shop_rollup_key
  on creator_shop_rollup (platform, creator_id, shop_id, period_kind, period_key) nulls not distinct;
create index if not exists shop_period_rollup_period_idx
  on shop_period_rollup (period_kind, period_key, platform, refreshed_at);
create index if not exists creator_shop_rollup_period_idx
  on creator_shop_rollup (period_kind, period_key, platform, refreshed_at);

alter table shop_period_rollup enable row level security;
alter table creator_shop_rollup enable row level security;
alter table shop_period_rollup_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup' and policyname = 'spr_select') then
    create policy spr_select on shop_period_rollup for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup' and policyname = 'spr_creator_deny') then
    create policy spr_creator_deny on shop_period_rollup as restrictive for select
      using (not (select is_creator_user()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_rollup' and policyname = 'csr_select') then
    create policy csr_select on creator_shop_rollup for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_rollup' and policyname = 'csr_creator_deny') then
    create policy csr_creator_deny on creator_shop_rollup as restrictive for select
      using (not (select is_creator_user()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup_runs' and policyname = 'sprr_select') then
    create policy sprr_select on shop_period_rollup_runs for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'shop_period_rollup_runs' and policyname = 'sprr_creator_deny') then
    create policy sprr_creator_deny on shop_period_rollup_runs as restrictive for select
      using (not (select is_creator_user()));
  end if;
end $$;

comment on table shop_period_rollup is
  'Ringkasan per shop × periode (grain week & month) dari shop_period_summary_live. Ditulis HANYA oleh refresh_shop_period_rollup_slice (dipanggil ingest). Dibaca lewat view shop_period_summary.';
comment on table creator_shop_rollup is
  'Ringkasan per kreator × shop × periode (grain week & month) dari creator_shop_perf_live. Ditulis HANYA oleh refresh_shop_period_rollup_slice (dipanggil ingest). Dibaca lewat view creator_shop_perf.';
comment on table shop_period_rollup_runs is
  'Generasi refresh terbaru per (platform, grain, periode) untuk shop_period_rollup & creator_shop_rollup.';

-- ============ index irisan (dipakai fungsi refresh) ============
create index if not exists cspg_week_slice_idx
  on creator_shop_period_gmv (platform, period_start, (hashtext(shop_id) & 31));
create index if not exists cspg_month_slice_idx
  on creator_shop_period_gmv (platform, period_month, (hashtext(shop_id) & 31));
-- Grain bulan membaca ±1 juta baris: index covering (INCLUDE kolom yang dijumlahkan) membuat
-- index-only scan (butuh visibility map segar → vacuum analyze setelah upload besar), irisan
-- dingin turun dari ±15s (heap acak) ke ±3s. cspg_month_slice_idx jadi redundan; dibiarkan
-- (K23: tanpa DROP di migrasi), boleh di-drop manual.
create index if not exists cspg_month_slice_cover_idx
  on creator_shop_period_gmv (platform, period_month, (hashtext(shop_id) & 31))
  include (shop_id, creator_id, shop_name, period_end, gmv_mcn, gmv_mcn_live, gmv_mcn_video,
           orders_mcn, items_sold_mcn, gmv_tap, gmv_tap_live, gmv_tap_video, orders_tap,
           est_partner_commission, actual_partner_commission, est_creator_commission,
           actual_creator_commission);

-- ============ refresh: satu (platform, grain, periode, irisan) per panggilan ============
-- p_period_start = awal minggu yang diupload; grain 'month' memakai bulan yang memuatnya.
-- Catatan: penghapusan kreator (FK cascade ke creator_shop_period_gmv) baru tercermin di
-- ringkasan saat minggu itu diupload ulang.
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
  if p_slice < 0 or p_slice > 31 then
    raise exception 'irisan di luar 0..31: %', p_slice;
  end if;

  insert into shop_period_rollup
    select l.*, p_generation from shop_period_summary_live l
     where l.platform = p_platform and l.period_kind = p_grain and l.period_key = v_key
       and (hashtext(l.shop_id) & 31) = p_slice
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
    refreshed_at = excluded.refreshed_at;
  insert into creator_shop_rollup
    select l.*, p_generation from creator_shop_perf_live l
     where l.platform = p_platform and l.period_kind = p_grain and l.period_key = v_key
       and (hashtext(l.shop_id) & 31) = p_slice
  on conflict (platform, creator_id, shop_id, period_kind, period_key) do update set
    shop_name = excluded.shop_name, gmv_mcn = excluded.gmv_mcn,
    gmv_mcn_live = excluded.gmv_mcn_live, gmv_mcn_video = excluded.gmv_mcn_video,
    orders_mcn = excluded.orders_mcn, gmv_tap = excluded.gmv_tap,
    gmv_tap_live = excluded.gmv_tap_live, gmv_tap_video = excluded.gmv_tap_video,
    orders_tap = excluded.orders_tap,
    actual_partner_commission = excluded.actual_partner_commission,
    refreshed_at = excluded.refreshed_at;
end $$;

-- Setelah SEMUA irisan kedua grain selesai: generasi ini jadi acuan pembaca.
create or replace function finish_shop_period_rollup(
  p_platform text, p_period_start date, p_generation timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into shop_period_rollup_runs (platform, period_kind, period_key, refreshed_at)
  values (p_platform, 'week', p_period_start, p_generation),
         (p_platform, 'month', date_trunc('month', p_period_start::timestamp)::date, p_generation)
  on conflict (platform, period_kind, period_key)
    do update set refreshed_at = greatest(shop_period_rollup_runs.refreshed_at, excluded.refreshed_at);
$$;

-- Semua irisan dalam satu panggilan — untuk isi awal/perbaikan manual dari SQL editor (tanpa
-- statement_timeout). Aplikasi TIDAK memakainya (kena 8s): pakai lib/ingest/shop-period-rollup.ts.
create or replace function refresh_shop_period_rollup(p_platform text, p_period_start date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gen timestamptz := clock_timestamp();
  v_grain text;
  v_slice int;
begin
  foreach v_grain in array array['week', 'month'] loop
    for v_slice in 0..31 loop
      perform refresh_shop_period_rollup_slice(p_platform, p_period_start, v_grain, v_slice, v_gen);
    end loop;
  end loop;
  perform finish_shop_period_rollup(p_platform, p_period_start, v_gen);
end $$;

revoke all on function refresh_shop_period_rollup_slice(text, date, text, int, timestamptz) from public, anon, authenticated;
revoke all on function finish_shop_period_rollup(text, date, timestamptz) from public, anon, authenticated;
revoke all on function refresh_shop_period_rollup(text, date) from public, anon, authenticated;
grant execute on function refresh_shop_period_rollup_slice(text, date, text, int, timestamptz) to service_role;
grant execute on function finish_shop_period_rollup(text, date, timestamptz) to service_role;
grant execute on function refresh_shop_period_rollup(text, date) to service_role;

-- ============ isi awal ============
-- Dijalankan per minggu dari SQL editor (bulan penuh > batas waktu apply_migration):
--   select refresh_shop_period_rollup(platform, period_start)
--     from (select distinct platform, period_start from creator_shop_period_gmv
--           union select distinct platform, period_start from creator_shop_period_unattributed_tap) w;
-- View publik di bawah baru dialihkan SETELAH isi awal selesai.

-- ============ view publik: kolom sama, kini membaca ringkasan ============
create or replace view shop_period_summary
with (security_invoker = on) as
select
  r.platform, r.shop_id, r.shop_name, r.period_kind, r.period_key, r.period_end,
  r.creator_count, r.creator_tap_count, r.gmv_mcn, r.gmv_mcn_live, r.gmv_mcn_video,
  r.orders_mcn, r.items_sold_mcn, r.gmv_tap, r.gmv_tap_live, r.gmv_tap_video, r.orders_tap,
  r.est_partner_commission, r.actual_partner_commission, r.est_creator_commission,
  r.actual_creator_commission
from shop_period_rollup r
join shop_period_rollup_runs g
  on g.platform = r.platform and g.period_kind = r.period_kind
 and g.period_key = r.period_key and r.refreshed_at >= g.refreshed_at;

create or replace view creator_shop_perf
with (security_invoker = on) as
select
  r.platform, r.creator_id, r.shop_id, r.shop_name, r.period_kind, r.period_key, r.gmv_mcn,
  r.gmv_mcn_live, r.gmv_mcn_video, r.orders_mcn, r.gmv_tap, r.gmv_tap_live,
  r.gmv_tap_video, r.orders_tap, r.actual_partner_commission
from creator_shop_rollup r
join shop_period_rollup_runs g
  on g.platform = r.platform and g.period_kind = r.period_kind
 and g.period_key = r.period_key and r.refreshed_at >= g.refreshed_at;

-- ============ ingest_jobs ============
create table if not exists ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'tiktok',
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  result jsonb,
  error text,
  created_by uuid not null references team_members(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ingest_jobs_created_by_idx on ingest_jobs (created_by, created_at desc);

alter table ingest_jobs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ingest_jobs' and policyname = 'ij_select_own') then
    create policy ij_select_own on ingest_jobs for select to authenticated
      using (created_by = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ingest_jobs' and policyname = 'ij_creator_deny') then
    create policy ij_creator_deny on ingest_jobs as restrictive for select
      using (not (select is_creator_user()));
  end if;
end $$;

comment on table ingest_jobs is
  'Status upload mingguan TikTok yang diproses di latar belakang (after()). Ditulis server action (service role); browser mem-poll sampai done/failed. result = RunIngestResult.';
