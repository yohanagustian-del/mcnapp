# Tutorial — Kreator Shopee di MCN MEA App

Untuk semua tim: Akuisisi, CM/CPM, BizDev, Campaign/External, Creator Support, Finance,
Management. Alamat aplikasi: **https://app.meamcn.com** — semua halaman di bawah ditulis
sebagai alamat lengkap supaya bisa langsung diklik/disalin.

Dokumen ini disusun dari kode dan `docs/BUILD_PLAN.md` per 29 Sep 2026.

---

## 0. Ringkasan cepat (baca ini dulu)

| Pertanyaan | Jawaban |
|---|---|
| Siapa yang boleh upload file Shopee? | Management (director/head/spv), CM Lead, CPM, Campaign External. **Akuisisi, BizDev, Finance TIDAK bisa** — minta CM. |
| Halaman upload | https://app.meamcn.com/ingest (kartu **Shopee**) |
| File apa? | **Satu** CSV Conversion Report Shopee (gabungan MCN + SAP) |
| Seberapa sering? | Mingguan, per window W1–W5 |
| Apa yang dihitung? | Hanya pesanan **Selesai**. GMV total, GMV live, GMV video, jumlah order, kategori L2 |
| Apa yang belum ada untuk Shopee? | Link Leakage, lead BD, Produk TAP & Creator Product Match (lihat §9) |

**Alur besar:**
`Akuisisi kreator → (Upload mingguan oleh CM) → profil & GMV kreator terisi otomatis → CM kelola → Report → Jadwal Live / Special Project / OKR`

---

## 1. Login & orientasi

1. Buka https://app.meamcn.com/login dan masuk dengan akun tim.
2. Menu sidebar **menyesuaikan role**. Menu yang tidak muncul = role Anda tidak punya akses
   (dijaga di server, bukan cuma disembunyikan).
3. Grup menu: Umum · Creator Management · BizDev & Deal · Project & Campaign · Akuisisi ·
   Data Platform · Management & Admin.
4. Halaman awal setiap orang: https://app.meamcn.com/dashboard

**Siapa melihat apa (ringkas):**

| Role | Menu utama yang relevan untuk kreator Shopee |
|---|---|
| Management (director/head/spv) | Semua, termasuk `/tim`, `/okr/director` |
| CM Lead / CPM | `/creators`, `/workspace/cm`, `/reports`, `/schedule`, `/ingest`, `/link-leakage`, `/workspace/acquisition/perpanjangan` |
| Acquisition Lead / Specialist | `/workspace/acquisition`, `/workspace/acquisition/perpanjangan`, `/creators` |
| BizDev / Campaign Ops | `/deals`, `/leads`, `/workspace/bizdev`, `/schedule`, `/link-leakage` |
| Campaign External | `/ingest`, `/link-leakage`, `/workspace/external` |
| Creator Support | `/schedule`, `/creators` (edit) |
| Finance | `/deals`, `/bd-projects`, `/projects` (dimensi pembayaran) |

---

## 2. TIM AKUISISI — mendaftarkan kreator Shopee

Ada 4 jalur. Yang membedakan kreator Shopee dari TikTok hanya satu: **kolom Platform = Shopee**.
Kreator Shopee dan TikTok disimpan **terpisah**, walau username-nya sama. Salah pilih platform
= data mingguan tidak menempel ke kreator yang benar.

### Jalur A — Form satu per satu
**https://app.meamcn.com/workspace/acquisition** → bagian **Daftarkan Creator Baru**

Wajib (bertanda merah):
- **Username** — tanpa @, contoh `winris12`. Harus sama persis dengan *Username Affiliate* di file Shopee.
- **CM (owner)** — pilih CM yang memegang kreator.
- **Join Date** dan **Akhir Kontrak**.

Opsional tapi sebaiknya diisi: Platform (**pilih Shopee**), Nama Creator (kosong = pakai username),
No HP (format 628xxx), Followers, Domisili, UID, Jenis Creator, Niche Top 3, Kualitas Konten,
Level (1–8), Sharing Komisi %, GMV Total rata-rata/bulan.

