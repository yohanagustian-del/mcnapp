-- SUSULAN DRIFT: unique index anti-duplikat master kreator.
--
-- Sama seperti 0049, migrasi ini pernah diterapkan langsung ke database (production
-- 2026-07-30, tercatat sebagai "0029_creators_username_unique") tanpa file di repo.
-- Nomor 0029 sudah dipakai 0029_creator_class, jadi susulannya di sini.
--
-- Blok DO di depan BUKAN hiasan: index ini gagal dibuat kalau masih ada duplikat, dan
-- pesan error Postgres bawaan ("could not create unique index") tidak menyebut username
-- mana yang bentrok. Blok ini menyebutkannya + menunjuk script pembersihnya, sehingga
-- migrasi berhenti dengan instruksi, bukan teka-teki.

do $$
declare dup_groups int; dup_rows int; sample text;
begin
  select count(*), coalesce(sum(c), 0) into dup_groups, dup_rows
  from (select count(*) as c from creators where username is not null
        group by lower(username), coalesce(platform, 'tiktok') having count(*) > 1) d;
  if dup_groups > 0 then
    select string_agg(u, ', ') into sample from (
      select lower(username) as u from creators where username is not null
      group by lower(username), coalesce(platform, 'tiktok') having count(*) > 1
      order by count(*) desc limit 5) s;
    raise exception
      'Masih ada % username duplikat (% baris) di creators — contoh: %. Jalankan scripts/dedupe-creators.sql dulu.',
      dup_groups, dup_rows, sample;
  end if;
end $$;

create unique index if not exists creators_username_platform_uidx
  on creators (lower(username), coalesce(platform, 'tiktok'))
  where username is not null;

comment on index creators_username_platform_uidx is
  'Pengaman terakhir anti-duplikat master kreator. Satu baris per handle per platform; platform NULL dihitung sebagai tiktok.';
