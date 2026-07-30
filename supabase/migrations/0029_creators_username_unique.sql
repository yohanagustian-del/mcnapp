-- 0029 — PENGAMAN DB anti-duplikat kreator: unique (lower(username), platform).
--
-- ⚠ PRASYARAT: jalankan `scripts/dedupe-creators.sql` (merge duplikat) DULU di database
-- yang sama. Migration ini SENGAJA gagal dengan pesan jelas kalau masih ada duplikat —
-- lebih baik berhenti daripada diam-diam tidak punya pengaman.
--
-- Kenapa (lower(username), platform) dan bukan username saja: ingest Shopee mencocokkan
-- kreator HANYA di dalam platform-nya (resolveCreatorNamesByPlatform, CLAUDE.md #5), jadi
-- satu handle boleh punya satu baris TikTok dan satu baris Shopee. NULL platform
-- disatukan dengan 'tiktok': di produksi 807 baris platform NULL semuanya lahir dari
-- ingest TikTok, dan menyatukannya mencegah "baris kembar TikTok, satu NULL satu tiktok"
-- yang jadi salah satu bentuk duplikat sebelum ini.
--
-- Baris tanpa username (6 baris di produksi — master lama) tidak ikut index (WHERE
-- username is not null): mereka tidak bisa dicocokkan otomatis dan bukan sumber duplikat.

do $$
declare
  dup_groups int;
  dup_rows int;
  sample text;
begin
  select count(*), coalesce(sum(c), 0)
    into dup_groups, dup_rows
  from (
    select count(*) as c
    from creators
    where username is not null
    group by lower(username), coalesce(platform, 'tiktok')
    having count(*) > 1
  ) d;

  if dup_groups > 0 then
    select string_agg(u, ', ')
      into sample
    from (
      select lower(username) as u
      from creators
      where username is not null
      group by lower(username), coalesce(platform, 'tiktok')
      having count(*) > 1
      order by count(*) desc
      limit 5
    ) s;

    raise exception
      'Masih ada % username duplikat (% baris) di creators — contoh: %. Jalankan scripts/dedupe-creators.sql dulu, baru apply 0029.',
      dup_groups, dup_rows, sample;
  end if;
end $$;

create unique index if not exists creators_username_platform_uidx
  on creators (lower(username), coalesce(platform, 'tiktok'))
  where username is not null;

comment on index creators_username_platform_uidx is
  'Pengaman terakhir anti-duplikat master kreator (0029). Satu baris per handle per platform; platform NULL dihitung sebagai tiktok. Index lama creators_username_idx (non-unique, 0009) dibiarkan untuk pencarian.';
