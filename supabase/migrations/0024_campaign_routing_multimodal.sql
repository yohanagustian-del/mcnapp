-- ============ campaign_requests: routing multi-modal (PRD M8 §2E.1) ============
-- BizDev tidak lagi mengetik creator ID manual. Satu form 3 kolom:
--   1. Kreator (centang) → route ke CM pemilik (owner_cpm_id) — perilaku lama.
--   2. Kategori level-2/niche (centang) → semua CM yang punya kreator dengan
--      penjualan (gmv>0) di kategori itu; creator_id kosong, CM pilih kreatornya.
--   3. Teks request bebas → broadcast ke semua CM aktif bila kolom 1 & 2 kosong;
--      selain itu jadi deskripsi yang menempel di tiap baris.
-- creator_id memang sudah nullable (0001) — baris kategori/broadcast diisi CM
-- saat konfirmasi (action cmClaimBroadcastRequest).

alter table campaign_requests
  add column if not exists route_type text
    check (route_type in ('creator','category','broadcast')) default 'creator';
alter table campaign_requests
  add column if not exists level2_category text;      -- diisi utk route_type='category'
alter table campaign_requests
  add column if not exists request_text text;         -- teks kebutuhan dari BizDev (kolom 3)

create index if not exists campaign_requests_route_type_idx
  on campaign_requests (route_type, owner_cpm_id);
