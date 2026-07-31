-- Kelas kreator: Reguler / Top Creator / Influencer (tab Kreator + template import).
--
-- SENGAJA kolom baru, bukan memakai creators.segment (creator_segment_t:
-- tc | incubation | celeb = Top Creator / Incubation / Celebrity). Dua sumbu yang
-- berbeda: `segment` sudah menggerakkan logika lain (gating e-sign kontrak hanya
-- untuk tc/celeb, pembagian tim CM) dan tidak punya padanan "Reguler", sementara
-- "kelas" tidak punya padanan "Incubation". Menyatukan keduanya berarti mengubah
-- arti data yang sudah dipakai — di luar cakupan perubahan ini.
--
-- NOT NULL DEFAULT 'reguler': kolom kosong = Reguler, baik untuk 1147 baris yang
-- sudah ada (di-backfill oleh DEFAULT) maupun untuk insert dari import. Jadi tabel
-- kreator tidak pernah menampilkan kelas kosong. Postgres 11+ tidak menulis ulang
-- tabel untuk ADD COLUMN ... DEFAULT, jadi ini aman di tabel eksisting.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'creator_class_t') then
    create type creator_class_t as enum ('reguler', 'top_creator', 'influencer');
  end if;
end $$;

alter table creators
  add column if not exists creator_class creator_class_t not null default 'reguler';

comment on column creators.creator_class is
  'Kelas kreator: reguler|top_creator|influencer. Kosong = reguler. Berbeda dari creators.segment (tc/incubation/celeb) yang menggerakkan gating e-sign & pembagian tim CM.';
