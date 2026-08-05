-- Rename label kelas kreator "Top Creator" → "Kreator Prioritas" (tab Kreator).
--
-- HANYA komentar kolom yang berubah. Nilai enum `top_creator` DIBIARKAN apa adanya:
-- label adalah lapisan tampilan (src/lib/creators/creator-class.ts →
-- CREATOR_CLASS_LABEL), sementara mengganti nilai enum berarti rename enum value +
-- menyentuh setiap baris kreator yang sudah memakainya, tanpa manfaat fungsional.
-- Komentar ini di-update supaya orang yang membaca schema tidak salah menduga
-- labelnya masih "Top Creator".

comment on column creators.creator_class is
  'Kelas kreator: reguler|top_creator|influencer. Label UI: Reguler | Kreator Prioritas | Influencer (top_creator ditampilkan sebagai "Kreator Prioritas"; nilai enum sengaja tidak diganti). Kosong = reguler. Berbeda dari creators.segment (tc/incubation/celeb) yang menggerakkan gating e-sign & pembagian tim CM.';
