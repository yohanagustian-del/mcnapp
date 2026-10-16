-- ============================================================
-- 0091_special_project_brands.sql
-- Request user 2026-10-16: Special Project (M7) mencatat jumlah BRAND yang bergabung.
--   1. special_projects.target_brands — target jumlah brand, diisi di awal (form Buat
--      Project / Edit Project); brand-nya dicari BizDev.
--   2. special_project_brands — SATU baris per brand yang sudah bergabung ke project.
--      "Jumlah brand bergabung" = count baris (tidak disimpan di special_projects,
--      supaya tidak ada angka kedua yang bisa basi — CLAUDE.md #4).
--
-- shop_key (opsional) = kunci shop di tab Deal Brand (view deal_shop_summary, sama
-- dengan products_tap/brand_deals.shop_key). Bukan FK karena shop = hasil grouping,
-- bukan tabel; brand yang belum terdaftar di Deal Brand tetap boleh dicatat dengan
-- nama saja. brand_key = nama dinormalisasi (huruf+angka lowercase, brandLeadKey) —
-- satu brand tidak bisa tercatat dua kali di project yang sama.
--
-- on delete cascade ke special_projects: RPC delete_special_project (0069) tidak perlu
-- diubah; isi brand ikut direkam ke audit_logs oleh server action deleteProject.
--
-- Tulis HANYA lewat server action (service role). RLS: select authenticated +
-- restrictive deny is_creator_user() (CLAUDE.md #9). Tanpa pernyataan hapus apa pun (K23).
-- ============================================================

alter table special_projects
  add column if not exists target_brands int check (target_brands is null or target_brands >= 1);

comment on column special_projects.target_brands is
  'Target jumlah brand yang bergabung (dicari BizDev). NULL = tidak ditargetkan. Realisasi = count(special_project_brands).';

create table if not exists special_project_brands (
  id bigserial primary key,
  project_id bigint not null references special_projects(id) on delete cascade,
  brand_name text not null check (length(btrim(brand_name)) > 0),
  brand_key text not null,
  shop_key text,
  bizdev_id uuid references team_members(id),
  joined_at date not null default current_date,
  notes text,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  unique (project_id, brand_key)
);
create index if not exists special_project_brands_shop_idx on special_project_brands (shop_key);
create index if not exists special_project_brands_bizdev_idx on special_project_brands (bizdev_id);

alter table special_project_brands enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'special_project_brands' and policyname = 'spb_select') then
    create policy spb_select on special_project_brands for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'special_project_brands' and policyname = 'spb_creator_deny') then
    create policy spb_creator_deny on special_project_brands as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

comment on table special_project_brands is
  'Brand yang bergabung ke Special Project (M7), satu baris per brand. Realisasi vs special_projects.target_brands. shop_key opsional = shop di tab Deal Brand.';
