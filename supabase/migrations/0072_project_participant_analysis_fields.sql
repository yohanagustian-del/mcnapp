-- M7 Special Project: ganti kolom "Achieve By" (0071) dengan 3 kolom terpisah
-- sesuai kebutuhan baru (permintaan user 2026-09-28) — semuanya kosong secara
-- default, diisi tim lewat form edit setelah peserta berjalan:
--  - analisa: teks bebas
--  - brand_pairs: teks bebas
--  - ads_by: multi-pilihan tetap (MEA / Brand), disimpan sebagai text[]
alter table project_participants drop column if exists achieve_by;

alter table project_participants
  add column if not exists analisa text,
  add column if not exists brand_pairs text,
  add column if not exists ads_by text[]
    check (ads_by is null or ads_by <@ array['MEA', 'Brand']::text[]);
