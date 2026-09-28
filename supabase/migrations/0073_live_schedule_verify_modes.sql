-- PLAN_MSDPS_mcnapp.md Paket A (R1/R2, disetujui pemilik 2026-09-28): verifikasi
-- "Hari Ini" dipecah jadi 3 pilihan (Live Sesuai Jam Rencana / Live Dengan Jam Baru /
-- Tidak Jadi Live) alih-alih satu form jam manual, plus Fokus Produk REALISASI yang
-- terpisah dari rencana (Q3 — bukan menimpa live_schedule_slots.fokus_produk).

alter table live_schedule_slots
  add column actual_time_source text
    check (actual_time_source in ('sesuai_rencana', 'input_manual', 'auto_sistem')),
  add column fokus_produk_live text;

comment on column live_schedule_slots.actual_time_source is
  'How actual_start/actual_end were set: sesuai_rencana = CM confirmed the planned time as-is (server copies start_time/end_time, PLAN_MSDPS A-03); input_manual = CM entered a different actual time; auto_sistem = auto-verified after m13.auto_verify_hours with no CM input, actual_start/end left NULL (Paket B, migration 0076). NULL = not yet verified, or verified before this column existed (backfilled to input_manual below for already-done rows).';
comment on column live_schedule_slots.fokus_produk_live is
  'Focus product/promo actually used during the live, filled at verification. Separate column from the plan''s fokus_produk (CLAUDE.md #4 single source of truth still holds: this is a REALIZED fact recorded once, at verification time, not a second computation of the same thing). Optional (no NOT NULL — CLAUDE.md #6 precedent: do not force data teams do not have).';

-- Backfill: every slot already verified 'done' before this migration was verified the
-- old way (client-entered actual times), so it is 'input_manual' by definition — never
-- 'sesuai_rencana' (that mode didn't exist yet) and never 'auto_sistem' (Paket B hasn't
-- shipped). 'cancelled' rows have no actual_start/actual_end and are left NULL.
update live_schedule_slots
  set actual_time_source = 'input_manual'
  where status = 'done' and actual_time_source is null;
