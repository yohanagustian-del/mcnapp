-- Status payment project: tambah pilihan 'ads_by_brand'.
--
-- Project yang biayanya ditanggung brand tidak melewati Finance sama sekali, jadi
-- ketiga status lama ('done' + dua status proses Finance) memaksa BD memilih status
-- yang salah atau membiarkannya kosong — dan kosong berarti "belum diisi", bukan
-- "tidak ada yang dibayar". Pilihan ini memberi keadaan itu namanya sendiri.
--
-- Hanya memperlebar check constraint; baris lama tetap sah.
alter table bd_projects
  drop constraint if exists bd_projects_status_payment_check;

alter table bd_projects
  add constraint bd_projects_status_payment_check
    check (status_payment in ('done', 'proses_finance_payment', 'proses_finance_brand', 'ads_by_brand'));

comment on column bd_projects.status_payment is
  'Status pembayaran project: done | proses_finance_payment | proses_finance_brand | ads_by_brand. Null = belum diisi.';