Klik **Daftarkan Creator**.

> Sharing komisi setelah terdaftar bersifat **read-only** (sinkron dari platform). Kalau turun,
> muncul alert — tidak bisa diedit manual.

### Jalur B — Import massal
**https://app.meamcn.com/creators** → panel import (Excel/CSV).
Kolom: `Username*`, `CM*`, Akuisitor, Nama Creator, Kategory, Kelas Kreator, **Platform**
(isi `shopee`), No HP, Link Akun. Nilai Platform selain `tiktok`/`shopee` diabaikan.
Baris kotor ditandai untuk review, tidak membuat proses gagal.

### Jalur C — Otomatis dari upload mingguan
Username di file Shopee yang belum ada dibuat sebagai **prospek** (platform Shopee, status
`prospek`, tanpa CM). Muncul di panel **Kreator tanpa CM** di https://app.meamcn.com/ingest —
Akuisisi memberi tahu CM Lead untuk assign.

### Jalur D — Form pendaftaran publik Special Project
`https://app.meamcn.com/join/{slug}` — kreator memilih TikTok atau Shopee sendiri. Slug diberikan
tim Special Project.

### Setelah kreator terdaftar
1. **Catat asal kreator** di https://app.meamcn.com/workspace/acquisition → *Catat Closing Binding*:
   Inbound (event/socmed/SEO), Outbound (outreach), atau Platform list (Shopee/TikTok).
2. **Referral**: *Catat Referral (Ajak Teman)* → Antar-creator (berkomisi) atau Program referral platform.
3. **GMV post-join** dihitung otomatis dari upload mingguan (jendela hari diatur di konfigurasi).
4. **Handoff ke CM**: di bagian *Closing & Handoff ke CM* klik **Tandai handoff** setelah CM siap memegang.
5. Kinerja per specialist: bagian *Kinerja per Specialist* di halaman yang sama.

### Perpanjangan kontrak
https://app.meamcn.com/workspace/acquisition/perpanjangan — countdown kontrak dan perpanjangan.
Akuisisi, CM, dan Management boleh memperpanjang (CM/CPM hanya untuk kreator di scope-nya).

---

## 3. TIM CM / CPM — halaman Upload Data Platform Mingguan (`/ingest`)

**https://app.meamcn.com/ingest** — satu-satunya pintu upload data platform. Judul halaman:
*Upload Data Platform Mingguan*. Urutan dari atas ke bawah:

1. **Tutorial TikTok Partner Center** (kotak biru, bisa dilipat) — khusus TikTok, abaikan untuk Shopee.
2. **Kreator tanpa CM** — kreator yang lahir dari upload dan belum punya CM.
   - CM Lead/Management: pilih CM lalu assign langsung.
   - CPM: centang lalu **Ajukan diri sebagai CM** (diputuskan CM Lead/Management, CPM tidak bisa assign diri sendiri).
3. **TikTok** — form upload 2 file (MCN wajib, TAP disarankan).
4. **Shopee** — kotak *Tutorial: Upload Conversion Report Shopee* (bisa dilipat) dan form upload 1 file (bagian §3.1 di bawah).
5. **Kalender Cakupan Minggu (W1–W5)** — 3 bulan terakhir.
6. **Riwayat Batch** — 10 baris per halaman, ada paginasi.

Jika role Anda tidak punya izin, form diganti tulisan *"Role Anda tidak memiliki izin upload ingest."*

### 3.1 Mengunggah file Shopee — langkah demi langkah

**Langkah 1 — Ambil file.**
Siapkan **Conversion Report** dari Shopee Affiliate (akun MCN/SAP): satu CSV gabungan MCN + SAP.
Filter tanggal export **sesuai satu window saja** (lihat tabel di bawah).

