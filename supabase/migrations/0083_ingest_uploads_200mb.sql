-- 0083 — Naikkan batas objek bucket `ingest-uploads` 100MB → 200MB.
--
-- Feedback tim: export Conversion Report Shopee per kreator bisa 120–200MB,
-- sedangkan bucket (0026) membatasi 100MB. Sejak perubahan ini browser
-- mengompres CSV dengan gzip sebelum upload (src/lib/ingest/upload-client.ts,
-- rasio ±3x → CSV 200MB jadi ±65MB) dan server mengekstraknya kembali
-- (src/lib/ingest/storage.ts), jadi yang dibatasi di sini = ukuran TERKOMPRESI.
-- 200MB memberi ruang untuk .zip/.xlsx yang tidak bisa dikompres ulang. Angka ini
-- WAJIB sama dengan INGEST_MAX_OBJECT_BYTES (src/lib/ingest/bucket.ts, dicek di
-- browser sebelum upload); batas hasil ekstrak dijaga terpisah di server
-- (INGEST_MAX_DECOMPRESSED_BYTES, 400MB).
--
-- Catatan: batas per-bucket tidak bisa melampaui "Upload file size limit" global
-- project (Dashboard → Storage → Settings). Pastikan nilai global ≥ 200MB.

update storage.buckets
   set file_size_limit = 209715200
 where id = 'ingest-uploads';
