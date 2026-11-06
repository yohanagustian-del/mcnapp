-- ============================================================
-- 0101_ads_by_brand_payment.sql
-- Metode pembayaran Request Ads baru: "Ads by Brand" (D-2026-11-06-1, mengganti sebagian
-- D-2026-10-31-3). Brand menjalankan/membayar ads sendiri → tanpa ACC Finance/Director,
-- tanpa cek uang masuk, tanpa invoice. Hanya untuk funding_type = 'brand_budget'.
--
-- Status awal (`siap_dieksekusi`) ditentukan aplikasi (lib/m10/request.ts initialRequestStatus);
-- skema hanya memperluas daftar nilai payment_method. Tanpa tabel/view baru → tidak perlu
-- policy deny is_creator_user(). Tanpa penghapusan policy/trigger (K23). Idempoten.
-- ============================================================

alter table ads_briefs drop constraint if exists ck_ads_brief_payment_method;
alter table ads_briefs add constraint ck_ads_brief_payment_method
  check (
    payment_method is null
    or (payment_method in ('cash_upfront','invoice') and funding_type in ('creator_budget','brand_budget'))
    or (payment_method = 'ads_by_brand' and funding_type = 'brand_budget')
  );

comment on column ads_briefs.payment_method is
  'cash_upfront | invoice (creator_budget/brand_budget) | ads_by_brand (brand_budget saja, tanpa ACC — D-2026-11-06-1).';