| Window | Tanggal |
|---|---|
| W1 | 1–7 |
| W2 | 8–14 |
| W3 | 15–21 |
| W4 | 22–28 |
| W5 | 29–akhir bulan |

Yang dipakai untuk menentukan window adalah kolom **Waktu Pesanan Dibuat** (tanggal order) — sama dengan filter tanggal export di Shopee Affiliate. Pesanan yang dibuat 1–7 lalu baru Selesai tanggal 13 tetap masuk W1. Pesanan yang saat export masih *Sedang Diproses* belum dihitung; upload ulang window yang sama nanti untuk melengkapinya (hasil lama ditimpa).

**Langkah 2 — Cek kolom di CSV** (nama kolom Indonesia, BOM boleh):

| Kolom | Wajib | Dipakai untuk |
|---|---|---|
| Status Pesanan | Ya | Hanya nilai `Selesai` yang dihitung |
| Waktu Pesanan Dibuat | Ya | Menentukan window W1–W5 |
| Username Affiliate | Ya | Mencocokkan ke kreator Shopee |
| Total Pembelian yang Dibuat(Rp) | Ya | GMV |
| ID Produk, ID Toko | Ya utk baris Selesai | Baris tanpa ini dilewati |
| Nama Affiliate, Nama Produk, Nama Toko | Tidak | Informasi |
| Kategori L1, Kategori L2 | Tidak | Kategori GMV & niche kreator |
| Platform | Tidak | `Shopeelive…` → GMV live, `Shopeevideo…` → GMV video, lainnya (mis. WhatsApp) hanya masuk total |

Kolom *Campaign Type* dan *Partner Promo* sengaja diabaikan.

**Langkah 3 — Upload.**
1. Buka https://app.meamcn.com/ingest, turun ke bagian **Shopee**.
2. Klik pilih file → pilih CSV apa adanya (hingga ±200 MB). CSV dikompres otomatis di browser (±3x lebih kecil) sebelum diunggah, jadi **tidak perlu di-ZIP**. File .zip berisi tepat satu CSV juga diterima, tapi tidak lebih cepat: ukurannya kurang lebih sama dengan hasil kompresi otomatis.
3. Klik **Proses Upload Mingguan**. Tombol berganti: *Mengunggah file ke storage…* lalu *Memproses agregat di server…*. Jangan tutup tab.

**Langkah 4 — Baca hasil (kotak hijau):**
- `Batch … selesai — periode {awal} s/d {akhir}`
- jumlah baris Selesai dari total, baris dipakai, jumlah creator
- **GMV total periode**
- *Creator baru dibuat otomatis* (daftar prospek Shopee baru)
- *N baris dilewati / catatan* — klik untuk lihat alasan per baris (maks 50 ditampilkan)

**Langkah 5 — Tindak lanjut:**
- Ada kreator baru → cek panel **Kreator tanpa CM**, assign/ajukan CM.
- Cek **Kalender** — sel window itu harus hijau.
- Cek https://app.meamcn.com/creators — GMV kreator sudah terbarui.

### 3.2 Aturan yang perlu dihafal

1. Pesanan selain **Selesai** (Pembatalan, Sedang Diproses, dll.) tidak dihitung.
2. Semua baris Selesai harus berada di **satu window**. Lintas window atau lintas bulan = **ditolak seluruhnya**. Ini disengaja.
3. **Upload ulang window yang sama menimpa hasil lama** (idempotent) — aman dipakai untuk koreksi.
4. Username dicocokkan **hanya ke kreator platform Shopee**. Tidak pernah nyambung ke kreator TikTok.
5. Data mentah **tidak disimpan**. Yang tersimpan: agregat GMV mingguan per kreator, GMV per kategori, dan bukti upload (jumlah baris, hash file, periode).
6. Rata-rata GMV bulanan, status, platform, jenis creator, dan niche kreator diisi **otomatis** dari agregat.
7. Kalau satu window terlewat, bisa diupload belakangan — tidak harus berurutan.

### 3.3 Kalender & Riwayat Batch

