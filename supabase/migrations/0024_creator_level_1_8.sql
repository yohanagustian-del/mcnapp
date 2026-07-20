-- Widen creators.level range 1..6 → 1..8.
-- Creator levels sekarang berjalan sampai 8 (keputusan CM). Constraint lama
-- dibuat inline di 0001 (level smallint check (level between 1 and 6)) sehingga
-- Postgres memberi nama otomatis creators_level_check. Drop lalu buat ulang.
alter table creators drop constraint if exists creators_level_check;
alter table creators add constraint creators_level_check check (level between 1 and 8);
