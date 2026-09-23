-- ============================================================
-- 0068_brand_leads_creator_deny.sql
-- Brand Lead Bank (migrasi 0067) sengaja untuk BizDev, bukan portal kreator —
-- tertinggal saat 0067: brand_leads/brand_lead_contacts hanya punya select
-- policy `to authenticated using(true)` tanpa restrictive deny untuk
-- is_creator_user(), pola yang sudah dipakai products_tap (pt_creator_deny)
-- dan px_catalog_items (pxci_creator_deny). Tanpa ini, sesi creator_user bisa
-- membaca brand_leads (termasuk marketing_budget, kontak PIC brand) langsung
-- lewat PostgREST — bukan cuma lewat UI aplikasi yang memang tidak
-- menampilkannya ke kreator.
-- ============================================================

create policy brand_leads_creator_deny on brand_leads as restrictive for select
  using (not is_creator_user());

create policy brand_lead_contacts_creator_deny on brand_lead_contacts as restrictive for select
  using (not is_creator_user());