- **Kalender**: hijau = Selesai · kuning = Diproses · merah = Gagal · abu = belum ada · abu pudar = window tidak ada (mis. Februari W5 di tahun bukan kabisat). Jika satu window punya beberapa batch, status "terbaik" yang ditampilkan (Selesai > Gagal > Diproses).
- **Riwayat Batch**: ID batch (format `ingest-shopee:{tanggal-awal}:{hash}`), waktu upload, jumlah baris, jumlah kreator, periode, status, dan pesan error bila gagal.

### 3.4 Troubleshooting upload

| Pesan / gejala | Penyebab | Solusi |
|---|---|---|
| *File Shopee kosong atau tidak terbaca…* | File kosong/rusak/bukan Conversion Report | Export ulang dari Shopee |
| *File … terlalu besar (… MB setelah dikompres; maksimum 200 MB)* / *terlalu besar setelah diekstrak (maksimum 400 MB)* | Export sangat besar (di atas ±400 MB CSV) | Export dengan rentang tanggal lebih pendek, upload terpisah (window berbeda) |
| *File ZIP … berisi N file data* / *tidak berisi file .csv/.xlsx* | ZIP berisi lebih dari satu file atau kosong | Satu ZIP = satu CSV, atau upload CSV-nya langsung (tidak perlu ZIP) |
| *Tidak ada baris berstatus Selesai pada file ini.* | Semua pesanan belum Selesai atau salah rentang | Ganti rentang tanggal export |
| Ditolak: baris menyentuh lebih dari satu window | Tanggal pesanan dibuat di export melintasi W1–W5 | Export ulang per window, atau pecah filenya |
| Banyak baris "ID Produk / ID Toko kosong" | Baris Selesai tanpa ID | Cek export; baris itu tidak masuk GMV |
| "Username Affiliate kosong" | Kolom kosong | Cek export |
| "Waktu Pesanan Dibuat tidak terbaca" | Format tanggal bukan `YYYY-MM-DD HH:MM:SS` | Jangan buka & simpan ulang di Excel yang mengubah format |
| Tombol tidak bisa diklik / izin ditolak | Role tanpa `ingest.run` | Minta CM/Management yang upload |
| GMV kreator tak berubah | Kreator dibuat platform TikTok padahal Shopee | Cek kolom Platform di `/creators/{id}`; bila salah, edit lewat tombol edit kreator (Management/CM/Akuisisi/Creator Support) |

---

## 4. TIM CM / CPM — mengelola kreator Shopee

### 4.1 Roster & profil kreator
- Daftar: https://app.meamcn.com/creators — semua role bisa melihat; edit untuk Management, CM, Akuisisi, Creator Support; hapus hanya Management.
- Profil: `https://app.meamcn.com/creators/{id}` — grafik *Pertumbuhan GMV Mingguan*, matriks kategori × segmen harga, dan rekomendasi produk (rekomendasi produk hanya untuk data TikTok, lihat §9).
- GMV di roster = **rata-rata bulanan**, dihitung otomatis dari upload mingguan. Bukan total satu batch.

### 4.2 CM Workspace
https://app.meamcn.com/workspace/cm — isi halaman: jadwal live hari ini & besok, pertumbuhan GMV mingguan,
creator & growth (alert penurunan performa, hilang sendiri saat pulih), produk cocok per kreator,
link leakage per minggu, komplain kreator, campaign dari BizDev yang perlu konfirmasi,
**Req Creator** (sample / ads / HSL — ads di atas plafon kreator butuh approval Director),
shop potensial → BizDev, report kreator terbaru, deal hasil CM (tanpa BizDev), dan
**kontrak tertulis TC/Celebrity (e-sign)**.

Catatan Shopee: bagian *produk cocok* dan *link leakage* akan kosong untuk kreator Shopee (§9).

