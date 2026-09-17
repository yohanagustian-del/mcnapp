# Tutorial Special Project — Tim MCN MEA

Panduan operasional dari nol: membuat project, merekrut kreator, mengundang kreator ke
Creator Portal, mengunggah data sesi live, sampai report jadi dan project ditutup.

Alamat aplikasi: **https://app.meamcn.com**

---

## Daftar isi

- [Siapa boleh melakukan apa](#siapa-boleh-melakukan-apa)
- [Peta alur](#peta-alur)
- **Bagian A — Menyiapkan project**
  - [1. Buat project](#1-buat-project)
  - [2. Aktifkan project](#2-aktifkan-project)
  - [3. Assign man power](#3-assign-man-power)
- **Bagian B — Merekrut kreator**
  - [4. Tetapkan kriteria & cari kandidat](#4-tetapkan-kriteria--cari-kandidat)
  - [5. Tiga cara menambah peserta](#5-tiga-cara-menambah-peserta)
  - [6. Memutuskan pendaftar](#6-memutuskan-pendaftar)
- **Bagian C — Creator Portal**
  - [7. Undang peserta ke Creator Portal](#7-undang-peserta-ke-creator-portal)
  - [8. Onboarding massal kreator lama yang belum pernah login](#8-onboarding-massal-kreator-lama-yang-belum-pernah-login)
  - [9. Terbitkan Info Acara](#9-terbitkan-info-acara)
- **Bagian D — Performa & report**
  - [10. Upload data sesi live](#10-upload-data-sesi-live)
  - [11. Generate report peserta](#11-generate-report-peserta)
  - [12. Finalkan report](#12-finalkan-report)
  - [13. Tutup project & report gabungan](#13-tutup-project--report-gabungan)
- [Penanganan masalah](#penanganan-masalah)
- [Checklist cepat](#checklist-cepat)

---

## Siapa boleh melakukan apa

| Pekerjaan | Role yang bisa |
|---|---|
| Buat/ubah project, kelola peserta & man power, ubah status project | Director, Head, SPV, CM Lead, BizDev Lead, Acquisition Lead, Campaign Ops |
| Upload data sesi live | Semua di atas + Finance |
| Terima/tolak pendaftar (internal & eksternal) | Director, Head, SPV, CM Lead, BizDev Lead, Acquisition Lead, Campaign Ops |
| Undang kreator ke Creator Portal | Director, Head, SPV, CM Lead, **CPM**, BizDev Lead, BizDev, Campaign Ops, Acquisition Lead, Acquisition Spec |
| Buka kembali project yang sudah ditutup | Director, Head |

Kalau sebuah tombol tidak muncul di layarmu, artinya role akunmu memang tidak punya hak itu —
minta ke rekan yang punya, jangan cari jalan lain.

---

## Peta alur

```
Buat project → Aktifkan → Assign man power
      ↓
Tetapkan kriteria kreator → Cari kandidat → Undang / Tambah / Buka pendaftaran publik
      ↓
Terima pendaftar → Peserta masuk daftar
      ↓
Undang peserta ke Creator Portal → kreator aktivasi & login
      ↓
Terbitkan Info Acara (rundown, syarat, jadwal)
      ↓
Sesi live berjalan → Upload file Product + Trend Stats per sesi
      ↓
Generate Report Peserta → Finalkan Report → kreator lihat di portal
      ↓
Tutup Project (hitung hasil) → Report Gabungan
```

---

# Bagian A — Menyiapkan project

## 1. Buat project

1. Buka menu **Special Project** (`/projects`).
2. Isi form di bagian atas:

| Kolom | Wajib | Keterangan |
|---|---|---|
| Nama project | ✔ | Nama yang dipakai di semua report, termasuk yang dibaca kreator |
| Tipe | ✔ | Bootcamp · Training · Event · Showcase · Campaign · Trip · Lainnya |
| Mulai | ✔ | Tanggal pertama sesi boleh dihitung |
| Selesai | ✔ | Tanggal terakhir sesi boleh dihitung |
| Target GMV (Rp) | ✔ | Target total project |
| Target jumlah creator | – | Dipakai sebagai kuota dan pembagi saran target per kreator |
| Ads budget cap (Rp) | – | Batas biaya ads project |
| Kurva target | – | **Ramp-up** (default, target naik bertahap) atau **Flat** (rata tiap hari) |

3. Klik **Buat Project**.

> ⚠️ **Tanggal Mulai dan Selesai menentukan sesi mana yang boleh diupload.** Sesi live di
> luar rentang ini akan ditolak sistem. Kalau acara berpotensi molor, beri jarak longgar
> sejak awal — lebih mudah daripada mengubah belakangan.

Setelah dibuat, project muncul di tabel bawah dengan status **planning**. Klik namanya
untuk masuk ke halaman project (`/projects/{id}`) — semua langkah berikutnya ada di sana.

---

## 2. Aktifkan project

Di halaman project, klik **Aktifkan Project** (tombol hijau). Status berubah
`planning` → `aktif`.

Project boleh tetap `planning` selama masih persiapan. Aktifkan saat rekrutmen atau acara
sudah mulai berjalan.

---

## 3. Assign man power

Panel **Man Power In-Charge** ada di sisi kanan halaman project.

1. Pilih **anggota tim**.
2. Pilih **peran di project**: PIC · Project Manager · CM · CPM · Akuisisi · BizDev · Support · Lainnya.
3. Isi **Porsi keterlibatan (%)** bila perlu.
4. Klik **Assign**.

> 💡 Anggota yang sudah di-assign otomatis bisa menambah peserta project, walaupun
> role-nya bukan lead. Ini cara memberi akses kerja ke tim pelaksana tanpa menaikkan
> role mereka di seluruh sistem.

---

# Bagian B — Merekrut kreator

## 4. Tetapkan kriteria & cari kandidat

Dari halaman project klik tombol **Kebutuhan Kreator →**.

**Isi kriteria**, lalu klik **Simpan Kriteria**:

| Kolom | Contoh |
|---|---|
| Niche (pisah koma) | `Beauty, Fashion` |
| Platform | semua / TikTok / Shopee |
| Min level (1–6) | `3` |
| Follower tier (pisah koma) | `10k-50k, 50k-100k` |
| Min GMV 30 hari (Rp) | `5000000` |
| Kuota | kosongkan = ikut Target jumlah creator |
| Wajib live roster | centang kalau hanya mau kreator yang rutin live |
| Catatan | bebas, untuk tim sendiri |

Di bawahnya, bagian **Cari Kreator** menampilkan kandidat yang lolos kriteria, dihitung dari
performa 4 periode terakhir.

**Untuk mengundang:** centang kreator yang diinginkan → klik **Undang (N)**.

Kreator yang diundang akan melihat undangan itu di Creator Portal mereka dan bisa
**Terima** atau **Tolak**.

---

## 5. Tiga cara menambah peserta

Pakai yang paling sesuai situasi. Ketiganya bisa dicampur dalam satu project.

### 5a. Tambah langsung (paling cepat, untuk kreator yang sudah deal)

Di halaman project, bagian **Peserta**:

1. Ketik **username kreator** — daftar username terdaftar muncul otomatis saat mengetik.
2. Isi **Target GMV kreator (Rp)** — sistem menyarankan `sisa target project ÷ sisa kuota`,
   boleh diubah.
3. Pilih **Live solo** atau **Live co-host**.
4. Centang **External (wajib binding TikTok)** kalau kreator ini bukan kreator agency.
5. Centang **Binding TikTok selesai** kalau bindingnya memang sudah beres.
6. Klik **Tambah Peserta**.

### 5b. Undang dari hasil Cari Kreator

Lihat [langkah 4](#4-tetapkan-kriteria--cari-kandidat). Kreator baru jadi peserta setelah
**mereka menerima** undangan di portal.

### 5c. Buka pendaftaran publik (untuk menjaring kreator luar)

Di halaman project, tepat di bawah judul:

1. Centang **Buka pendaftaran publik**.
2. Isi **tanggal deadline pendaftaran**.
3. Klik **Simpan**.
4. Link pendaftaran muncul di sebelahnya — klik tombol **copy** dan sebarkan.
   Tombol **Link Pendaftaran Publik →** juga langsung membuka halamannya.

Yang diisi pendaftar: Nama lengkap · Username · Platform · Nomor WhatsApp · Jumlah
followers · Niche · persetujuan dihubungi.

> ⚠️ Kalau **Buka pendaftaran publik** tidak dicentang, halaman pendaftaran akan menolak
> semua pengunjung dengan pesan "Pendaftaran untuk project ini belum/tidak dibuka" —
> walaupun linknya benar.

---

## 6. Memutuskan pendaftar

Di halaman project ada dua panel berdampingan:

**Pendaftar — Internal**
Kreator yang sudah terdaftar di sistem, yang mengajukan diri atau sedang diundang.
Tombol: **Terima** / **Tolak** (menolak wajib mengisi alasan).

**Pendaftar — Eksternal**
Orang yang mendaftar lewat link publik dan belum jadi kreator terdaftar. Menampilkan nama,
username, platform, followers, dan niche.
Tombol: **Terima** / **Tolak** (menolak wajib mengisi alasan).

Yang diterima langsung masuk ke daftar **Peserta**.

---

# Bagian C — Creator Portal

## 7. Undang peserta ke Creator Portal

Creator Portal adalah tempat kreator melihat info acara, progress, dan report mereka
sendiri. Undangan dikirim **manual oleh tim**, satu per satu.

Di tabel **Peserta**, lihat kolom paling kanan: **AKUN PORTAL**.

1. Klik **Undang ke Portal** pada baris kreator.
2. Isi **email kreator** (wajib untuk undangan pertama — email ini yang dipakai login).
3. Klik **Kirim Undangan**.
4. Muncul **link aktivasi**. Klik kolomnya, salin, kirim ke kreator lewat WhatsApp.

> 🚨 **SALIN LINKNYA SEKARANG JUGA.** Setelah halaman di-refresh, kolom itu hanya
> menampilkan status ("Menunggu aktivasi") dan linknya **tidak bisa ditampilkan lagi** dari
> layar. Tempel dulu ke catatan/spreadsheet sebelum lanjut ke kreator berikutnya.

**Yang dilakukan kreator:**

1. Buka link yang kamu kirim.
2. Buat password untuk akunnya.
3. Setelah itu login di **https://app.meamcn.com/login** memakai email + password tadi.

**Arti status di kolom AKUN PORTAL:**

| Status | Artinya |
|---|---|
| Undang ke Portal | Belum pernah diundang |
| Menunggu aktivasi | Sudah dikirimi link, kreator belum membuat password |
| ✓ Aktif | Sudah bisa login |
| Ditangguhkan | Akses dihentikan |

---

## 8. Onboarding massal kreator lama yang belum pernah login

Ini kondisi yang paling umum: kreator sudah lama terdaftar di sistem, tapi belum satu pun
punya akun portal. Kerjakan berurutan seperti ini supaya tidak berantakan.

### Langkah 1 — Siapkan daftar dulu, jangan sambil jalan

Buat satu spreadsheet dengan kolom:

| Username | Nama | Email | Link aktivasi | Tanggal kirim WA | Status |
|---|---|---|---|---|---|

Isi **Username**, **Nama**, dan **Email** lebih dulu untuk semua kreator yang mau
di-onboard. Email wajib ada sebelum mulai — tanpa email, undangan tidak bisa dibuat, dan
berhenti di tengah untuk mencari email satu-satu adalah cara tercepat membuat batch ini
kacau.

> Belum punya email kreator? Kumpulkan lewat WA dulu. Boleh email pribadi apa saja, yang
> penting kreator bisa membukanya — email ini jadi username login mereka selamanya.

### Langkah 2 — Pastikan mereka jadi peserta project

Tombol **Undang ke Portal** hanya ada di baris tabel **Peserta**. Jadi kreator harus
terdaftar sebagai peserta salah satu project dulu ([langkah 5a](#5a-tambah-langsung-paling-cepat-untuk-kreator-yang-sudah-deal)).

Kalau tujuanmu memang onboarding portal (bukan menjalankan acara), buat satu project
penampung, misalnya:

- Nama: `Onboarding Portal Kreator 2026`
- Tipe: `Lainnya`
- Mulai–Selesai: rentang periode onboarding
- Target GMV: isi angka kecil, misalnya `1`
- Target jumlah creator: jumlah kreator yang mau di-onboard

Lalu tambahkan kreator-kreator itu sebagai peserta. Target GMV per kreator boleh diisi `1`.
Jangan buka pendaftaran publik untuk project ini.

### Langkah 3 — Undang per batch 20–30 kreator

Jangan kerjakan 200 sekaligus. Untuk tiap kreator dalam batch:

1. Klik **Undang ke Portal** → isi email → **Kirim Undangan**.
2. **Salin link aktivasi ke spreadsheet** sebelum pindah ke baris berikutnya.
3. Tandai kolom Status: `link dibuat`.

Selesaikan satu batch penuh dulu (semua link tersalin), baru kirim WA-nya sekaligus.

### Langkah 4 — Kirim WA

Template yang bisa dipakai:

```
Halo Kak {Nama} 👋

Akun Creator Portal MCN MEA kakak sudah dibuatkan. Di portal ini kakak bisa lihat
info acara, progress GMV, dan report performa live kakak sendiri.

Cara aktivasi (1 menit):
1. Buka link ini: {link aktivasi}
2. Buat password
3. Setelah itu login di app.meamcn.com pakai email {email} + password tadi

Linknya khusus untuk kakak, jangan dibagikan ya.
Kalau ada kendala, balas chat ini.
```

Tandai kolom **Tanggal kirim WA**.

### Langkah 5 — Pantau & tagih

Buka halaman project, lihat kolom **AKUN PORTAL**:

- Masih **Menunggu aktivasi** setelah 2–3 hari → follow up WA, kirim ulang link dari
  spreadsheet.
- Sudah **✓ Aktif** → tandai Selesai di spreadsheet.

> 💡 Link aktivasi tidak kedaluwarsa sendiri, jadi link yang sama di spreadsheet tetap bisa
> dipakai saat menagih. Ini alasan kenapa langkah 3 mewajibkan menyalin link — kalau tidak
> disimpan, satu-satunya jalan adalah menghubungi tim teknis.

### Langkah 6 — Kalau kreator bilang linknya tidak valid

Pesan "Link aktivasi tidak valid, sudah dipakai, atau sudah kedaluwarsa" berarti salah satu:

- Kreator **sudah pernah** mengaktifkan akunnya → suruh langsung login di
  `app.meamcn.com/login`, pakai **Lupa password** kalau passwordnya lupa.
- Link terpotong saat disalin/dikirim → kirim ulang link utuh dari spreadsheet.

---

## 9. Terbitkan Info Acara

Dari halaman project klik **Info Acara →**.

1. Isi **Judul pengumuman**.
2. Isi **Isi pengumuman** (rundown, syarat, jadwal, link grup — bebas).
3. Centang **Pin pengumuman ini** untuk yang penting. Maksimal 3 pengumuman ter-pin.
4. Klik **Terbitkan**.

Pengumuman langsung tampil di Creator Portal peserta, di bagian **Info**.

---

# Bagian D — Performa & report

## 10. Upload data sesi live

Ini langkah yang menentukan semua angka di report. Kerjakan setelah sesi live selesai.

### Siapkan file

Dari **TikTok LIVE Center**, unduh **dua file** per sesi:

| File | Isinya | Perannya |
|---|---|---|
| **Product** | rincian per produk | sumber GMV, order, item |
| **Trend Stats** | rincian per 30 menit | timeline, penonton, likes, komentar |

**Penamaan file** — nama file harus memuat tiga hal:

1. **username kreator**
2. kata **"Sesi"** + nomornya
3. **tanggal** sesi

Contoh yang diterima:

```
tesakun Sesi 1, 17 September 2026.xlsx
tesakun_Sesi_1__17_September_2026.xlsx
tesakun product Sesi 1, 17 September 2026.xlsx
```

Boleh ada kata lain di antaranya. Sistem membedakan file Product dan Trend Stats dari
**isinya**, bukan dari namanya — jadi kata "product"/"stats" di nama file tidak wajib.

### Upload

Dari halaman project klik **Upload Performa (Live) →**.

1. Pilih **peserta** dari dropdown.
2. Isi **Brand/produk sesi ini** (opsional, sebagai catatan).
3. Pilih file — **boleh banyak sekaligus**, beberapa sesi dan beberapa hari dalam satu kali
   upload.
4. Klik **Pratinjau**.
5. Periksa hasil pemeriksaan V1–V7 (lihat tabel di bawah).
6. Klik tombol hijau **Simpan Sesi (N)**.
7. Pastikan muncul tulisan hijau **"Tersimpan: …"**.

> 🚨 **Pratinjau tidak menyimpan apa pun.** Daftar V1–V7 yang muncul cuma hasil
> pemeriksaan. Sesi baru benar-benar masuk setelah kamu klik **Simpan Sesi (N)** dan
> melihat konfirmasi "Tersimpan". Tanpa itu, report akan tetap Rp0.

### Arti pemeriksaan V1–V7

| Kode | Yang dicek | Kalau gagal |
|---|---|---|
| **V1** | Username di nama file = peserta yang dipilih | **Ditolak.** Pilih peserta yang benar, atau perbaiki nama file |
| **V2** | Tanggal sesi ada dalam periode project | **Ditolak.** Cek tanggal di nama file, atau periode project memang salah |
| **V3** | Tidak bentrok jam dengan sesi lain kreator ini di hari yang sama | **Ditolak.** Kemungkinan file milik kreator lain atau sesi ganda |
| **V4** | File belum dipakai sesi aktif mana pun | **Ditolak.** Pesannya menyebut sesi mana yang memegang file itu |
| **V5** | File Product dan Trend Stats lengkap berpasangan | **Peringatan.** Boleh disimpan setelah dikonfirmasi, tapi timeline tidak lengkap |
| **V6** | Selisih GMV Product vs Trend Stats masih wajar | **Peringatan.** Boleh disimpan setelah dikonfirmasi |
| **V7** | Nomor sesi belum dipakai untuk kreator & tanggal ini | **Ditolak.** Ganti nomor sesi di nama file |

Untuk **peringatan** (V5/V6), centang konfirmasi dan tulis alasannya. Sesi tersimpan
dengan status "Dikonfirmasi tim".

### Riwayat Sesi & membatalkan sesi salah

Di bawah form ada **Riwayat Sesi**: tanggal, nomor sesi, GMV, order, dan status.

Kalau ada sesi yang salah (salah peserta, salah file), klik **Batalkan** pada barisnya.
Sesi itu langsung berhenti dihitung, dan **file serta nomor sesinya bebas dipakai ulang** —
jadi kamu bisa langsung upload ulang file yang benar.

---

## 11. Generate report peserta

Setelah semua sesi tersimpan, kembali ke halaman project dan klik
**Generate Report Peserta (semua)**.

Cukup **sekali klik**. Tombol ini membuat ulang report semua peserta dari data yang sudah
tersimpan. Kolom **REPORT** di tabel peserta berubah jadi **Draft →**.

Report peserta yang sudah terbit ikut terbarui sendiri setiap kali ada sesi diupload
atau dibatalkan, jadi angkanya tidak akan tertinggal. Tombol ini tetap dipakai untuk
membuat report peserta yang belum punya, dan untuk menyegarkan peringkat serta
perbandingan antar peserta setelah banyak upload.

Isi report peserta: GMV sesi, pesanan/item/pembeli, capaian terhadap target pribadi, grafik
alur sesi per 30 menit, funnel dari tayang sampai beli, angka efisiensi (CTR, CTOR, nilai per
pesanan, GMV per 1.000 views, follower baru, komentar, likes, share), produk terlaris, dan
catatan performa.

**Report harian.** Kalau sesi kreator lebih dari satu hari, di atas report muncul deretan
tombol: **Gabungan · 15 Sep · 16 Sep · …**. Kreator bisa menekan satu tanggal untuk membaca
performa hari itu saja — alur sesi, funnel, efisiensi, produk terlaris, dan catatannya semua
ikut tanggal yang dipilih. Tombol **Gabungan** kembali ke angka seluruh project. Tidak ada
yang perlu disetel; tombolnya muncul sendiri begitu ada sesi di hari kedua.

---

## 12. Finalkan report

Selama masih **Draft**, kreator melihat angka-angkanya tanpa narasi penutup.

1. Klik **Draft →** di baris peserta untuk membuka reportnya.
2. Periksa isinya.
3. Di kotak **Edit insight sebelum finalisasi (opsional)**, tulis atau rapikan catatan untuk
   kreator.
4. Klik **Finalkan Report**.

Status berubah jadi **Final**, dan kreator melihat versi lengkap dengan narasi di portal
mereka (menu **Progress & Report**).

Kerjakan per peserta — finalisasi adalah keputusan tim atas isi report masing-masing kreator.

---

## 13. Tutup project & report gabungan

Setelah semua sesi terupload dan report final:

1. Di halaman project, klik **Tutup Project (hitung hasil)**.
2. Status berubah `aktif` → `selesai`, dan hasil akhir project dihitung.
3. Klik **Report Gabungan →** untuk melihat rekap project: capaian vs target, leaderboard 10
   besar, dan feedback peserta.

**Feedback peserta** otomatis terbuka di portal kreator begitu project berstatus `selesai`.

> Kalau ternyata masih ada data yang terlambat masuk: **Director atau Head** bisa klik
> **Buka Kembali (koreksi upload terlambat)**, upload susulan dikerjakan, lalu project
> ditutup lagi.

---

## Penanganan masalah

| Yang terjadi | Penyebab | Yang harus dilakukan |
|---|---|---|
| Halaman pendaftaran bilang "Pendaftaran belum/tidak dibuka" | **Buka pendaftaran publik** belum dicentang, atau sudah lewat deadline | Centang dan Simpan, cek tanggal deadline |
| Username kreator tidak muncul di dropdown peserta | Kreator belum terdaftar di sistem | Daftarkan dulu lewat menu Kreator |
| Nama file tidak terbaca (dilewati) | Nama file tidak memuat username / "Sesi n" / tanggal | Ganti nama file sesuai contoh di langkah 10 |
| V1 merah | Peserta yang dipilih beda dengan username di nama file | Pilih peserta yang benar |
| V2 merah | Tanggal sesi di luar periode project | Cek tanggal di nama file; kalau periode project memang salah, perbaiki di form project |
| V4 merah | File itu masih dipakai sesi yang aktif | Pesannya menyebut sesi mana — batalkan sesi itu dulu kalau memang mau upload ulang |
| V7 merah | Nomor sesi sudah dipakai di tanggal itu | Ganti nomor sesi di nama file |
| Sudah upload tapi GMV masih Rp0 | Berhenti di Pratinjau, belum klik **Simpan Sesi** | Ulangi, pastikan muncul "Tersimpan: …", lalu Generate Report lagi |
| Report tetap "Draft" walau Generate berkali-kali | Generate memang selalu menghasilkan Draft | Buka reportnya, klik **Finalkan Report** |
| Angka report tidak berubah setelah upload sesi baru | Halaman masih menampilkan versi lama di browser | Refresh halamannya; kalau masih sama, klik **Generate Report Peserta (semua)** |
| Kreator bilang link aktivasi tidak valid | Sudah pernah diaktifkan, atau link terpotong | Suruh login langsung; kalau lupa password pakai Lupa password. Atau kirim ulang link utuh dari spreadsheet |
| Kolom AKUN PORTAL sudah "Menunggu aktivasi", link hilang | Link hanya tampil sekali saat dibuat | Ambil dari spreadsheet catatanmu |
| Tombol yang dicari tidak ada di layar | Role akunmu tidak punya hak itu | Lihat tabel di bagian [Siapa boleh melakukan apa](#siapa-boleh-melakukan-apa) |

---

## Checklist cepat

**Menyiapkan project**
- [ ] Project dibuat, tanggal Mulai–Selesai sudah longgar
- [ ] Project diaktifkan
- [ ] Man power di-assign

**Rekrutmen**
- [ ] Kriteria kreator disimpan
- [ ] Peserta masuk (Tambah langsung / Undang / Pendaftaran publik)
- [ ] Semua pendaftar sudah diputuskan (Terima/Tolak)

**Creator Portal**
- [ ] Email semua peserta terkumpul
- [ ] Undangan portal dikirim, **link tersalin ke spreadsheet**
- [ ] WA terkirim
- [ ] Status peserta sudah ✓ Aktif (tagih yang belum)
- [ ] Info Acara diterbitkan

**Selama & sesudah acara**
- [ ] Tiap sesi: file Product + Trend Stats diupload, muncul "Tersimpan"
- [ ] V1–V7 bersih, peringatan sudah dikonfirmasi beralasan
- [ ] Generate Report Peserta dijalankan setelah upload terakhir
- [ ] Tiap report diperiksa dan difinalkan
- [ ] Project ditutup
- [ ] Report Gabungan diperiksa
