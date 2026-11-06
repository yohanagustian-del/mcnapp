# Tutorial — Creator Product Match, Produk TAP, dan BD Value Predictor

Tiga halaman ini saling terhubung dan dipakai tim **BizDev dan CM** untuk satu pekerjaan:
*"produk mana yang cocok untuk kreator mana, dan berapa potensi GMV-nya."*

| Halaman | Menjawab pertanyaan | Dibaca dari |
|---|---|---|
| **Produk TAP** (`/products`) | Produk apa saja yang kita punya? | Upload master list, Registrasi Deal, ingest TAP mingguan |
| **Creator Product Match** (`/matching`) | Untuk **kreator ini**, produk apa yang cocok? | Histori penjualan kreator + katalog Produk TAP + katalog PX Exchange |
| **BD Value Predictor** (`/predictor`) | Untuk **deal/kategori ini**, kreator siapa dan berapa potensi GMV? | Histori penjualan kreator (pool per kategori × segmen harga) |

Urutan kerja yang disarankan:

```
1. Produk TAP        → pastikan katalog produk lengkap & bersih
2. Creator Product   → cari produk untuk satu kreator   (arah: kreator → produk)
   Match
3. BD Value          → nilai satu deal/kategori         (arah: produk/kategori → kreator + GMV)
   Predictor
```

> Ketiganya **100% deterministik, 0 token AI**: hanya SQL dan aritmetika. Hasil yang sama akan
> keluar untuk input yang sama. Tidak ada "tebakan" model bahasa.

---

## 0. Istilah yang dipakai di ketiga halaman

**Segmen harga.** Semua kecocokan memakai satu pembagian harga yang sama (konfigurasi
`segments.price_bounds`, bisa berubah oleh admin):

| Segmen | Label di layar | Rentang AOV/harga |
|---|---|---|
| `low` | Low-ticket | di bawah Rp180.000 |
| `entry` | Entry/mid-low | Rp180.000 – Rp800.000 |
| `sweet` | Sweet spot | Rp800.000 – Rp3,6 juta |
| `high` | High-ticket | Rp3,6 juta – Rp8 juta |
| `premium` | Premium | di atas Rp8 juta |

**AOV** = *average order value* = GMV ÷ jumlah order.

**Kategori Level 2** = kategori produk tingkat dua dari TikTok (mis. "Skincare", "Hijab"). Semua
pencocokan terjadi **per kategori Level 2**.

**Window** = rentang histori yang dibaca, saat ini **28 hari terakhir** (`projection.window_days`).
Kreator yang tidak punya penjualan dalam 28 hari terakhir tidak akan muncul hasilnya.

**Pool** = daftar kreator yang pernah menjual di satu kategori pada satu segmen harga dalam window.

---

## BAGIAN A — Produk TAP (`/products`)

### A.1 Fungsi
Katalog semua kartu produk TAP MEA. Ini **bahan baku** untuk Creator Product Match. Kalau produk
tidak ada di sini (atau datanya tidak lengkap), produk itu **tidak akan pernah direkomendasikan**.

Satu produk yang dipakai di beberapa campaign tampil sebagai **baris terpisah per campaign**, jadi
input satu tim tidak menimpa milik tim lain. Kunci barisnya = **(Campaign ID, Product ID)**.

### A.2 Siapa yang boleh apa

| Aksi | Role |
|---|---|
| Melihat katalog | Management, CM (CPM/CM Lead), BizDev (+Campaign Ops, BD Admin) |
| Upload master list, edit baris, hapus | Management, CM, BizDev |
| Melihat kolom **Nama BD** | Management, BizDev Lead, BizDev saja |

Untuk role di bawah BizDev, nama pemilik baris **tidak dikirim sama sekali** ke browser. Itu bukan
sekadar disembunyikan di tampilan.

### A.3 Tiga cara produk masuk ke katalog

