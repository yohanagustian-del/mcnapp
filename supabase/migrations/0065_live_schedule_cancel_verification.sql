-- Verifikasi Hari Ini (M13): CM/Creator Support kadang menemukan slot yang sudah
-- lewat TIDAK jadi live sama sekali (bukan direncanakan OFF sejak awal). Sebelumnya
-- satu-satunya hasil verifikasi adalah 'done' (live berjalan) — baris yang batal
-- terpaksa dipaksa 'done' dengan jam karangan, atau dibiarkan menumpuk di "belum
-- diverifikasi" selamanya. Tambah status terminal 'cancelled' + alasannya, ditulis
-- lewat jalur verifikasi yang sama (schedule.verify), sama seperti 'done'.

alter table live_schedule_slots
  drop constraint live_schedule_slots_status_check,
  add constraint live_schedule_slots_status_check
    check (status in ('scheduled','tentative','off','done','cancelled'));

alter table live_schedule_slots add column cancel_reason text;

comment on column live_schedule_slots.status is
  'scheduled = planned; tentative = not yet confirmed; off = creator not live that day (see off_reason); done = verified after the fact (locked from edit/delete); cancelled = was scheduled but did not go live, found out at verification time (see cancel_reason, also locked).';
comment on column live_schedule_slots.cancel_reason is
  'Free text reason when status=''cancelled'', filled at verification (schedule.verify). Null otherwise. Distinct from off_reason (that one is set when the slot is planned off from the start).';
