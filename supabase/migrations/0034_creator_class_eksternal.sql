-- Kelas kreator ke-4: "Eksternal" (total 4 kelas).
--
-- Kreator LUAR agency (tidak dikelola CM MEA — mis. hanya ikut campaign / special
-- project) sebelumnya tidak punya kelas yang tepat dan terpaksa dicatat sebagai
-- Reguler, sehingga tercampur dengan kreator kelolaan sendiri di tab Kreator dan
-- di filter kelas CM Workspace.
--
-- Nilai enum ditambah, bukan tabel/kolom baru: kelas tetap satu kolom
-- (creators.creator_class) dengan satu sumber label di
-- src/lib/creators/creator-class.ts. Default kolom TIDAK berubah (tetap
-- 'reguler'), jadi tidak ada baris lama yang berpindah kelas.
--
-- Catatan Postgres: ALTER TYPE ... ADD VALUE tidak boleh dipakai pada nilai baru
-- di transaksi yang sama. Migration ini hanya MENAMBAH nilainya (tidak ada
-- INSERT/UPDATE yang memakai 'eksternal'), jadi aman dijalankan dalam satu
-- transaksi.

alter type creator_class_t add value if not exists 'eksternal';

comment on column creators.creator_class is
  'Kelas kreator: reguler|top_creator|influencer|eksternal. Label UI: Reguler | Kreator Prioritas | Influencer | Eksternal (top_creator ditampilkan sebagai "Kreator Prioritas"; nilai enum sengaja tidak diganti). Eksternal = kreator luar agency, tidak dikelola CM MEA. Kosong = reguler. Berbeda dari creators.segment (tc/incubation/celeb) yang menggerakkan gating e-sign & pembagian tim CM.';