1. **Registrasi Deal** (`/deals/baru`): isi form, kartu produk otomatis masuk. Lihat tutorial BizDev Workspace.
2. **Upload Master Product List** (di halaman ini): cara paling umum untuk banyak produk sekaligus.
3. **Ingest TAP mingguan** (`/ingest`): sistem menurunkan (derive) produk dari file TAP mingguan.
   Baris ini bertanda sumber `derived_tap`, dan kolom Nama BD-nya menampilkan **"ingest"**.

### A.4 Cara upload Master Product List (langkah demi langkah)

**Langkah 1. Unduh file dari TikTok TAP.** Panel *"Cara mengunduh file…"* di halaman sudah memandu,
ringkasnya:

1. Buka `https://partner.tiktokshop.com/`, pilih role **TAP** (akun tanyakan ke tim MCN).
2. Sidebar kiri: **Creator Matchmaking → Manage**.
3. Pilih room campaign, klik **View detail**.
4. Scroll sedikit, buka tab **Approved → Products**.
5. Ganti kolom filter dari *Product name* ke **Shop name**, lalu filter shop yang mau diexport.
6. Centang **select all**, klik **Export link**.
7. Isi **Creator affiliate commission** (angka persen, mis. `7`), klik **Export link** sekali lagi.
   File pun terunduh.

**Langkah 2. Upload apa adanya.** Tidak perlu dirapikan. Klik tombol **Upload Master Product List**
dan pilih file `.xlsx` / `.csv`. Halaman menerima dua jenis file:

| Jenis file | Isi | Catatan |
|---|---|---|
| **Export link** (TAP) | Campaign ID, product name, Product ID, Sale price, Shop name, masa berlaku, 4 rate komisi, Product link | **Tidak** ada Shop ID, kategori, maupun metrik performa |
| **Custom report** (Partner Compass) | Di atas + Affiliate GMV (total/video/live), Orders, Items sold, Collaborated creators, komisi estimasi/aktual, Settled GMV, refund, metrik Link | Membawa angka performa |

**Langkah 3. Baca laporan hasil upload.** Sistem melaporkan berapa baris masuk, dilewati, dan
berapa yang bertanda **perlu review**. Penanganan otomatis, **tidak ada yang membuat proses crash**:

- Rupiah campur (`Rp65.000`, `Rp1,075,484,867`) → angka.
- Harga rentang varian → ditangani, kemungkinan baris ditandai review.
- Komisi kotor (`not found`, `5-7%`, kosong) → dikosongkan + baris ditandai **needs_review**.
- Baris `Summary` → dilewati.
- Kolom gambar dan kolom terakhir bertanda *"only for checking"* → **sengaja diabaikan**.
- Segmen harga dihitung otomatis dari harga.

**Deal by dan PIC TAP.** Export TAP tidak membawa keduanya. Keduanya opsional, dijawab sekali di
form upload deal dan diterapkan ke semua kartu di file. Kosong berarti kolomnya **tidak disentuh**.

### A.5 ⚠️ Jebakan penting: kategori kosong = produk tidak pernah cocok

File **Export link tidak membawa kategori Level 2**. Padahal Creator Product Match hanya memakai
produk yang punya **Kategori Level 2** *dan* punya AOV (dari performa, atau dari harga bila belum
ada performa). Artinya:

| Kondisi produk | Ikut dicocokkan? |
|---|---|
| Kategori Level 2 **kosong** | ❌ Tidak |
| Kategori ada, harga **dan** performa kosong | ❌ Tidak |
| Kategori ada + harga terisi (belum ada order) | ✅ Ya, AOV = harga kartu |
| Kategori ada + sudah ada order & Affiliate GMV | ✅ Ya, AOV = GMV ÷ order |

**Solusi:** setelah upload Export link, lengkapi **Kategori Level 2** lewat tombol **Edit** per baris
(atau tunggu ingest TAP mingguan yang membawa kategori), atau upload file *Custom report* yang
sudah membawa kategori. Pakai pencarian dan edit massal untuk menyelesaikannya.

### A.6 Mencari, mengurutkan, menyaring

