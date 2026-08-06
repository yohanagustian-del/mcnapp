-- ============================================================
-- 0031_role_finance_lead.sql
-- Role baru: finance_lead (Senior / Lead Finance).
--
-- Kenapa role baru, bukan memakai `finance` yang sudah ada:
-- mekanisme ubah transaksi (0032) SENGAJA dibatasi ke tingkat senior/lead —
-- staff finance tetap boleh mencatat transaksi baru dan melihat detail, tapi
-- TIDAK boleh mengajukan perubahan metode/nominal pembayaran. Dua tingkat izin
-- yang berbeda tidak bisa diwakili satu label enum.
--
-- Divisi tetap `finance` (ROLE_TEAM_GROUP di src/lib/tim/roles.ts).
--
-- CATATAN: `alter type ... add value` harus berada di migration sendiri —
-- label enum baru tidak boleh DIPAKAI pada transaksi yang sama saat ia dibuat.
-- Karena itu 0032 (yang mereferensikan 'finance_lead' di policy RLS) dipisah.
-- Pola yang sama dipakai 0010 untuk 'ads_support'/'od_viewer'.
-- ============================================================

alter type role_t add value if not exists 'finance_lead';
