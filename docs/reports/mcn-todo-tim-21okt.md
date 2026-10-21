# TODO Tim — 21 Oktober 2026 (Bulk Load Deal Brand + Campaign Ops)

Dibuat dari dry-run `docs/reports/bulkload-dryrun-2026-10-20.md` (produksi dibaca read-only).
Sesuai arahan Yohan 20 Okt 22:17: item akun/nama yang belum cocok **tidak memblok** pekerjaan;
import tetap jalan, dan item di bawah dikerjakan tim besok. Tidak ada akun produksi yang diubah.

## A. Akun & role (Admin / Management — menu Tim)

| # | Nama di brief/sheet | Kondisi di produksi | Yang perlu dikerjakan |
|---|---|---|---|
| A1 | **Lala** | Tidak ada anggota bernama/mirip "Lala" di `team_members` | Kirim email & nama lengkap Lala → buat akun (role `campaign_ops`) lewat menu Tim |
| A2 | **ZamZam** | Akun `zamzam` ada tapi role **`cpm`** dan **nonaktif** | Yohan 21 Okt: **biarkan dulu** (A1 juga) |
| A3 | **Diena** | `Diena Shofwah` SUDAH `campaign_ops`, aktif | Tidak perlu ubah role. Tapi di sheet ditulis "Diena" → lihat B2 |
| — | SQL siap pakai | `scripts/sql/campaign-ops-roles.sql` (dibungkus `rollback`) | Jalankan HANYA setelah Yohan setuju; isi email Lala dulu |

## B. Nama di sheet yang tidak cocok persis dengan akun

Sistem hanya mencocokkan nama PERSIS (tidak menebak). Pilih salah satu: ubah ejaan di sheet
sama dengan nama akun, ATAU konfirmasi pemetaannya ke Yohan supaya dipasang manual.

| # | Kolom | Nama di sheet | Kandidat akun | Dampak sekarang |
|---|---|---|---|---|
| B1 | Bizdev | **Fanny** (33 brand) | `Fanny Putri Fernanda` (bizdev) | ✅ Dikonfirmasi Yohan 21 Okt — dipetakan otomatis (D-2026-10-21-1) |
| B2 | Campaign Ops | **Diena** (1 brand) | `Diena Shofwah` (campaign_ops) | ✅ Dikonfirmasi Yohan 21 Okt — dipetakan otomatis (D-2026-10-21-1) |

## C. Data sheet yang perlu dicek tim

| # | Item | Detail |
|---|---|---|
| C1 | Duplikat persis (di-skip) | Baseus official store (baris 70/71), Bintang Toedjoe Store (85/86, Bizdev & niche beda), DiliDili.Shop (168/169), Footage (235/236), For Skin's Sake (237/238) — pilih satu baris yang benar |
| C2 | Tanpa Shop ID (di-skip) | BIC MALL - BOYA Indonesia OS (96), Brand Testing (97), Cooger HomeLiving Mall - COOGER Electric (134) |
| C3 | Tanpa nama brand (di-skip) | Baris 809, Shop ID 7494931568031533225 |
| C4 | Status kosong | MIORIO, USMILE, Vibrant Glamour (Brand Testing ikut di-skip karena tanpa Shop ID) |
| C5 | Ads Brand lama di luar daftar | Anessa (39), H&H Skincare (286), Le Ding Ding (406), Maybelline (446), MOELL (476), Purbasari (598) |
| C6 | Ads Brand perlu dipasang ke Project BD | 191 brand belum punya Project BD — daftar lengkap di dry-run bagian 3b |
| C7 | Shop bersama dengan >2 BizDev | Sidomuncul Tolak Angin / tokosekarwangi (shop 7495209408569313450) — handler shop tidak ditulis |
| C8 | Exp Date ambigu | nusantarahelm (535) "3/1/2027" dibaca 3 Jan 2027 — 1 Maret? |
| C9 | GMV TAP tidak terbaca | Advance DIgitals Store (13) "couldn't found" → disimpan kosong |
| C10 | Niche | Usulan gabung: Personal care → Beauty & Personal Care, Mom & baby → Baby & Maternity, Fashion & Lifestyle → kategori TikTok. Tanpa niche: Amarome.Naturals, Cottonela.idn |
| C11 | Brand produksi yang tidak ada di sheet | 22 baris (dry-run bagian 7), termasuk nama yang ejaannya berubah (mis. "MLEN DIARY" vs "MlenDiaryID", "NONIMAGIC OFFICIAL STORE" vs "Noni Magic") — konfirmasi apakah brand yang sama sebelum Promote |

## D. Menunggu persetujuan Yohan (bukan pekerjaan tim)
1. Apply migrasi 0097 ke produksi.
2. Promote ke Produksi (replace `brand_deals` + soft-deactivate baris C11).
3. Apply migrasi 0098 setelah data bersih.
4. Jalankan `scripts/sql/campaign-ops-roles.sql`.