- **Kotak cari** (satu kotak, "wild search"): *Campaign ID / Product ID / Shop Name / Product Name*.
- **Klik header kolom** untuk mengurutkan: naik → turun → kembali ke urutan bawaan.
- **Paginasi** 10 / 50 / 100 baris per halaman.
- **Menu Kolom**: sembunyikan/tampilkan kolom. Pilihan tersimpan di browser masing-masing.
  Preset *Ringkas* = kolom persis seperti export TAP.
- **Urutan bawaan:** produk penyumbang GMV terbesar di atas, lalu yang terbaru dilihat.
  Maksimal **1.000 baris** dimuat. Kalau katalogmu lebih besar, gunakan pencarian.

Kolom yang tersedia: Campaign ID, Product Name, Product ID, Sale Price, Shop Name, Shop ID, Product
Effective Start/End Time, Creator Commission Rate, Affiliate Partner Commission Rate, Creator Shop
Ads Commission Rate, Affiliate Partner Shop Ads Commission Rate, Product Link, Tipe Campaign,
Deal by, PIC TAP, dan Nama BD (khusus BizDev ke atas).

### A.7 Edit satu produk

Klik **Edit** di baris. Yang bisa diubah: **Nama produk, Shop ID, Nama shop, Kategori Level 1,
Kategori Level 2, Harga satuan, Komisi kreator (%), Komisi partner (%), Link produk, Deal by,
PIC TAP, Nama BD (pemilik baris, hanya BizDev ke atas), dan status Aktif.**

Aturan:
- Harga harus terbaca sebagai angka Rupiah. Komisi diisi angka persen (`12`) atau rentang (`5-7`).
- **Segmen harga dihitung ulang otomatis** dari harga baru.
- Baris **otomatis bersih** (`needs_review` lepas) begitu harga **dan** komisi kreator terisi valid.
- **Metrik performa (GMV, orders, dst.) tidak bisa diedit.** Sumbernya hanya file platform. Kalau
  diedit manual, angka katalog akan berbeda dari angka platform.
- **Ads Budget & Service Fee tidak ada di sini.** Keduanya diisi per shop di **Project BD**.
- Produk **non-aktif** tidak ikut dicocokkan. Matikan produk yang sudah expired lewat centang *Aktif*.

### A.8 Edit & hapus massal

1. Centang baris (pilihan tetap terjaga saat pindah halaman).
2. Di atas tabel muncul bar **"N produk terpilih"**.
3. **Edit Shop (massal)**: isi **Shop ID** (angka) dan/atau **Shop Name**, lalu **Terapkan**.
   Kolom yang dikosongkan **tidak diubah**. Hanya dua kolom ini yang bisa diedit massal, karena
   harga, komisi, dan masa berlaku berbeda per produk.
4. **Hapus terpilih**: ketik **HAPUS** untuk konfirmasi. Isi lengkap baris yang dihapus tetap
   tersimpan di audit log.
5. Batas per operasi: dibatasi (pesan *"Maksimal N produk sekali proses"* muncul bila terlampaui).

> Baris `derived_tap` yang dihapus akan **muncul lagi** pada ingest mingguan berikutnya. Itu
> perilaku yang benar karena sumbernya file platform. Untuk menyingkirkannya, nonaktifkan.

### A.9 Hasil yang kamu dapat dari halaman ini
Bukan rekomendasi, melainkan **katalog bersih** yang jadi bahan untuk dua halaman berikutnya.
Indikator "bersih": tidak ada baris `needs_review`, semua baris aktif punya Kategori Level 2, harga,
dan komisi kreator.

---

## BAGIAN B — Creator Product Match (`/matching`)

### B.1 Fungsi
Memberi tahu **produk apa yang cocok untuk satu kreator**, berdasarkan kemampuan jual kreator itu
sendiri. Bukan menebak kecocokan konten, melainkan mencocokkan **kelas harga yang terbukti laku**.

### B.2 Siapa yang boleh menjalankan

