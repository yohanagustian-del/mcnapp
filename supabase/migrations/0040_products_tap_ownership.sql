-- Produk TAP: kepemilikan baris per akun peng-upload + kunci per campaign.
--
-- Konteks: export TAP "Export link" diambil PER room campaign, dan tiap bizdev
-- meng-upload campaign yang dia pegang sendiri (pola yang sama dengan CM
-- meng-upload data mingguan → upload_batches.uploaded_by).
--
-- Kenapa campaign_id ikut jadi kunci: satu produk yang sama bisa ditawarkan di
-- lebih dari satu room campaign, dan RATE KOMISINYA BERBEDA per campaign. Dengan
-- primary key lama (product_id saja), upload bizdev kedua akan menimpa baris
-- bizdev pertama — rate komisi campaign pertama hilang DAN kepemilikan barisnya
-- ikut berpindah diam-diam. Kunci (campaign_id, product_id) membuat tiap campaign
-- berdiri sendiri.
--
-- Baris hasil derive dari ingest TAP mingguan tidak punya campaign. Kolom kunci
-- tidak boleh null, jadi baris seperti itu memakai sentinel '-'.

update products_tap set campaign_id = '-' where campaign_id is null;

alter table products_tap alter column campaign_id set default '-';
alter table products_tap alter column campaign_id set not null;

alter table products_tap drop constraint products_tap_pkey;
alter table products_tap add primary key (campaign_id, product_id);

-- Primary key lama ikut membawa index product_id; setelah diganti, jalur derive
-- (upsertDerivedFromTap) yang membaca `.in("product_id", ...)` kehilangan index-nya.
create index products_tap_product_id_idx on products_tap (product_id);

-- Pemilik baris = akun yang meng-upload. Null untuk baris derive dari ingest
-- mingguan (tidak ada yang meng-upload secara manual) dan untuk data lama.
alter table products_tap
  add column uploaded_by uuid references team_members(id);

create index products_tap_uploaded_by_idx on products_tap (uploaded_by);

comment on column products_tap.uploaded_by is
  'Akun team_members yang meng-upload baris ini (master upload). Null = hasil derive ingest mingguan.';
comment on column products_tap.campaign_id is
  'Campaign ID dari export TAP; bagian dari primary key. Sentinel ''-'' untuk baris tanpa campaign (derive ingest).';
