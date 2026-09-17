-- ============================================================
-- 0063_m7_v2_live_session_natural_key_ignores_voided.sql
-- M7 v2 Special Project — kunci alami sesi live (project, kreator, tanggal,
-- nomor sesi) ikut melepas sesi yang DIBATALKAN, sama seperti dedupe hash file.
--
-- QA produksi 2026-09-17, lanjutan dari 0062: membatalkan sesi lalu upload ulang
-- file yang sama kini lolos V4 (hash sudah dilepas), lolos V7 (query aplikasi
-- memang mengabaikan sesi voided), tapi GAGAL di baris INSERT-nya:
--
--   duplicate key value violates unique constraint
--   "project_live_sessions_project_id_creator_id_session_date_se_key"
--
-- Constraint dari 0056 itu mencakup SEMUA baris termasuk `voided`, jadi sesi
-- yang sudah dibatalkan tetap menduduki nomor sesinya selamanya. 0062 hanya
-- memperbaiki dua index hash dan melewatkan kunci ini — akibatnya "batalkan lalu
-- upload ulang" berhenti satu langkah sebelum garis akhir.
--
-- R37 tetap berlaku persis: satu baris per (kreator, tanggal, nomor sesi) di
-- antara sesi yang MASIH DIHITUNG. Sesi voided memang sudah tidak dihitung di
-- mana pun (R41 / view project_creator_daily_live_v), jadi menahan slot nomornya
-- tidak melindungi apa pun.
-- ============================================================

alter table project_live_sessions
  drop constraint project_live_sessions_project_id_creator_id_session_date_se_key;

create unique index project_live_sessions_natural_key
  on project_live_sessions (project_id, creator_id, session_date, session_no)
  where attribution_status <> 'voided';