| Role | Bisa membuka halaman | Bisa menekan **Cocokkan Produk** |
|---|---|---|
| Management (Director/Head/dst.) | ✅ | ✅ |
| CM Lead, CPM | ✅ | ✅ |
| **BizDev Lead, BizDev** | ✅ | ⚠️ **Tidak** (izin `m5.run` tidak mencakup BizDev) |

Catatan untuk BizDev: menu `/matching` tampil di sidebarmu, tetapi tombol jalankan akan diganti
pesan *"Role Anda tidak punya izin menjalankan Product Match"*. Teks bantuan di halaman menyebut
BizDev, padahal aturan akses di server tidak mengizinkannya. Ketidakcocokan ini ada di kode saat
ini. Kalau BizDev memang perlu menjalankannya, minta Management/tim teknis menambahkan izinnya.
Alternatif tanpa izin tambahan: minta CPM kreator itu menjalankannya, atau lihat hasil serupa di
**CM Workspace** ("Produk Cocok per Kreator") dan halaman detail kreator ("Rekomendasi Produk TAP").

### B.3 Data input yang dibutuhkan

**Dari kamu (di layar):** hanya **satu kreator**.

**Yang harus sudah ada di sistem agar hasilnya terisi:**

| Bahan | Sumber | Kalau tidak ada |
|---|---|---|
| Histori penjualan kreator per kategori Level 2 (GMV & order) dalam 28 hari terakhir | Upload data platform mingguan (`/ingest`) | Pesan: *"Tidak ada histori transaksi yang cukup … upload data platform (/ingest) dulu."* |
| Katalog produk TAP **aktif**, berkategori & berharga/berperforma | Halaman Produk TAP | Kategori tampil, tapi daftar produknya kosong |
| Katalog PX Exchange aktif | Dikirim otomatis dari CDPS (bridge) | Hanya produk TAP yang muncul |

Daftar kreator yang bisa dipilih hanya yang berstatus **binding** atau **aktif**.

### B.4 Cara memakai (langkah demi langkah)

1. Buka **BizDev & Deal → Creator Product Match**.
2. Di kotak **"Ketik untuk cari kreator…"**, ketik nama atau ID kreator (mis. `CRT-00789`).
3. Klik kreator di daftar. Kreator terpilih tampil dan bisa diganti lewat **Ganti**.
4. Klik **Cocokkan Produk**.
5. Tunggu beberapa detik. Pesan hijau/kuning muncul, lalu hasil di bawahnya.
6. Setiap run **otomatis tersimpan** di **Riwayat Run Terakhir** (waktu, kreator, awal window) dan
   tercatat di audit log.

### B.5 Cara kerja (supaya kamu bisa menjelaskan hasilnya ke brand/kreator)

```
Histori kreator 28 hari
   └─ per kategori Level 2:  GMV total, order total, AOV = GMV ÷ order
        └─ AOV → segmen harga (Low / Entry / Sweet / High / Premium)
              └─ Cari produk di KATEGORI SAMA
                    ├─ Produk TAP: AOV produk harus di SEGMEN SAMA dengan kreator
                    │              urut: order terbanyak dulu
                    └─ Produk PX : kategori sama (sudah afiliasi dulu, lalu nama A–Z)
                          └─ Ambil N teratas per kategori (bawaan 8)
```

Poin penting:
- Kategori dengan **total order 0** dilewati (AOV tidak bisa dihitung).
- AOV produk TAP = **Affiliate GMV ÷ order** bila sudah ada order; kalau belum, dipakai **harga kartu**
  (ditandai *"(harga kartu)"* di layar).
- Produk PX **tidak membawa harga/komisi/GMV** (angka volume berhenti di CDPS), jadi PX dicocokkan
  per **kategori** dan ditaruh **setelah** produk TAP di grup kategori yang sama.
- Jumlah produk per kategori dibatasi `product_match.top_n` (bawaan **8**), bisa diubah admin.

### B.6 Hasil yang kamu dapat

**1. Pesan ringkas**
- Hijau: *"N kategori tercocokkan untuk {nama}."*
- Kuning: tidak ada histori cukup.

