-- PX-M1 Creator Capability Registry (Product Exchange, Module 1) — surat tugas
-- PRD-product-exchange-M1-M2.md v1.0 §3. This is the FIRST non-`public` schema in
-- this repo (`bridge`) — see layer 3 below for why that matters.
--
-- Kenapa modul ini ada: MEA Agency (klien seller, app.meagency.co.id) dan MCN MEA
-- (kreator, app.meamcn.com) tidak punya cara sistematis mempertemukan keduanya.
-- `creator_subcat_segment_gmv` (0016) sudah menjawab "kategori/segmen harga apa
-- yang PERNAH dijual kreator ini" (proven_*, recompute di bawah). Yang belum ada
-- adalah KAPASITAS — berapa banyak match aktif bersamaan yang sanggup ditangani
-- kreator itu SEKARANG (`slots_total`, satu-satunya input manusia di tabel ini).
--
-- Ketokan yang mengikat (surat tugas §2, jangan didesain ulang di sesi berikutnya):
--   K1 — satu slot = jumlah match AKTIF BERSAMAAN per (creator, level2, price_segment).
--        Bukan SKU/bulan, bukan jam konten.
--   K2 — PK pakai kunci alami (creator_id, level2_category, price_segment), TANPA
--        prefix ID baru (beda dengan CRT-/DEAL-/LNK- di CLAUDE.md — keputusan CEO).
--   K3 — schema `bridge` di sisi proyek Supabase MCN ini. Proyek MEA Agency (CDPS,
--        `egddxfcnrtecheiykhlf`) TETAP TERPISAH — tidak ada tabel yang menyeberang.
--   K4 — pengisi slots_total = CPM YANG PEGANG KREATORNYA (creators.owner_cpm_id),
--        bukan CM Lead saja seperti PRD §3.2 Rule 4 asli. Gerbang per-baris untuk
--        ini ada di server action (src/app/(portal)/px/capability/actions.ts),
--        BUKAN di RLS — CM Lead & Management tetap lintas-baris, jadi kolomnya
--        tidak bisa dijadikan syarat RLS tanpa memblokir mereka juga.
--   K5 — bridge.px_coverage_map() adalah SATU-SATUNYA permukaan yang boleh dibaca
--        dari luar proyek (transport lintas-proyek diputuskan nanti di M3). Tabel
--        mentahnya TIDAK PERNAH diekspor — jangan tergoda menambah kolom "siapa
--        tahu berguna" ke fungsi ini; setiap kolom tambahan adalah kolom yang nanti
--        harus diseberangkan & dijaga selamanya.
--
-- Dua keputusan yang sudah diambil (jangan diulang analisanya):
--   (a) px_match (M5) BELUM ADA. slots_committed + CHECK dibuat SEKARANG, tapi
--       TIDAK ADA trigger yang mengisinya — tidak ada sumbernya sampai M5 lahir.
--       slots_committed diam di 0 (jadi slots_available = slots_total) sampai
--       saat itu. Ini kejujuran, bukan utang teknis tersembunyi — jangan bikin
--       tabel px_match sementara, tabel salah bentuk mahal diubah setelah berisi data.
--   (b) creator_subcat_segment_gmv.price_segment NULLABLE (0016: "null when
--       items_sold=0"), tapi kolom itu ada di PRIMARY KEY registry ini dan PK
--       tidak boleh null. Baris ber-price_segment IS NULL DI-SKIP saat recompute
--       (src/lib/px/capability-recompute.ts) — benar secara bisnis: items_sold=0
--       berarti nol kapabilitas terbukti, tidak ada yang hilang.
--
-- Tiga lapis keamanan (kreator TIDAK BOLEH membaca tabel ini sama sekali):
--   1. RLS restrictive policy `not is_creator_user()` (pola pxcc_creator_deny,
--      identik pt_creator_deny di 0019_products_tap.sql:42-46).
--   2. REVOKE ALL dari anon/authenticated — LEBIH KETAT dari pola tabel lain di
--      repo ini (satu-satunya REVOKE sebelumnya, di 0003_security_hardening.sql,
--      untuk *function*, bukan tabel). Semua baca/tulis lewat createAdminClient().
--   3. Lapis paling kuat: `bridge` TIDAK didaftarkan sebagai exposed schema di
--      PostgREST (repo ini bahkan tidak punya supabase/config.toml). Kreator
--      secara struktural tidak bisa menyentuhnya lewat PostgREST sama sekali —
--      JANGAN pernah mendaftarkan schema `bridge` ke API.
--
-- Hanya kreator berstatus 'aktif' dihitung (PRD Rule 11) — creator_status_t sudah
-- persis prospek|binding|aktif|nonaktif, tidak perlu mapping baru.

create schema if not exists bridge;

create table bridge.px_creator_capability (
  creator_id       text        not null references public.creators(id),
  level2_category  text        not null,
  price_segment    public.price_segment_t not null,
  proven_gmv       numeric(15,2) not null default 0,
  proven_orders    integer     not null default 0,
  last_computed_at timestamptz not null default now(),
  -- Satu-satunya input manusia (K4 gate ditegakkan di server action, bukan di sini —
  -- lihat header). slots_committed TIDAK PERNAH ditulis aplikasi hari ini (belum ada
  -- px_match/M5); kolom + CHECK dibuat sekarang supaya bentuknya tidak berubah lagi
  -- nanti (lihat keputusan (a) di atas).
  slots_total      smallint    not null default 0 check (slots_total >= 0),
  slots_committed  smallint    not null default 0 check (slots_committed >= 0),
  slots_available  smallint generated always as (greatest(slots_total - slots_committed, 0)) stored,
  updated_by       uuid        null references public.team_members(id),
  updated_at       timestamptz not null default now(),
  primary key (creator_id, level2_category, price_segment),
  constraint ck_pxcc_no_overcommit check (slots_committed <= slots_total)
);
create index on bridge.px_creator_capability (level2_category, price_segment);

alter table bridge.px_creator_capability enable row level security;
create policy pxcc_creator_deny on bridge.px_creator_capability as restrictive for select
  using (not is_creator_user());

revoke all on bridge.px_creator_capability from anon, authenticated;

-- bridge.px_coverage_map() — K5: satu-satunya permukaan yang boleh dibaca dari luar
-- proyek (CDPS/MEA Agency), lewat transport yang diputuskan nanti di M3. Tabel
-- px_creator_capability sendiri TIDAK PERNAH diekspor.
--
-- status = 'covered' bila total_slots_available > 0, 'kosong' bila 0. Hanya
-- kombinasi (level2, segment) yang SUDAH ADA kreatornya bisa muncul di sini —
-- kategori yang MEA punya NOL kreator tidak akan muncul sebagai baris "kosong",
-- ia tidak akan muncul sama sekali (butuh tabel master kategori dari Hans,
-- di luar lingkup PX-M1 — lihat catatan di /px/capability tab Coverage).
create or replace function bridge.px_coverage_map(p_level2 text default null)
returns table (
  level2_category text,
  price_segment public.price_segment_t,
  creator_count bigint,
  total_slots_available bigint,
  total_proven_gmv numeric,
  status text
)
language sql stable security definer set search_path = bridge, public, pg_temp as $$
  select
    pcc.level2_category,
    pcc.price_segment,
    count(*) as creator_count,
    coalesce(sum(pcc.slots_available), 0) as total_slots_available,
    coalesce(sum(pcc.proven_gmv), 0) as total_proven_gmv,
    case when coalesce(sum(pcc.slots_available), 0) > 0 then 'covered' else 'kosong' end as status
  from bridge.px_creator_capability pcc
  join public.creators c on c.id = pcc.creator_id and c.status = 'aktif'
  where p_level2 is null or pcc.level2_category = p_level2
  group by pcc.level2_category, pcc.price_segment;
$$;

comment on function bridge.px_coverage_map(text) is
  'K5: satu-satunya permukaan bridge.px_creator_capability yang boleh dibaca dari luar proyek. Jangan menambah kolom "siapa tahu berguna" — setiap kolom tambahan harus diseberangkan & dijaga selamanya. Tabel mentahnya tidak pernah diekspor.';

-- ============================================================================
-- Wrapper RPC `public.px_capability_*` — kenapa ini ADA padahal tidak diminta
-- surat tugas kata per kata, dan kenapa bentuknya begini:
--
-- Layer 3 di atas ("jangan daftarkan `bridge` ke API") berarti PostgREST
-- literal-literal tidak tahu apa-apa soal schema `bridge` — dan itu berlaku untuk
-- SEMUA request lewat endpoint /rest/v1/, TERMASUK yang memakai service_role key
-- (createAdminClient()). `db-schemas`/exposed-schema PostgREST adalah satu daftar
-- global di level `authenticator` role, bukan per-JWT-role (dikonfirmasi lewat
-- Supabase docs: "PGRST106 ... schema must be one of the following" berlaku
-- apa pun role di JWT). Jadi createAdminClient() TIDAK BISA memanggil
-- `bridge.px_creator_capability` atau `bridge.px_coverage_map()` langsung lewat
-- `.from()`/`.rpc()` — bukan cuma kreator yang terblokir, aplikasi kita sendiri
-- juga terblokir kalau mengandalkan endpoint REST biasa.
--
-- Solusinya (dan ini pola yang SUDAH ada di Supabase docs — "you do not need to
-- expose SECURITY DEFINER functions ... as long as you explicitly use the schema
-- inside"): fungsi-fungsi di bawah hidup di schema `public` (yang SUDAH terdaftar
-- di API, sama seperti seluruh RPC lain di repo ini, mis. run_retention_purge),
-- bertanda SECURITY DEFINER, dan badannya menyentuh `bridge.px_creator_capability`
-- lewat SQL biasa (bukan lewat REST) — jadi PostgREST cuma perlu tahu soal fungsi
-- publiknya, tidak perlu tahu apa-apa soal `bridge`. Ini BUKAN mengekspor tabel
-- mentahnya (K5 tetap utuh: tak ada kolom baru, tak ada akses lintas-proyek lewat
-- jalur ini) — ini semata jalur AGAR APLIKASI SENDIRI (bukan proyek luar) bisa
-- membaca/menulis tabel yang skema-nya sengaja tidak diekspor.
--
-- WAJIB: setiap fungsi di bawah di-REVOKE dari PUBLIC (yang otomatis mencakup
-- `anon` DAN `authenticated`) dan HANYA di-GRANT ke `service_role`. Postgres
-- meng-GRANT EXECUTE ke PUBLIC secara default untuk fungsi baru — kalau lupa
-- revoke ini, SECURITY DEFINER + REVOKE ALL di tabel di atas jadi percuma:
-- `authenticated` mencakup BAIK sesi team_member MAUPUN sesi creator_user
-- (keduanya connect sebagai role Postgres yang sama, dibedakan lewat klaim JWT
-- 'role', bukan role Postgres terpisah — lihat is_creator_user()), jadi kreator
-- yang tahu nama fungsi ini bisa memanggilnya langsung lewat /rest/v1/rpc/... dan
-- membaca/menulis kapasitas SIAPA SAJA, memotong RBAC di server action sama
-- sekali. `service_role` dipakai eksklusif oleh createAdminClient() di server
-- action yang SUDAH lewat requirePermission() + gerbang CPM (Langkah 5) — jadi
-- baris ini adalah lapis pertahanan terakhir, bukan satu-satunya.
-- ============================================================================

-- px_capability_recompute: agregasi SQL (bukan fetchAll+reduce JS — syarat
-- non-functional 5.000 kreator < 60 detik) dari creator_subcat_segment_gmv,
-- DI-SCOPE ke p_creator_ids (kreator di batch ingest ini, bukan seluruh tabel).
-- Baris price_segment IS NULL di-skip (keputusan (b) di atas). Satu panggilan
-- fungsi = satu transaksi Postgres implisit: exception apa pun membatalkan
-- SELURUH efeknya (update zero-out MAUPUN upsert) sekaligus — nilai lama
-- (termasuk last_computed_at lama) bertahan persis seperti PRD Rule 12 minta,
-- tanpa perlu BEGIN/EXCEPTION eksplisit.
--
-- slots_total/slots_committed/updated_by/updated_at SENGAJA tidak pernah
-- disebut di sini — slots_total satu-satunya input manusia (PRD Rule 2), tidak
-- boleh punya sumber kebenaran kedua.
--
-- Rule 4 Flow A (di-scope PER BATCH kreator ini, bukan global — lihat header
-- Langkah 2 surat tugas): kombinasi (level2, segment) milik salah satu kreator
-- di p_creator_ids yang TIDAK lagi muncul di jendela batch ini → proven_*=0,
-- BUKAN dihapus (menghapus baris akan membuang slots_total, input manusia itu).
create or replace function public.px_capability_recompute(
  p_creator_ids text[],
  p_cutoff date
) returns integer
language plpgsql security definer set search_path = public, bridge, pg_temp as $$
declare
  affected integer := 0;
begin
  create temporary table px_recompute_agg on commit drop as
  select creator_id, level2_category, price_segment,
         sum(gmv) as gmv, sum(orders) as orders
  from creator_subcat_segment_gmv
  where creator_id = any(p_creator_ids)
    and window_end >= p_cutoff
    and price_segment is not null
  group by creator_id, level2_category, price_segment;

  update bridge.px_creator_capability pcc
  set proven_gmv = 0, proven_orders = 0, last_computed_at = now()
  where pcc.creator_id = any(p_creator_ids)
    and not exists (
      select 1 from px_recompute_agg a
      where a.creator_id = pcc.creator_id
        and a.level2_category = pcc.level2_category
        and a.price_segment = pcc.price_segment
    )
    and (pcc.proven_gmv <> 0 or pcc.proven_orders <> 0);

  insert into bridge.px_creator_capability
    (creator_id, level2_category, price_segment, proven_gmv, proven_orders, last_computed_at)
  select creator_id, level2_category, price_segment, gmv, orders, now()
  from px_recompute_agg
  on conflict (creator_id, level2_category, price_segment)
  do update set
    proven_gmv = excluded.proven_gmv,
    proven_orders = excluded.proven_orders,
    last_computed_at = excluded.last_computed_at;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.px_capability_recompute(text[], date) from public, anon, authenticated;
grant execute on function public.px_capability_recompute(text[], date) to service_role;

-- px_capability_list: baca baris registry (join nama/username kreator + status
-- untuk tampilan) untuk tab Registry & sebagai sumber "before" saat bulk-edit.
-- Otorisasi (siapa boleh MELIHAT baris siapa, mis. penyaringan CPM ke kreator
-- sendiri) ditegakkan di server Next.js (page.tsx), BUKAN di sini — fungsi ini
-- sengaja peran-agnostik ("list all" / "list by creator_ids"), sama seperti
-- products_tap/page.tsx menegakkan canSeeOwner di kode server, bukan di query.
create or replace function public.px_capability_list(
  p_creator_ids text[] default null,
  p_limit integer default 2000
) returns table (
  creator_id text,
  creator_name text,
  creator_username text,
  creator_status public.creator_status_t,
  owner_cpm_id uuid,
  level2_category text,
  price_segment public.price_segment_t,
  proven_gmv numeric,
  proven_orders integer,
  last_computed_at timestamptz,
  slots_total smallint,
  slots_committed smallint,
  slots_available smallint,
  updated_at timestamptz
)
language sql stable security definer set search_path = public, bridge, pg_temp as $$
  select
    pcc.creator_id, c.name, c.username, c.status, c.owner_cpm_id,
    pcc.level2_category, pcc.price_segment, pcc.proven_gmv, pcc.proven_orders,
    pcc.last_computed_at, pcc.slots_total, pcc.slots_committed, pcc.slots_available,
    pcc.updated_at
  from bridge.px_creator_capability pcc
  join public.creators c on c.id = pcc.creator_id
  where p_creator_ids is null or pcc.creator_id = any(p_creator_ids)
  order by pcc.level2_category, pcc.price_segment, pcc.proven_gmv desc
  limit p_limit;
$$;

revoke execute on function public.px_capability_list(text[], integer) from public, anon, authenticated;
grant execute on function public.px_capability_list(text[], integer) to service_role;

-- px_capability_bulk_set_slots: tulis slots_total massal (Tab Registry, bulk
-- edit ≥50 baris). p_updates = jsonb array [{creator_id, level2_category,
-- price_segment, slots_total}, ...]. HANYA meng-UPDATE baris yang SUDAH ADA
-- (registry diisi recompute; bulk-set tidak pernah membuat kombinasi baru).
-- Gerbang K4 (siapa boleh mengubah baris siapa) SUDAH ditegakkan di server
-- action SEBELUM fungsi ini dipanggil (Langkah 5) — fungsi ini hanya
-- menjalankan tulisan yang sudah diotorisasi, dan CHECK ck_pxcc_no_overcommit
-- di tabel adalah lapis terakhir (bukan satu-satunya) penjaga over-commit.
create or replace function public.px_capability_bulk_set_slots(
  p_updates jsonb,
  p_actor uuid
) returns integer
language plpgsql security definer set search_path = public, bridge, pg_temp as $$
declare
  affected integer := 0;
begin
  create temporary table px_bulk_updates on commit drop as
  select u->>'creator_id' as creator_id,
         u->>'level2_category' as level2_category,
         (u->>'price_segment')::price_segment_t as price_segment,
         (u->>'slots_total')::smallint as slots_total
  from jsonb_array_elements(p_updates) u;

  update bridge.px_creator_capability pcc
  set slots_total = b.slots_total, updated_by = p_actor, updated_at = now()
  from px_bulk_updates b
  where pcc.creator_id = b.creator_id
    and pcc.level2_category = b.level2_category
    and pcc.price_segment = b.price_segment;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.px_capability_bulk_set_slots(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.px_capability_bulk_set_slots(jsonb, uuid) to service_role;

-- px_coverage: passthrough TIPIS ke bridge.px_coverage_map() untuk tab Coverage
-- di APLIKASI INI SENDIRI. Bukan implementasi kedua (CLAUDE.md #4/#8) — satu
-- baris SELECT, logika penuh tetap hanya di bridge.px_coverage_map(). Transport
-- lintas-proyek (CDPS membaca ini) tetap belum diputuskan (K5, di luar lingkup
-- PX-M1) — wrapper ini semata supaya /px/capability (tab Coverage) di proyek
-- MCN sendiri bisa memanggilnya lewat createAdminClient(), dengan alasan
-- struktural yang sama seperti tiga fungsi di atas.
create or replace function public.px_coverage(p_level2 text default null)
returns table (
  level2_category text,
  price_segment public.price_segment_t,
  creator_count bigint,
  total_slots_available bigint,
  total_proven_gmv numeric,
  status text
)
language sql stable security definer set search_path = public, bridge, pg_temp as $$
  select * from bridge.px_coverage_map(p_level2);
$$;

revoke execute on function public.px_coverage(text) from public, anon, authenticated;
grant execute on function public.px_coverage(text) to service_role;
