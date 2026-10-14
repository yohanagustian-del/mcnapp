# Tutorial Pengguna — Revisi BizDev (Oktober 2026)

Berlaku untuk perubahan di PR #105–#118 (plan `docs/plans/REVISI_BIZDEV_2026-10.md`).
Semua fitur baru **0 LLM**: angka dari SQL, kalimat dari aturan tetap, `token_used` selalu 0.

---

## 0. Yang wajib dilakukan dulu (sekali saja)

**Upload ulang file mingguan September W1–W5 di `/ingest`, berurutan (W1 → W5).**
Data per toko (shop) baru tersimpan untuk upload SETELAH rilis ini. Sebelum diupload ulang:
- Summary per BizDev, TAP Matchmaking, dan Report Brand menampilkan *"Data periode ini belum diupload dengan versi baru"*.
- Angka **"Nama kreator tidak ada"** (lihat §4) baru terisi setelah upload ulang.
- Segmen harga Shopee juga baru terisi setelah upload ulang.

Upload ulang aman (idempotent per kreator × minggu), tidak membuat data dobel.
Untuk minggu/bulan berikutnya cukup upload mingguan seperti biasa.

---

## 1. Ringkasan perubahan

| # | Perubahan | Siapa yang terdampak |
|---|---|---|
| 1 | Sidebar dirapikan (menu pindah grup / muncul untuk role yang berhak) | Semua staff |
| 2 | Label "Request Creator Brand Deals", section Pipeline dihapus | BizDev |
| 3 | Bug "segmentasi harga semuanya 0" diperbaiki | CM, BizDev, Management |
| 4 | **BizDev penanggung jawab brand** (maks 2) + upload Excel + "Non BD Handle" | BizDev, BD Admin, Management |
| 5 | **Summary per BizDev** di atas BizDev Workspace + pemilih periode | BizDev, Management |
| 6 | **TAP Matchmaking** (menu baru) | BizDev, Management |
| 7 | **Brand Lead Bank → Registrasi Deal** satu klik | BizDev |
| 8 | **Report Brand v2** (menu baru, otomatis, tanpa upload file) | BizDev, Management |
| 9 | Segmen harga Product Match dijelaskan (catatan AOV) | CM, kreator |

---

## 2. Perubahan menu & akses (PR #106)

| Menu | Sekarang | Siapa melihat |
|---|---|---|
| Creator Product Match `/matching` | Pindah ke grup **Creator Management** | Management + CM (CM Lead, CPM). BizDev tidak lagi melihat menu ini (dulu tampil tapi ditolak) |
| Special Project (M7) | Tampil untuk semua staff yang punya hak M7 | Semua role kecuali `od_viewer` |
| Upload Data Platform Mingguan `/ingest` | Tampil untuk Campaign Ops | Management, CM, Campaign Ops, Campaign External |
| Dasbor | Teks "Status Fase 0" diganti **pintasan ke workspace** sesuai role | Semua |
| Label role | `ads_support` dan `od_viewer` tampil sebagai nama, bukan kode | Semua |

**BizDev Workspace:**
- Judul "Routing Req Campaign → CM Pemilik Creator" → **"Request Creator Brand Deals"**.
- Section **Pipeline Deal Brand dihapus** (data lama tidak hilang, hanya tidak ditampilkan).
- Section "Report Brand Deals" diganti tautan ke menu **Report Brand** (§8).

---

## 3. Bug segmentasi harga = 0 (PR #107)

**Apa yang salah:** laporan Shopee tidak membaca kolom `Qty` dan `Harga(Rp)`, dan baris Shopee salah tersimpan sebagai TikTok.
**Sekarang:**
- Shopee: segmen dari `Harga(Rp)`, cadangan GMV ÷ Qty.
- TikTok: baris `items_sold = 0` tapi `orders > 0` memakai GMV ÷ order.
- Matriks **Kategori × Segmen** di `/creators/[id]` menampilkan *"Segmen harga belum tersedia untuk batch ini (upload ulang file periode ini)"* bila batch lama belum bersegmen, bukan tabel penuh nol.

**Tindakan:** upload ulang file periode yang ingin dilihat segmennya (§0).

---

## 4. BizDev penanggung jawab brand (PR #110)

Satu brand (shop) bisa dihandle **maksimal 2 BizDev**. Brand tanpa BizDev tampil sebagai **"Non BD Handle"**.
Izin mengubah: `deals.edit` (Management, BizDev Lead, BizDev, Campaign Ops, BD Admin, Finance).

