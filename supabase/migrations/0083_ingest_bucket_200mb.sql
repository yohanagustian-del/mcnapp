-- 0083 — Naikkan batas bucket ingest-uploads dari 100MB ke 200MB.
--
-- Commit 2f00e60 (terima export Shopee 120-200MB) sudah menaikkan konstanta
-- INGEST_MAX_OBJECT_BYTES ke 200MB di bucket.ts, tapi bucket limit di database
-- masih 100MB. Hasilnya: upload file besar ditolak Supabase dengan error generic,
-- padahal seharusnya sukses dikompresi. Migration ini menyamakan bucket limit
-- dengan konstanta kode.

update storage.buckets
set file_size_limit = 209715200  -- 200MB
where id = 'ingest-uploads';