**2. Baris "Profil Kreator"**: jumlah kategori, **total GMV**, total order, dan chip jumlah
kategori per segmen harga (mis. `Sweet spot: 2`).

**3. Satu kartu per kategori** (urut GMV terbesar), berisi:
- Nama kategori + **segmen harga** + **GMV · order · AOV** kreator di kategori itu.
- Kartu produk (grid), masing-masing menampilkan:

| Elemen | Arti |
|---|---|
| Nama produk | Dari katalog |
| Badge ungu **"Seller manage by MEA"** | Produk berasal dari katalog **PX Exchange** |
| Nama shop | Toko penjual |
| **AOV Rp…** | AOV produk; *"(harga kartu)"* bila dihitung dari harga |
| **N order** | Order produk di TAP (tidak tampil bila 0) |
| **komisi N%** | Komisi **kreator** di kartu produk (bukan komisi/margin MEA) |
| Tombol **Product ID ⧉** | Salin Product ID ke clipboard |
| **Buka link →** | Buka Product Link di tab baru |

Kalau satu kategori tidak punya produk yang cocok, tampil *"Belum ada produk TAP/PX di kategori &
segmen ini."* Itu sinyal untuk tim BD: ada **celah katalog**, kategori ini terbukti laku di kreator
tapi kita belum punya produk di segmen yang pas.

### B.7 Contoh membaca hasil

> Kreator `@dina` · kategori **Skincare** · GMV Rp48 jt · 120 order → AOV Rp400.000 → segmen
> **Entry/mid-low**.
> Sistem menampilkan produk Skincare TAP yang AOV-nya Rp180.000–Rp800.000, urut order terbanyak,
> lalu produk PX Skincare.

Tindak lanjut: tawarkan 3 produk teratas ke kreator, salin Product ID untuk dikirim ke tim, atau
masukkan ke campaign lewat Routing di BizDev Workspace.

### B.8 Troubleshooting

| Masalah | Penyebab & solusi |
|---|---|
| Kreator tidak ada di daftar | Statusnya bukan binding/aktif |
| "Tidak ada histori transaksi yang cukup" | Tidak ada penjualan dalam 28 hari terakhir, atau data mingguan belum di-upload ke `/ingest` |
| Kategori ada, produk kosong | Tidak ada produk aktif berkategori sama **di segmen harga yang sama** (TAP). Cek Produk TAP: kategori terisi? aktif? harga/performa ada? |
| Produk yang saya tahu ada tidak muncul | Kategori Level 2 kosong, nonaktif, atau AOV-nya di segmen berbeda dari kreator. Lihat **A.5** |
| Tombol tidak bisa ditekan / pesan izin | Role BizDev, lihat **B.2** |

---

## BAGIAN C — BD Value Predictor (`/predictor`)

### C.1 Fungsi
Menjawab, untuk **satu deal/kategori**: *"kreator mana yang berpotensi menjual, dan berapa potensi
GMV-nya (konservatif / likely / optimis) dengan tingkat keyakinan berapa persen."*

Ini **model pool**: menjumlahkan GMV historis kreator yang kamu centang di satu kategori × segmen
harga, lalu menerapkan faktor ramp-up dan (opsional) ads. **Bukan** simulasi komisi dan **bukan**
pitch brand otomatis.

### C.2 Siapa yang boleh menjalankan
**Management, BizDev Lead, BizDev** (izin `m6.run`). CPM/CM tidak menjalankannya. Role lain
melihat pesan *"Role Anda tidak punya izin menjalankan prediksi deal"*, namun tetap bisa melihat
riwayat skenario.

### C.3 Data input yang dibutuhkan

**Dari kamu (di layar):**