### Cara A — per brand (koreksi harian)
1. Buka **Deal Brand** (`/deals`) → tab **Deal Brand** (tabel "Shop").
2. Kolom **BizDev** menampilkan nama handler, atau badge abu **"Non BD Handle"**.
3. Klik tombol **BizDev** di baris brand → pilih 1–2 BizDev → simpan.

### Cara B — massal lewat Excel (pengisian awal)
1. Di tab Deal Brand, buka panel **Upload BizDev Handler (Excel)**.
2. Klik unduh template. Kolom: `Shop ID | Shop Name | BizDev 1 | BizDev 2`.
3. Isi, upload.
- Shop dicocokkan lewat **Shop ID** dulu, lalu Shop Name.
- Shop atau nama BizDev yang tidak dikenal **dilewati** dan muncul sebagai peringatan.
- Kedua sel BizDev kosong = baris **tidak mengubah apa-apa** (bukan mengosongkan).
- Isi file = keadaan akhir: BizDev yang tidak ada di baris itu akan dilepas.

### Cara C — saat Registrasi Deal
Di form `/deals/baru` ada pertanyaan **opsional** "BizDev handler 1/2". Pertanyaan ini **tidak menimpa** brand yang sudah punya handler.

Semua perubahan tercatat di audit log. Detail deal juga menampilkan badge BizDev.

---

## 5. Summary per BizDev (PR #111, #117, #118)

Lokasi: **BizDev Workspace** → section paling atas **"Summary per BizDev"**.

**Isi:**
- Kartu per BizDev: brand dihandle, GMV MCN, GMV TAP, Actual Revenue Partner, % TAP/MCN.
- Kartu **Non BD Handle** selalu paling akhir.
- Tabel breakdown BizDev × brand (jumlah kreator, periode) — bisa sort, cari, paginasi.

**Pemilih periode:** default **bulan berjalan**. Bisa pilih bulan lain atau minggu **W1–W5**.

**Hal yang perlu dipahami:**
- Brand dengan 2 BizDev dihitung **penuh di keduanya** (tertulis di UI), jadi jangan menjumlah antar-BizDev.
- **Semua toko ikut** (bukan hanya yang punya deal). Toko tanpa deal/kartu masuk "Non BD Handle".
- Toko dengan beberapa ejaan Shop Name bisa tampil **dobel** — disengaja.
- GMV TAP **Shopee** tampil *"GMV TAP belum tersedia untuk Shopee"*, bukan 0.
- Baris **"Nama kreator tidak ada"** = GMV TAP yang tidak bisa dikaitkan ke kreator di file MCN. Terhitung di GMV TAP toko, **tidak** di jumlah kreator.