### 4.3 Report Kreator (M2)
https://app.meamcn.com/reports — Management dan CM bisa membuat (generate); finalisasi oleh Head, SPV, CM.
- Angka dan semua kalimat report dihasilkan **rule-based, tanpa AI** (token 0). Tim hanya boleh menyunting **teks**, angka tidak bisa diubah.
- Report berstatus draft → final; kreator melihat versi **Final** di portalnya.
- **[Verifikasi]** Sumber angka report adalah agregat mingguan; bagian yang butuh data produk/segmen harga kemungkinan kosong untuk kreator Shopee. Cek satu report Shopee nyata sebelum dibagikan ke kreator.

### 4.4 Jadwal Live
https://app.meamcn.com/schedule — CM dan BizDev mengisi slot; Creator Support memverifikasi di luar jam kerja CM.
Slot bisa dikaitkan ke shop ("Link ke deal"). Data & report live per slot bersifat opsional
(upload dua file `.xlsx` per sesi dari TikTok LIVE Center) — panduan lengkap:
`docs/TUTORIAL_JADWAL_LIVE_REPORT.md`. Format file live itu format TikTok.

### 4.5 Kapasitas Kreator (PX)
https://app.meamcn.com/px/capability — slot kapasitas kreator per kategori & segmen harga; CM/CPM mengisi, BizDev membaca.

### 4.6 Link Leakage
https://app.meamcn.com/link-leakage — untuk Shopee **belum dihitung** (§9).

---

## 5. TIM BIZDEV & CAMPAIGN OPS

Semua fitur BizDev di aplikasi saat ini berbasis data **TikTok**. Yang relevan untuk kreator Shopee:

| Halaman | Kegunaan | Catatan Shopee |
|---|---|---|
| https://app.meamcn.com/deals | Daftar Deal Brand per shop | Deal tetap dicatat; tidak tersambung otomatis ke GMV Shopee |
| https://app.meamcn.com/deals/baru | Registrasi Deal lewat form tervalidasi | Wajib lewat form, bukan free-text sheet |
| https://app.meamcn.com/bd-projects | Project BD: beberapa shop = satu campaign; Ads Budget & Service Fee per (project, shop) | — |
| https://app.meamcn.com/leads | Brand Lead Bank (lead brand berkontak) | — |
| https://app.meamcn.com/workspace/bizdev | Tracker request semua CM, pipeline deal, brand report | Brand report memakai data transaksi TikTok |
| https://app.meamcn.com/matching · /products · /predictor | Creator Product Match, Produk TAP, BD Value Predictor | **TikTok saja** |
| https://app.meamcn.com/schedule | Isi slot live untuk kreator (termasuk Shopee) | Jalan |

Master deal Shopee **belum disinkron** ke sistem; menunggu artifak Agency Leaked Generator versi Shopee.

---

## 6. TIM CAMPAIGN EXTERNAL

- https://app.meamcn.com/workspace/external — log approach, keberhasilan, dan GMV; membaca status link agency.
- Boleh upload data di https://app.meamcn.com/ingest (izin sama seperti CM).

---

## 7. MANAGEMENT, FINANCE, DAN OKR

- **Tim**: https://app.meamcn.com/tim — tambah/nonaktifkan anggota (akun dinonaktifkan, tidak dihapus, supaya riwayat tetap ada).
- **OKR & Kinerja**: https://app.meamcn.com/okr — semua anggota melihat KR sendiri; Management lihat lintas tim. Director mengatur target & reward di https://app.meamcn.com/okr/director.
- **Retensi data**: https://app.meamcn.com/admin/retention
- **Special Project**: https://app.meamcn.com/projects — sesi live, report, portal peserta. Finance melihat dimensi pembayaran.
- **OD Oversight**: https://app.meamcn.com/od (read-only).
- **Finance**: https://app.meamcn.com/deals dan https://app.meamcn.com/bd-projects (status payment: done / proses finance payment / proses finance brand).
- **Audit**: setiap mutasi penting (upload, assign, ubah kreator, approval) tertulis di `audit_logs`.

---

## 8. PORTAL KREATOR (untuk kreator, dibantu CM/CPM)

