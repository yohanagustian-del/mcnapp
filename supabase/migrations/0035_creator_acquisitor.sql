-- 0035: Akuisitor kreator (tim akuisisi yang membawa masuk kreator).
--
-- `creators.tim_akuisisi` yang lama adalah TEKS BEBAS dari sheet warisan — tidak
-- bisa dipakai untuk filter/rollup karena ejaannya berbeda-beda. Kolom baru ini
-- menunjuk langsung ke anggota tim (role acquisition_spec / acquisition_lead =
-- grup "acquisition"), jadi namanya selalu konsisten dengan menu Tim.
--
-- CATATAN PostgREST: setelah kolom ini ada, `creators` punya DUA foreign key ke
-- `team_members` (owner_cpm_id + acquisitor_id). Embed `team_members(name)`
-- tanpa petunjuk relasi jadi ambigu, jadi seluruh query embed di aplikasi harus
-- memakai bentuk eksplisit `team_members!creators_owner_cpm_id_fkey(name)` /
-- `team_members!creators_acquisitor_id_fkey(name)`.
alter table creators
  add column if not exists acquisitor_id uuid references team_members(id);

create index if not exists creators_acquisitor_id_idx on creators (acquisitor_id);

comment on column creators.acquisitor_id is
  'Anggota tim akuisisi (role acquisition_spec / acquisition_lead) yang mengakuisisi kreator ini. Teks bebas lama ada di tim_akuisisi.';