**Siapa melihat apa (PR #117):**

| Role | Yang terlihat |
|---|---|
| Management, BizDev Lead (izin `m8.bizdev_summary_all`) | Summary semua BizDev + Non BD Handle |
| BizDev, Campaign Ops, BD Admin | **Hanya brand yang mereka handle sendiri** (difilter di server) |

---

## 6. TAP Matchmaking (PR #112, #116)

Menu baru: **TAP Matchmaking** di grup *BizDev & Deal* (`/tap-matchmaking`).
Akses: Management + BizDev, BizDev Lead, Campaign Ops, BD Admin. Halaman **baca saja**, tidak mengubah data.

**Tujuan:** untuk satu toko/brand, lihat kreator mana yang sudah pakai TAP, mana yang belum, dan seberapa besar potensinya.

**Cara pakai:**
1. Isi **Shop ID** (persis) atau **nama toko** (cari per kata, mis. "Skintific").
2. Pilih **platform** dan **periode** (bulan atau minggu).
3. Jika lebih dari satu toko cocok, pilih dulu tokonya.
4. Baca hasilnya:
   - **Header:** Total Creator (pakai TAP) · Total GMV TAP · GMV MCN kreator pemakai TAP · GMV semua kreator.
   - **Tabel kiri — kreator pakai TAP:** GMV TAP, GMV MCN, **GAP**, CM, Live %/Video %.
   - **Tabel kanan — semua kreator:** username, GMV, status, CM (tanpa CM tampil "—"). Ada kolom cari kreator/CM.
5. Klik tombol ekspor untuk **CSV**.

**Cara memakainya untuk BD:** kreator di tabel kanan yang ber-GMV besar tapi belum ada di tabel kiri = prospek untuk diminta memakai TAP; CM-nya tertera untuk koordinasi.

**Catatan:**
- Live %/Video % dihitung dari **GMV MCN** untuk semua kreator (PR #116), supaya seragam.
- Shopee: GMV TAP "belum tersedia" (bukan 0).

---

## 7. Brand Lead Bank → Registrasi Deal (PR #113)

Akses: izin `deals.register` (Management, BizDev Lead, BizDev).

**Cara pakai:**
1. Buka **Brand Lead Bank** → klik lead.
2. Di `/leads/[id]` klik **"Daftarkan jadi Deal Brand"** (tombol hilang bila lead sudah jadi deal).
3. Form Registrasi Deal terbuka **sudah terisi**: Shop Name, Platform (bila lead punya tepat satu platform), Deal by (akun Anda bila BizDev), BizDev handler (bila nama cocok persis), kontak PIC, link toko.
4. Lengkapi sisanya, simpan.
5. Lead otomatis ditandai **deal**.

**Dua jalur simpan** (tetap ditentukan dari isian, seperti biasa):
- Hanya shop → **Deal Brand**; kontak PIC dan link toko ikut tersimpan di deal.
- Ada produk → **Kartu Produk TAP**; status lead jadi deal.

Form baru punya pertanyaan **Platform** (default TikTok Shop). Tidak ada field wajib baru. Bila langkah tandai-lead terkendala, registrasi tetap sukses dengan catatan.

---

## 8. Report Brand v2 (PR #114)

Menu baru: **Report Brand** (`/brand-reports`), grup *BizDev & Deal*.
Akses: Management, BizDev Lead, BizDev.

**Membuat report:**
1. Cari Shop ID / nama toko, pilih **platform** dan **periode**.
2. (Opsional) isi **Ads spend brand**.
3. Klik **Generate Report**. Tidak ada upload file.
- Hanya toko yang punya kartu/deal terdaftar yang bisa dibuatkan report.

**Isi report (tab):** Ringkasan · Kreator · Live vs Video · Produk TAP · Rekomendasi upgrade.
- Angka: GMV MCN, GMV TAP, %TAP, live/video, order, jumlah kreator, top kreator (nama + CM), kreator ber-GMV yang belum pakai TAP, actual revenue partner, tren mingguan dan WoW.
- **ROAS dan saran upgrade hanya muncul bila ads spend diisi.**
- GMV TAP kosong tampil *"belum tersedia"*, bukan 0.

**Menyunting & finalisasi:**
- Anda boleh menyunting **teks** (ringkasan, rekomendasi). **Angka tidak bisa disunting.**
- Status **Draft** → klik finalkan → **Final**; setelah final, teks terkunci.
- Setiap generate, sunting, finalisasi tercatat di audit log.

**Report lama (v1):** tetap ada di daftar, bisa dibuka **read-only**. Jalur lama (upload file + ringkasan LLM) sudah dihapus.

---

## 9. Catatan segmen harga Product Match (PR #116)

Di Creator Product Match (`/matching`, `/creators/[id]`, CM Workspace, portal kreator) kini ada satu baris catatan: **segmen harga dihitung dari AOV (GMV ÷ order) per kategori Level 2**, bukan dari segmen per transaksi. Ini agar rekomendasi tidak disalahartikan.

---

## 10. Ringkasan akses

| Fitur | Management | BizDev Lead | BizDev | Campaign Ops / BD Admin | CM Lead / CPM |
|---|---|---|---|---|---|
| Summary BizDev — semua | ✔ | ✔ | — | — | — |
| Summary BizDev — brand sendiri | ✔ | ✔ | ✔ | ✔ | — |
| Edit BizDev handler / upload Excel | ✔ | ✔ | ✔ | ✔ | — |
| TAP Matchmaking | ✔ | ✔ | ✔ | ✔ | — |
| Report Brand | ✔ | ✔ | ✔ | — | — |
| Lead → Registrasi Deal | ✔ | ✔ | ✔ | — | lihat lead saja |
| Creator Product Match | ✔ | — | — | — | ✔ |

---

## 11. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| "Data periode ini belum diupload dengan versi baru" | Batch dibuat sebelum rilis | Upload ulang file periode itu di `/ingest` |
| "GMV TAP belum tersedia" | Shopee (fase 1) atau file TAP tidak diupload | Normal untuk Shopee; untuk TikTok upload file TAP |
| Toko tidak bisa dibuatkan Report Brand | Belum punya kartu/deal terdaftar | Daftarkan dulu lewat Registrasi Deal |
| Brand tampil "Non BD Handle" | Belum ada handler | Isi lewat tombol BizDev atau upload Excel |
| GMV toko tampil dobel | Ejaan Shop Name berbeda | Disengaja; rapikan ejaan bila ingin satu baris |
| Menu Creator Product Match hilang untuk BizDev | Dipindah ke Creator Management (Management + CM) | Minta CM menjalankannya |
| BizDev tidak melihat BizDev lain di summary | Aturan scope (K11) | Hubungi BizDev Lead / Management |