Alamat: https://app.meamcn.com/portal

**Cara kreator masuk:**
1. CPM mengirim **link aktivasi** ke kreator: `https://app.meamcn.com/aktivasi?token=…`
2. Kreator membuat password di halaman itu (link sekali pakai). Jika *"Link aktivasi tidak valid"* → minta CPM kirim link baru.
3. Berikutnya login lewat https://app.meamcn.com/login

**Menu portal:**
| Halaman | Isi |
|---|---|
| https://app.meamcn.com/portal | Beranda kreator |
| https://app.meamcn.com/portal/reports | Report pertumbuhan akun & insight; report Final dari CPM |
| https://app.meamcn.com/portal/requests | Ajukan request (sample/ads/HSL) dan lihat statusnya |
| https://app.meamcn.com/portal/complaints | Ajukan komplain, kirim feedback, lihat komplain saya |
| https://app.meamcn.com/portal/agency-plan | Extra komisi dari agency plan |
| https://app.meamcn.com/portal/produk | Rekomendasi produk (basis TikTok) |
| https://app.meamcn.com/portal/projects | Special Project yang diikuti |

Kreator hanya melihat data miliknya sendiri (dijaga di database, bukan cuma tampilan).

---

## 9. Yang BELUM tersedia untuk kreator Shopee

| Hal | Status | Alasan / rencana |
|---|---|---|
| Link Leakage & lead BD Shopee | Belum dihitung | Menunggu artifak *Agency Leaked Generator* versi Shopee (dibuat oleh Yohan). Aturan bisnisnya sudah dicatat di `HANDOFF.md` |
| Master deal Shopee → `cooperating_shops` | Belum sinkron | Menyusul |
| Creator Product Match, Produk TAP, rekomendasi produk | TikTok saja | Conversion Report Shopee tak punya harga/qty per item, jadi segmen harga tidak bisa dihitung aman |
| Top produk per kreator Shopee | Belum ada | Alasan sama |
| Upload harian product/Shopee untuk Special Project (Fase 1B) | Belum dibangun | Menunggu sampel file |
| Penandatanganan e-sign via provider | Alur status jalan, API provider belum | Provider (Privy/Mekari Sign) belum dipilih |

---

## 10. Checklist mingguan

**CM/CPM (tiap awal minggu, setelah window sebelumnya lengkap)**
- [ ] Export Conversion Report Shopee untuk window yang baru selesai (satu window saja)
- [ ] Upload di https://app.meamcn.com/ingest → kartu Shopee
- [ ] Kotak hijau muncul; catat GMV total
- [ ] Sel window di Kalender hijau
- [ ] Assign/ajukan CM untuk kreator baru di panel *Kreator tanpa CM*
- [ ] Cek alert penurunan performa di https://app.meamcn.com/workspace/cm

**Akuisisi**
- [ ] Kreator baru didaftarkan dengan Platform = Shopee
- [ ] Closing binding & referral dicatat
- [ ] Handoff ke CM ditandai
- [ ] Cek https://app.meamcn.com/workspace/acquisition/perpanjangan untuk kontrak yang mau habis

**Management**
- [ ] Kalender W1–W5 tidak ada sel merah/kosong
- [ ] Review OKR di https://app.meamcn.com/okr

---

## 11. Glosarium

- **Window (W1–W5)**: pembagian bulan menjadi 7 hari-an; W5 = tanggal 29 sampai akhir bulan.
- **Batch**: satu kali upload; ID-nya tercatat di Riwayat Batch.
- **Idempotent**: upload ulang window yang sama menimpa, tidak menggandakan.
- **Prospek**: kreator yang dibuat otomatis dari upload, belum punya CM.
- **MCN / SAP**: dua sumber dalam satu Conversion Report Shopee.
- **TAP**: program TikTok (produk deal); tidak berlaku untuk Shopee.
- **Read-only**: sharing komisi & status link tidak bisa diedit manual siapa pun.