| Input | Wajib? | Arti |
|---|---|---|
| **Tipe Deal** | Ya | `TAP` atau `Paid Campaign` |
| **Nama Brand (catatan)** | Opsional | Hanya catatan, tidak memengaruhi hitungan |
| **Kategori (Level 2)** | Ya | Dropdown, bertanda jumlah kreator ber-histori di kategori itu |
| **Segmen Harga** | Ya | Klik salah satu dari 5 chip |
| **Anchor Campaign (Rp)** | Opsional, hanya Paid | Nilai patokan campaign |
| **Ramp-up** | Ya (slider) | Seberapa besar histori diharapkan terulang. Bawaan **70%** |
| **ROAS** | Opsional | Hasil iklan yang diharapkan (mis. `3`) |
| **Ads Budget (Rp)** | Opsional | Dipakai bersama ROAS |
| **Centang kreator** | Ya | Kreator di Creator Pool yang diikutkan |

**Yang harus sudah ada di sistem:** histori penjualan kreator 28 hari terakhir (dari `/ingest`).
Kategori yang muncul di dropdown hanya yang punya kreator ber-GMV positif dalam window. Dropdown
kosong berarti data mingguan belum masuk.

### C.4 Cara memakai (langkah demi langkah)

1. Buka **BizDev & Deal → BD Value Predictor**.
2. **Setup Deal** (kiri atas): pilih **Tipe Deal**. Isi **Nama Brand** bila perlu.
3. Pilih **Kategori (Level 2)**. Pool kreator dimuat ("Memuat pool kreator…").
4. Muncul 5 chip segmen, masing-masing berisi `jumlah kreator · total GMV`. Klik segmen yang
   sesuai harga produk brand. **Semua kreator di segmen itu otomatis tercentang.**
5. Di **Creator Pool**, **hilangkan centang** kreator yang tidak relevan (mis. sedang vakum, di luar
   kapasitas). Hasil dihitung ulang **langsung di browser** setiap kali kamu mengubah centang atau
   slider.
6. Atur **Ramp-up**. Isi **ROAS** dan **Ads Budget** bila brand menyiapkan iklan. Untuk Paid, isi
   **Anchor** bila ada.
7. Baca panel **Output** (kanan).
8. Klik **Simpan Skenario** bila hasilnya mau dijadikan catatan. Skenario **hanya tersimpan saat
   tombol ditekan**, bukan setiap kali slider digeser.

### C.5 Membaca Creator Pool

Tabel kreator pada segmen terpilih (urut GMV terbesar):

| Kolom | Arti |
|---|---|
| ☑ | Ikut dihitung atau tidak |
| **Username** | Username kreator (nama bila username kosong) |
| **GMV Sel** | GMV kreator di **sel** kategori × segmen itu dalam 28 hari |
| **Order** | Jumlah order di sel itu |
| **% Live** | Porsi GMV dari live (— bila tidak diketahui) |
| **ROAS Ref** | Rata-rata ROAS historis kreator dari report live BD, bila ada (dicocokkan lewat username, *best-effort*) |

**Ekspor daftar kreator terpilih:** tautan **Teks**, **TSV**, **CSV** di kanan atas tabel.
Hanya kreator yang **tercentang** yang diekspor. TSV bisa langsung ditempel ke spreadsheet.

### C.6 Hasil yang kamu dapat (panel Output)

| Output | Arti |
|---|---|
| Kalimat ringkas | *"N kreator punya histori real di kategori X segmen Y, total GMV Rp… (window berjalan)."* |
| **Potensi GMV (Likely)** | Angka tengah, perkiraan paling realistis |
| **Konservatif – Optimis** | Rentang bawah dan atas |
| **Confidence %** + label | **Rendah** (<40), **Sedang** (40–69), **Tinggi** (≥70), dengan bar merah/kuning/hijau |
| Catatan *ads upside* | Muncul bila ROAS dan budget terisi |

### C.7 Rumus (supaya angkanya bisa kamu pertanggungjawabkan)

Semua konstanta dari konfigurasi `m6.pool_model`, bukan hardcode. Nilai saat ini:

