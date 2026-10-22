# Tutorial Pengguna — Bulk Load Deal Brand (Oktober 2026)

Berlaku untuk PR #129–#134. Keputusan bisnisnya ada di `docs/DECISIONS.md`
(D-2026-10-20-1 s.d. -6). Semua proses **0 LLM**: parser dan pencocokan dijalankan oleh aturan tetap.

---

## 1. Siapa boleh apa

| Halaman | Fungsi | Role |
|---|---|---|
| `/deals/import` | Upload sheet → **Preview** → **Simpan** → **Export .xlsx** | Management, BizDev Lead, BD Admin (`deals.import_legacy`) |
| `/deals/import/preview` | Bandingkan hasil load di environment ini dengan produksi (read-only) | Management, BizDev Lead (`deals.import_preview`) |

---

## 2. Langkah import

1. Buka Google Sheet "All Brand TAP [Database Bizdev TikTok 2026]", lalu tab **"DATA BULKING! UNTUK KO YOHAN"**.
   Pilih *File → Download → .xlsx*. Unduhan .csv juga bisa. Dua baris header teratas jangan diubah.
2. Buka **Deal Brand → Import Bulk Deal Brand** (`/deals/import`), lalu pilih file tersebut.
3. Klik **Preview**. Tahap ini belum menulis apa pun ke database. Hasilnya berupa tab:
   - **Insert**: brand yang belum ada (dicocokkan lewat kunci *platform + Shop ID + Nama Brand*).
   - **Update**: brand yang sudah ada tapi isinya berbeda. Setiap field yang berubah ditampilkan sebelum → sesudah.
   - **Tidak berubah**: brand yang isinya sama.
   - **Perlu konfirmasi tim**:
     - baris yang di-skip dan TIDAK disimpan: duplikat persis, tanpa Shop ID, tanpa nama brand;
     - nama BizDev/Campaign Ops yang tidak cocok dengan akun;
     - status kosong;
     - nilai Ads/Niche/Leads di luar daftar;
     - tanggal ambigu;
     - brand yang perlu dipasang ke Project BD.
4. Kalau hasil Preview sudah benar, klik **Simpan**. Aturan penyimpanan:
   - Baris baru dimasukkan. Untuk baris lama, hanya field yang berubah yang ditulis.
   - Kalau satu batch gagal, baris diulang satu per satu, jadi baris lain tetap masuk.
   - Exp Date disinkronkan ke `cooperating_shops` agar alert kadaluarsa M4 tetap jalan.
   - BizDev penanggung jawab ditulis hanya jika semua nama cocok dengan akun dan tidak ada konflik (maksimal 2 orang per shop).
   - Setiap perubahan dicatat di `audit_logs`, ditambah satu catatan run (`brand_deal.bulk_import_run`).
5. **Export .xlsx** mengunduh Deal Brand aktif dalam format dua baris header yang sama persis dengan sheet sumber.
   File ini bisa diedit lalu di-import ulang.

Simpan **tidak menghapus** brand yang tidak ada di sheet. Hapus/ganti total hanya dilakukan lewat
langkah **Promote ke Produksi**, yang butuh persetujuan Yohan (D-2026-10-20-5). Brand yang masih
direferensikan data lain hanya dinonaktifkan (`deactivated_at`), tidak dihapus.

---

## 3. Arti kolom sheet

| Kolom sheet | Disimpan sebagai | Catatan |
|---|---|---|
| Status | `status` | Reguler / Running Bulan Pertama / Retention / Hold / Stop. Nilai "running" dibaca Running Bulan Pertama. Kolom kosong disimpan NULL dan dilaporkan. |
| Leads (kolom C) | tidak disimpan | Isinya tahap pipeline ("Deal"). Pipeline BizDev sudah dihapus. |
| Leads (kolom N) | `leads_type` | Pilihan di `app_config m8.leads_type_options`. |
| Niche | `niche` | Pilihan di `app_config m8.niche_options`. Usulan penggabungan niche hanya dilaporkan, tidak diterapkan otomatis. |
| Ads Brand | `ads_brand` (read-only) | Pengaturan ads yang berlaku ada di **Project BD**, per shop (`bd_project_shops.ads_support`). |
| Bizdev | BizDev penanggung jawab | Nama harus cocok dengan akun tim. Nama yang tidak dikenal dilaporkan dan tidak ditulis. |
| Campaign Ops | `campaign_ops_id` | "Non Campaign Ops" berarti kosong. |
| Countdown | tidak disimpan | Kolom rumus di sheet. |

---

## 4. Halaman Preview (`/deals/import/preview`)

- Halaman ini menunjukkan apa yang **akan terjadi di produksi kalau di-Promote**, yaitu isi environment ini
  (staging) dibandingkan dengan snapshot produksi (SELECT read-only):
  - Insert;
  - Update;
  - "Ada di produksi, tidak di sheet" (kandidat soft-deactivate).
- Daftar "perlu konfirmasi tim" diambil dari catatan run terakhir.
- Halaman ini tidak punya tombol untuk menulis data.

---

## 5. Edit satu Deal Brand & Ads Support per shop

- **Detail Deal Brand (`/deals/[id]`)**: tombol **Edit Status & Atribut** (izin `deals.edit`) untuk mengubah
  Status, Niche, Leads, Sample/Flash Sale/Ads, Campaign Ops, Prioritas, dan Working Sheet.
  - Pilihan Niche/Leads diambil dari `app_config`.
  - **+ Tambah niche baru** hanya tersedia untuk Management/BizDev Lead (`deals.niche_manage`).
    Niche baru langsung masuk daftar, dan penambahannya tercatat di audit.
  - Ejaan yang sudah ada (beda huruf besar/kecil saja) memakai niche yang sudah ada.
  - Ads Brand lama tampil read-only.
- **Detail Project BD (`/bd-projects/[id]`)**: kolom **Ads Support** per shop. Pilihan langsung tersimpan begitu diganti
  (izin `bd_project.manage`, tercatat di audit). Nilainya berlaku untuk shop itu **di project itu saja**.

## 6. Tabel Deal Brand (`/deals`)

- Tab **Brand** (bawaan): satu baris per brand, kolom sama dengan sheet. Cari nama brand / Shop ID,
  filter Platform/Bizdev/Status/Niche/Priority/Campaign Ops, menu **Kolom** untuk menyembunyikan kolom,
  10 brand per halaman. Klik nama brand untuk detail & **Edit Status & Atribut**.
- Tombol **Import / Export** membuka `/deals/import`; **+ Registrasi Brand** membuka form Registrasi Deal.
- Tab **Shop (Produk TAP)**: tabel ringkasan shop lama (Edit shop, BizDev handler, upload handler).

## 7. Yang belum ada / menyusul

- Langkah **Promote ke Produksi**: migrasi 0097/0098 di produksi dan replace data. Langkah ini menunggu persetujuan Yohan.
- Akun/role yang harus dibereskan tim tercatat di `docs/reports/mcn-todo-tim-21okt.md`.
