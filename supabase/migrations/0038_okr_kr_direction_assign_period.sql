-- 0038: Sifat KR (positif/negatif) + periode penugasan OKR.
--
-- 1. kr_direction — arah Key Result yang dianggap BAIK:
--      positif = makin tinggi makin baik (target = batas bawah), mis. "Total GMV".
--      negatif = makin rendah makin baik (target = batas atas),  mis. "GMV bocor".
--    Tanpa keterangan ini, "target 10" pada KR penurunan tidak bisa dibedakan dari
--    target kenaikan — dan scoring apa pun yang membaca naskah ini nanti akan salah
--    arah. Default 'positif' karena itu bentuk mayoritas KR yang sudah ada.
--
-- 2. period_start / period_end pada okr_assignments — kapan penugasan itu berlaku.
--    Sengaja di penugasan, BUKAN di naskah OKR: teks OKR-nya bisa dipakai ulang
--    untuk quartal berikutnya, dan anggota yang masuk di tengah periode bisa
--    dapat rentang sendiri. Nullable karena baris penugasan yang sudah ada dibuat
--    sebelum kolom ini ada (UI mewajibkan tanggal untuk penugasan baru).

alter table okr_objective_key_results
  add column if not exists kr_direction text not null default 'positif'
    check (kr_direction in ('positif', 'negatif'));

comment on column okr_objective_key_results.kr_direction is
  'positif = makin tinggi makin baik (target batas bawah); negatif = makin rendah makin baik (target batas atas).';

alter table okr_assignments
  add column if not exists period_start date,
  add column if not exists period_end date;

alter table okr_assignments
  drop constraint if exists okr_assignments_period_order;
alter table okr_assignments
  add constraint okr_assignments_period_order
    check (period_start is null or period_end is null or period_end >= period_start);

-- Satu anggota boleh dapat OKR yang sama untuk PERIODE yang berbeda (Q3 lalu Q4),
-- tapi tidak dua kali untuk periode yang sama. NULLS NOT DISTINCT menjaga baris
-- warisan tanpa periode tetap tidak bisa kembar.
drop index if exists okr_assignments_uniq;
create unique index okr_assignments_uniq
  on okr_assignments (okr_name, member_id, period_start, period_end)
  nulls not distinct;