```
hist      = jumlah GMV sel semua kreator yang tercentang
withHist  = jumlah kreator tercentang yang GMV sel-nya > 0

organic   = TAP  : hist × ramp
            Paid : anchor > 0 → 0,5 × hist × ramp + 0,5 × anchor
                   anchor = 0 → hist            (ramp TIDAK dipakai)
adUpside  = ROAS × Ads Budget      (hanya bila keduanya > 0)
likely    = organic + adUpside

spread       = batasi( 0,45 − withHist × 0,02 − (ROAS − 8) × 0,012 , antara 0,12 dan 0,45 )
               (suku ROAS hanya dipakai bila ROAS > 0)
konservatif  = likely × (1 − spread)
optimis      = likely × (1 + spread)

confidence   = min(100, bulatkan( withHist × 9
                 + (ROAS > 0 ? min(ROAS, 20) × 1,6 + 6 : 0) ))      ; 0 bila likely ≤ 0
```

Artinya: **makin banyak kreator ber-histori → rentang makin sempit & confidence makin tinggi.**
ROAS yang tinggi juga mempersempit rentang dan menaikkan confidence.

**Contoh 1 (TAP, tanpa iklan).** 5 kreator tercentang, total GMV sel Rp100 jt, ramp 70%:
- likely = 100 jt × 0,70 = **Rp70 jt**
- spread = 0,45 − 5×0,02 = 0,35 → konservatif **Rp45,5 jt**, optimis **Rp94,5 jt**
- confidence = 5×9 = **45% (Sedang)**

**Contoh 2 (TAP + iklan).** Data yang sama, ROAS 3, Ads Budget Rp10 jt:
- adUpside = 3 × 10 jt = Rp30 jt → likely = 70 + 30 = **Rp100 jt**
- spread = 0,45 − 0,10 − (3−8)×0,012 = 0,41 → konservatif **Rp59 jt**, optimis **Rp141 jt**
- confidence = 45 + (3×1,6 + 6) = 55,8 → **56% (Sedang)**

**Contoh 3 (Paid + anchor).** Total GMV Rp100 jt, ramp 70%, anchor Rp60 jt:
- organic = 0,5×100×0,70 + 0,5×60 = 35 + 30 = **Rp65 jt**

### C.8 Riwayat Skenario
Di bawah form: 10 skenario terakhir (Waktu, Kategori, Segmen, **Potensi GMV**, **Confidence**).
Skenario lama dari model sebelumnya tetap terbaca (ditampilkan sebagai rentang min–maks dan
jumlah kreator relevan). Setiap simpan tercatat di audit log.

### C.9 Cara memakai hasilnya untuk keputusan BD

| Situasi | Tindakan |
|---|---|
| Confidence **Tinggi**, likely besar | Dasar kuat untuk nego/komitmen volume. Gunakan **konservatif** sebagai angka aman untuk brand |
| Confidence **Rendah** (kreator sedikit) | Jangan janjikan angka. Perluas pool (segmen lain/kategori terkait) atau rekrut kreator |
| Banyak kreator tapi GMV per kreator kecil | Pool luas tapi daya jual rendah; pertimbangkan segmen harga lain |
| Mau tahu **kreator mana** | Ekspor CSV/TSV dari Creator Pool, lalu route lewat BizDev Workspace |
| Mau tahu **produk mana** untuk kreator itu | Jalankan Creator Product Match (Bagian B) |

### C.10 Batasan yang perlu kamu ketahui

1. **Hanya histori 28 hari.** Kategori musiman bisa terlalu rendah/tinggi.
2. **Tidak mempertimbangkan produk spesifik brand.** Yang dibaca hanya kategori × segmen harga.
3. **Tidak ada skenario komisi dan tidak ada pitch brand** (keputusan produk 2026-09-23).
4. **Angka adalah proyeksi, bukan jaminan.** Sampaikan ke brand sebagai rentang.
5. **ROAS Ref** dicocokkan lewat username, jadi mungkin kosong walau kreatornya pernah live.
6. **Paid tanpa anchor tidak memakai ramp-up**, jadi hasilnya sama dengan total histori. Isi
   anchor bila ingin ramp berlaku.

