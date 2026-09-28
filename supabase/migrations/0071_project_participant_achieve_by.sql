-- M7 Special Project: kolom "Achieve by" di tabel Performa per Kreator.
-- Kosong (null) secara default — diisi tim lewat form edit setelah peserta berjalan,
-- bukan wajib diisi saat peserta ditambahkan (permintaan user 2026-09-28).
alter table project_participants
  add column if not exists achieve_by text
    check (achieve_by is null or achieve_by in ('Keterangan', 'Brand Pairs', 'Ads By'));
