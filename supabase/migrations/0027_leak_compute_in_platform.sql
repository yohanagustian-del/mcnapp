-- 0027 — Analisa link leakage DIHITUNG DI PLATFORM (menggantikan artifak eksternal).
--
-- Konteks: sejak 0020/0021 analisa bocor dijalankan CM di tool HTML terpisah
-- ("Agency Leaked Generator"), lalu file Excel hasilnya diupload ke /ingest Lane 2.
-- Platform hanya menyimpan hasil. Keputusan baru (interview): fungsi artifak
-- dipindah KE DALAM platform — halaman /link-leakage (dan Lane 1 /ingest, yang
-- sudah menerima file MCN+TAP mingguan yang sama) kini menghitung sendiri:
--   bocor = Σ max(0, affiliate_gmv[MCN] − affiliate_gmv[TAP]) per (product_id, shop_id)
--           pada shop ber-deal  (CLAUDE.md #5 — angka RESMI)
--   pembanding = rumus per-shop yang dipakai artifak (selalu ≤ angka per-produk)
-- Master shop ber-deal: tabel cooperating_shops (default) ATAU file "Master Data
-- Shop" yang diupload (input ke-3 artifak) untuk minggu di mana master DB belum
-- lengkap.
--
-- Yang disimpan tetap ROLLUP SAJA (keputusan user): detail per produk TIDAK masuk
-- Postgres — diekspor sebagai CSV backup ke bucket privat `leak-exports`
-- (retensi by umur, app_config retention.leak_export_days).
--
-- Migration ini hanya MEMPERLUAS skema yang sudah ada (tidak ada tabel baru):
--   1. provenance baru 'platform' (creator_link_status.source, bd_leads.source,
--      leak_week_summary.source_format) — baris era artifak/engine tidak disentuh.
--   2. kolom pembanding basis-shop di creator_link_status + leak_week_summary.
--   3. seed app_config retensi backup CSV.
--   4. bucket privat `leak-exports` + policy storage (per-folder uid).

-- ============ 1. creator_link_status: provenance 'platform' + basis pembanding ============
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'creator_link_status'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source%';
  if c is not null then
    execute format('alter table creator_link_status drop constraint %I', c);
  end if;
end $$;
alter table creator_link_status
  add constraint creator_link_status_source_check
  check (source in ('engine', 'artifact', 'platform'));

alter table creator_link_status
  add column if not exists gmv_bocor_shop_basis numeric,
  add column if not exists leak_ratio_shop_basis numeric;

comment on column creator_link_status.source is
  'Asal rollup: engine (M4 lama, dari tabel transaksi) | artifact (upload Excel Agency Leaked Generator) | platform (dihitung platform dari file MCN+TAP mingguan, src/lib/m4/leak-analysis.ts).';
comment on column creator_link_status.gmv_bocor_shop_basis is
  'PEMBANDING (bukan angka resmi): GMV bocor bila dijoin per shop_id saja — rumus artifak lama. Selalu <= gmv_bocor (join per product_id+shop_id, CLAUDE.md #5). NULL untuk baris era engine/artifak.';
comment on column creator_link_status.leak_ratio_shop_basis is
  'Rasio bocor versi basis-shop (pembanding transisi dari artifak). NULL untuk baris era engine/artifak.';

-- ============ 2. leak_week_summary: totals platform + pembanding basis-shop ============
alter table leak_week_summary
  add column if not exists gmv_leak_potential_shop_basis numeric;

do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'leak_week_summary'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source_format%';
  if c is not null then
    execute format('alter table leak_week_summary drop constraint %I', c);
  end if;
end $$;
alter table leak_week_summary
  add constraint leak_week_summary_source_format_check
  check (source_format in ('artifact_v1', 'artifact_v2', 'platform'));

comment on column leak_week_summary.source_format is
  'Asal angka mingguan: artifact_v1 | artifact_v2 (upload Excel artifak) | platform (dihitung platform dari file MCN+TAP).';
comment on column leak_week_summary.gmv_leak_potential_shop_basis is
  'Pembanding total bocor versi basis-shop (rumus artifak). NULL untuk baris hasil upload artifak.';

-- ============ 3. bd_leads: provenance 'platform' ============
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'bd_leads'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%source%';
  if c is not null then
    execute format('alter table bd_leads drop constraint %I', c);
  end if;
end $$;
alter table bd_leads
  add constraint bd_leads_source_check
  check (source in ('auto_m4', 'manual_cm', 'artifact', 'platform'));

-- ============ 4. app_config: retensi backup CSV ============
insert into app_config(key, value) values
  ('retention.leak_export_days', '30')
on conflict (key) do nothing;

-- ============ 5. Bucket privat backup CSV hasil analisa ============
-- Detail produk bocor tidak disimpan di Postgres (keputusan "rollup saja"), tapi CM
-- tetap butuh file backup seperti dulu punya Excel artifak. File CSV ditulis server
-- (service-role) ke folder uid pengunggah, diunduh lewat signed URL (1 jam), dan
-- dibersihkan otomatis berdasarkan umur (retention.leak_export_days).
insert into storage.buckets (id, name, public, file_size_limit)
values ('leak-exports', 'leak-exports', false, 104857600)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'leak_exports_select_own'
  ) then
    create policy "leak_exports_select_own"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'leak-exports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'leak_exports_delete_own'
  ) then
    create policy "leak_exports_delete_own"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'leak-exports'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
-- Tidak ada policy INSERT untuk user: file backup HANYA ditulis server (service-role).