### C.11 Troubleshooting

| Masalah | Penyebab & solusi |
|---|---|
| Dropdown kategori kosong | Belum ada data penjualan 28 hari terakhir. Upload `/ingest` mingguan |
| Segmen menampilkan 0 kreator | Tidak ada kreator yang menjual di segmen itu. Coba segmen lain |
| Output tidak muncul | Kategori **dan** segmen harus dipilih dulu |
| Confidence 0% | Semua kreator tidak tercentang, atau likely = 0 |
| "Role Anda tidak punya izin…" | Bukan BizDev/Management |
| Gagal menyimpan skenario | Coba ulang; pesan galat muncul di bawah tombol |

---

## BAGIAN D — Alur kerja gabungan (contoh nyata)

**Kasus:** brand skincare "Glow" (produk Rp350.000) mau lakukan campaign TAP.

1. **Produk TAP:** pastikan produk Glow sudah masuk (Registrasi Deal atau upload Export link),
   **Kategori Level 2 = Skincare**, harga Rp350.000, status aktif, komisi terisi.
2. **BD Value Predictor:** Tipe *TAP* → Kategori *Skincare* → segmen *Entry/mid-low*. Tinjau pool,
   hilangkan kreator yang tidak tersedia, atur ramp 70%. Misalnya hasil: likely Rp70 jt, rentang
   Rp45–95 jt, confidence 45%. **Simpan Skenario.** Ekspor CSV pool kreatornya.
3. **Creator Product Match** (dijalankan CM/Management): untuk 3 kreator teratas pool, cek apakah
   produk Glow muncul di kartu kategori Skincare mereka. Kalau muncul, itu konfirmasi produk
   cocok dengan kelas harga yang terbukti laku untuk kreator itu.
4. **BizDev Workspace → Routing:** pilih deal Glow, centang kreator, **Route ke CM**.
5. Setelah campaign berjalan, buat **Report Brand** dan bandingkan realisasi dengan angka
   konservatif/likely yang kamu simpan di langkah 2.

---

## Ringkasan input → output

| Halaman | Input dari kamu | Data yang harus sudah ada | Output |
|---|---|---|---|
| **Produk TAP** | File Export link / Custom report, edit manual | Akses akun TAP untuk unduh file | Katalog produk bersih & bisa dicari |
| **Creator Product Match** | 1 kreator | Histori 28 hari kreator, katalog TAP berkategori, katalog PX | Per kategori: profil (GMV, order, AOV, segmen) + hingga 8 produk cocok |
| **BD Value Predictor** | Tipe deal, kategori, segmen, centang kreator, ramp, (ROAS, budget, anchor) | Histori 28 hari seluruh kreator | Pool kreator + potensi GMV (konservatif/likely/optimis) + confidence + file ekspor |

## Aturan yang harus diingat

1. **Semua hasil bergantung pada data mingguan.** Kalau `/ingest` terlambat, hasil ketiga halaman
   ikut basi.
2. **Katalog kotor menghasilkan rekomendasi kosong.** Selalu cek Kategori Level 2, harga, dan status
   aktif di Produk TAP.
3. **Metrik performa tidak bisa diedit manual.** Perbaiki di sumbernya (upload ulang).
4. **Rekomendasi adalah alat bantu keputusan**, bukan pengganti penilaian BD dan konfirmasi ke kreator.
5. **Ambang (segmen harga, window 28 hari, jumlah produk 8, konstanta Predictor) dapat diubah admin
   lewat `app_config`.** Angka di tutorial ini adalah nilai saat ini.
6. **Setiap run, edit, hapus, dan simpan skenario tercatat di audit log.**

*Sumber: `src/app/(portal)/matching/*`, `products/*`, `predictor/*`, `src/lib/product-match/*`,
`src/lib/m6/predictor.ts`, `src/lib/m10/products.ts`, `supabase/migrations/0005, 0067`,
`src/lib/rbac-constants.ts`, dan `CLAUDE.md` (aturan #4, #8, #9).*
