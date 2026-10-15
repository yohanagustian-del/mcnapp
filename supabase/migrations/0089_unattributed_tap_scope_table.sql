-- ============================================================
-- 0089_unattributed_tap_scope_table.sql
-- Perbaikan 0088 (upload September 2026-10-15): lingkup hapus "GMV TAP tanpa nama
-- kreator" disimpan sebagai array source_creator_ids DI SETIAP BARIS + index GIN.
-- Satu upload mingguan penuh (MEA + Academy = ±1.600 kreator, ±puluhan ribu shop tanpa
-- kreator) = puluhan juta entri GIN dalam satu insert → statement timeout, batch gagal.
--
-- Lingkup itu milik BATCH, bukan milik baris shop: pindah ke tabel
-- creator_shop_period_unattributed_scope (satu baris per batch × kreator). Ingest:
-- cari batch lama minggu yang sama yang memuat kreator mana pun dari file ini → hapus
-- baris unattributed + lingkup batch itu → tulis lingkup + baris baru. Semantik sama
-- dengan 0088 (upload ulang tidak menggandakan angka), hanya penyimpanannya.
--
-- File ini SENGAJA tanpa pernyataan DROP apa pun: apply_migration menggantung pada
-- pernyataan hapus (HANDOFF 2026-10-13, K23; terulang 2026-10-15 untuk drop index/column).
-- Kolom lama source_creator_ids + index GIN-nya DIBIARKAN: tidak lagi ditulis (default
-- '{}', GIN untuk array kosong murah) dan tidak dibaca siapa pun. Tulis HANYA lewat service role; RLS select authenticated +
-- restrictive deny is_creator_user() (CLAUDE.md #9).
-- ============================================================

create table if not exists creator_shop_period_unattributed_scope (
  platform text not null default 'tiktok' check (platform in ('tiktok', 'shopee')),
  upload_batch text not null,
  period_start date not null,
  creator_id text not null,
  primary key (platform, upload_batch, creator_id)
);
create index if not exists cspu_scope_lookup_idx
  on creator_shop_period_unattributed_scope (platform, period_start, creator_id);
create index if not exists cspu_tap_batch_idx
  on creator_shop_period_unattributed_tap (platform, upload_batch);

alter table creator_shop_period_unattributed_scope enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_period_unattributed_scope' and policyname = 'cspu_scope_select') then
    create policy cspu_scope_select on creator_shop_period_unattributed_scope for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_shop_period_unattributed_scope' and policyname = 'cspu_scope_creator_deny') then
    create policy cspu_scope_creator_deny on creator_shop_period_unattributed_scope as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

comment on table creator_shop_period_unattributed_scope is
  'Kreator file MCN per batch yang menulis creator_shop_period_unattributed_tap — lingkup hapus-lalu-tulis saat upload ulang minggu yang sama (pengganti array source_creator_ids, 0089).';

-- Pindahkan lingkup baris yang sudah ada (bila ada).
insert into creator_shop_period_unattributed_scope (platform, upload_batch, period_start, creator_id)
select distinct u.platform, u.upload_batch, u.period_start, c.creator_id
  from creator_shop_period_unattributed_tap u
  cross join lateral unnest(u.source_creator_ids) as c(creator_id)
on conflict do nothing;
