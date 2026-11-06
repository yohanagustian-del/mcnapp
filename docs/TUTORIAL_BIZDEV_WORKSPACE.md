# Tutorial — BizDev Workspace (M8)

Untuk tim **BizDev Lead, BizDev, BD Admin, dan Campaign Ops**. Tutorial ini mengikuti urutan kerja
harian BizDev: dari mendaftarkan deal sampai report brand. Semua yang tertulis di sini sudah dicek
ke kode (`src/app/(portal)/workspace/bizdev/`) dan aturan di `CLAUDE.md`.

> Prinsip: seluruh workspace ini **0 token AI**. Angka dan status dihitung SQL/aturan. Satu-satunya
> titik LLM adalah *ringkasan naratif opsional* di Report Brand.

---

## 0. Peta besar: apa itu BizDev Workspace

Menu **BizDev & Deal** di sidebar berisi beberapa halaman. Workspace adalah *meja kerja harian*,
halaman lain adalah *tempat data diisi*:

| Menu | Fungsi | Siapa yang mengisi |
|---|---|---|
| **Registrasi Deal** (`/deals/baru`) | Daftarkan deal baru lewat form tervalidasi | BizDev, BizDev Lead |
| **Deal Brand** (`/deals`) | Tabel shop yang sudah ber-deal | Dibaca semua BD |
| **Project BD** (`/bd-projects`) | Kelompokkan beberapa shop jadi satu campaign | BizDev |
| **Brand Lead Bank** (`/leads`) | Bank lead brand ber-kontak | BizDev (CM hanya lihat) |
| **Produk TAP** (`/products`) | Katalog kartu produk | BizDev, CM |
| **Creator Product Match** (`/matching`) | Rekomendasi produk ↔ kreator | Dibaca |
| **BD Value Predictor** (`/predictor`) | Potensi GMV deal | Dibaca |
| **BizDev Workspace** (`/workspace/bizdev`) | Tracker, routing, pipeline, report | **Halaman tutorial ini** |

**Hak akses singkat** (detail di bagian 9):

- `bizdev_lead` dan `bizdev`: bisa semua aksi di workspace (route, proses req, acc brand, handover, pipeline, report brand).
- `bd_admin`: bisa **memproses req dari CM** (tombol Proses/Selesai). Tidak bisa route atau ubah pipeline.
- `campaign_ops`: bisa **handover**. Menerima campaign yang sudah fix.
- Management (Director/Head dst.): semua aksi.

Kalau tombol tidak muncul di layar kamu, itu karena role-mu tidak punya izinnya. Itu normal, bukan error.

---

## 1. Urutan kerja harian (ringkas)

```
1. Buka BizDev Workspace → cek Brand Lead Bank & kebutuhan Ads Budget project
2. Cek "Tracker Req dari Semua CM" → Proses req sample/ads/HSL
3. Ada deal baru? → Registrasi Deal → lalu set Tahap Pipeline
4. Butuh kreator untuk campaign? → Route Req Campaign ke CM
5. Pantau "Status Req Campaign" → catat Acc Brand → Handover ke Campaign Ops
6. Akhir periode → Generate Report Brand
```

---

## 2. Membuka workspace

1. Login, lalu di sidebar pilih **BizDev & Deal → BizDev Workspace**.
2. Halaman dibuka dengan urutan blok dari atas ke bawah:

   | # | Blok | Isi |
   |---|---|---|
   | 1 | Header | Judul & penjelasan singkat |
   | 2 | **Brand Lead Bank** | Kartu ringkasan: `N baru / N nego`, klik untuk ke `/leads` |
   | 3 | **Kebutuhan Ads Budget — Special Project** | Tabel project M7 (read-only) |
   | 4 | **Jadwal Live (deal BD)** | Slot live minggu berjalan yang terkait deal BD |
   | 5 | **Routing Req Campaign → CM Pemilik Creator** | Form routing (hanya yang punya izin route) |
   | 6 | **Status Req Campaign** | Tracker semua req campaign |
   | 7 | **Tracker Req dari Semua CM** | Req sample/ads/HSL dari CM |
   | 8 | **Lead Shop Potensial** | Lead otomatis M4 + manual CM |
   | 9 | **Pipeline Deal Brand** | Tahap tiap deal |
   | 10 | **Report Brand Deals** | Form + riwayat report |

Semua tabel mendukung **klik header untuk urut naik/turun** dan **paginasi 10 baris**. Klik header
yang sama untuk ketiga kalinya akan mengembalikan ke urutan bawaan (terbaru dulu).

---

## 3. Blok demi blok

### 3.1 Brand Lead Bank (kartu ringkasan)

Kartu kecil di atas menunjukkan jumlah lead berstatus **baru** dan **nego**. Klik kartunya untuk
masuk ke halaman penuh. Cara memakai Lead Bank ada di **bagian 5**.

### 3.2 Kebutuhan Ads Budget — Special Project

Panel **read-only**. Isinya project Special Project (M7) berstatus *planning* atau *aktif*, beserta:

- **Ads Budget** yang perlu diamankan BizDev (`ads_budget_cap` project),
- **Target GMV**, periode, dan status project.

Cara pakai:
- Cari lewat kotak **"Cari nama / tipe project…"**, filter **Status**, dan klik nama project untuk
  membuka detailnya (`/projects/{id}`).
- Gunakan panel ini sebagai *daftar tugas*: project mana yang budget iklannya belum kamu amankan.
- Angka tidak bisa diubah dari sini. Edit dilakukan di halaman project.

### 3.3 Jadwal Live (deal BD)

Pratinjau **read-only** jadwal live **minggu berjalan** untuk slot yang dianggap *deal BD*, yaitu
slot yang:
- sumbernya BD (`deals_by = bd`), atau
- menunjuk deal lama (`deal_id`), atau
- menunjuk shop dari Produk TAP (`shop_key`).

Kolom identitas menampilkan **username** kreator (brand mengenal kreator lewat username). Ada
kotak pencarian dan catatan ads. Untuk **mengubah** jadwal, buka menu **Jadwal Live** (`/schedule`).
Kamu punya izin edit slot di sana.

> Tip: kalau slot kamu tidak muncul di sini, cek apakah slot sudah ditautkan ke shop deal lewat
> pertanyaan **"Link ke deal (opsional)"** di form slot.

### 3.4 Routing Req Campaign → CM Pemilik Creator

Ini **fitur inti** workspace. Kamu membutuhkan kreator untuk sebuah campaign brand, dan sistem
mengirim permintaannya ke **CM yang tepat**, bukan ke semua orang.

Form punya 3 kolom + pengaturan di atasnya.

**Pengaturan atas**

| Kontrol | Arti |
|---|---|
| **Deal / brand** | Wajib **bila memilih kreator** (kolom 1). Boleh kosong untuk kolom 2 & 3. |
| **Brand minta acc creator dulu** | Centang bila brand ini harus menyetujui kreator sebelum fix. Ditentukan **per campaign**, tidak semua brand. |
| **Creator dicarikan BizDev langsung (tanpa CM)** | Centang bila kamu sendiri yang sudah mengamankan kreatornya. Konfirmasi CM dilewati (otomatis "mau") dan tercatat sebagai **kontribusi BizDev**. Hanya berlaku untuk kolom 1. |

**Kolom 1 — Kreator terdaftar**
1. Ketik username / nama / ID di kotak cari.
2. Centang kreator yang diinginkan (boleh banyak).
3. Sistem membaca `owner_cpm_id` tiap kreator dan membuat **satu req per kreator** ke CM pemiliknya.
4. Kreator berlabel kuning **"tanpa CPM"** belum punya CM pemilik. Kreator itu **dilewati**, kecuali
   kamu mencentang "Creator dicarikan BizDev langsung".

**Kolom 2 — Kategori (level-2 / niche)**
1. Cari & centang kategori. Daftarnya dari penjualan nyata kreator (GMV > 0).
2. Sistem mengirim req ke **semua CM yang punya kreator dengan penjualan di kategori itu**
   (satu req per kategori × CM).
3. CM nanti yang memilih kreatornya sendiri saat konfirmasi.

**Kolom 3 — Request (teks bebas)**
- Tulis kebutuhan campaign / kreator yang dicari.
- Kalau **kolom 1 & 2 kosong**, teks ini di-**broadcast ke semua CM aktif** (CPM & CM Lead).
- Kalau kolom 1 atau 2 terisi, teks hanya menempel sebagai keterangan di tiap req.

Terakhir, isi **Catatan internal** (opsional) lalu klik **Route ke CM**.

**Pesan hasil** (hijau/merah di bawah tombol), contoh:
`Ter-route: CRT-00789, kategori "Skincare" (3 CM) (Brand X). Dilewati: CRT-00790 (belum punya CPM owner).`
Baca bagian *Dilewati* dengan teliti. Itu kreator/kategori yang **tidak** terkirim.

**Contoh praktis**

| Situasi | Cara isi |
|---|---|
| Brand skincare deal, mau kreator A (dipegang CPM Sari) | Pilih deal → kolom 1 centang A → Route. Req muncul **hanya di CM Workspace Sari**. |
| Brand butuh "kreator fashion hijab" tapi belum tahu siapa | Kolom 2 centang kategori yang cocok → Route. Semua CM berkreator fashion menerima. |
| Butuh kreator bebas, kategori belum jelas | Hanya isi kolom 3 → broadcast ke semua CM. |
| Kamu sudah deal langsung dengan kreator | Kolom 1 + centang "dicarikan BizDev langsung". CM tidak perlu konfirmasi. |

### 3.5 Status Req Campaign

Tracker semua req campaign yang pernah di-route (50 terbaru). Kolomnya:

| Kolom | Arti |
|---|---|
| **Brand** | Nama brand deal ("tanpa deal" bila kosong), dengan kutipan teks request di bawahnya |
| **Creator** | Kreator, atau badge **Kategori: …**, atau **Broadcast** |
| **Sourcing** | **via CM** atau badge **BizDev langsung** |
| **CM Owner** | CM penerima req |
| **Konfirmasi CM** | `menunggu` / `mau` / `tidak` |
| **Acc Brand** | `tidak perlu` / `n_a` / `menunggu` / `approved` / `ditolak` |
| **Status** | `proses` (kuning) / `fix` (hijau) / `batal` (merah); tambahan "· handed over" |

**Alur status** (state machine `lib/m8/routing.ts`):

```
Route  →  Konfirmasi CM = menunggu, Status = proses
            │
            ├─ CM jawab "tidak" ──────────────────────→ batal
            │
            └─ CM jawab "mau"
                 ├─ Campaign TIDAK butuh acc brand ───→ fix
                 └─ Campaign butuh acc brand ─→ Acc Brand = menunggu
                        ├─ Brand approved ────────────→ fix
                        └─ Brand ditolak ─────────────→ batal
fix → Handover Campaign Ops → "handed over"
```

**Aksi yang kamu lakukan di tabel ini**

1. **Brand approved / Brand ditolak**: muncul hanya saat Status = `proses` **dan** Acc Brand =
   `menunggu`. Klik sesuai jawaban brand. Ini **pencatatan keputusan brand**, bukan keputusanmu.
2. **Handover Campaign Ops**: muncul hanya saat Status = `fix` dan belum di-handover. Klik untuk
   menyerahkan campaign ke tim Campaign Ops. Tidak bisa diulang untuk req yang sama.

Konfirmasi "mau/tidak" **bukan** tugasmu. Itu dikerjakan CM/CPM di CM Workspace mereka. Tugasmu
hanya memantau. Setiap transisi tercatat di **audit_logs**.

> Troubleshooting: req lama berstatus `proses` + `Konfirmasi CM = menunggu`? Itu menunggu CM.
> Follow-up CM pemiliknya (kolom **CM Owner** menunjukkan siapa).

### 3.6 Tracker Req dari Semua CM

Kumpulan permintaan yang diajukan CM untuk kreatornya: **sample, ads, HSL**, ke brand lewat kamu.

Kolom: Creator, Jenis (+ nominal bila ada), Brand, Status, Aksi.

Cara memproses (butuh izin `m8.request_process`):

1. Req baru berstatus **diajukan** → klik **Proses** (jadi **diproses**).
2. Setelah kamu menindaklanjuti ke brand, klik **Selesai**.
3. Urutan harus berurutan: `diajukan → diproses → selesai`. Melompat tidak diizinkan.

**Kasus khusus: req Ads**
Bila req ads melewati ads cap dan statusnya **"(menunggu Director)"**, tombol **tidak muncul**. Req itu
butuh persetujuan Director (aturan approval: aksi manusia yang berpotensi merugikan perusahaan).
Tunggu sampai Director menyetujui. Jangan mencari jalan pintas.

### 3.7 Lead Shop Potensial

Tabel **read-only** 20 lead teratas berdasarkan `priority_score`. Kolom: Shop/ID, Freq, GMV, Sumber,
Status. Sumber lead:

- **auto M4**: dari analisis kebocoran link (shop yang transaksinya tanpa link agency tapi belum ber-deal).
- **manual CM**: shop potensial yang ditemukan CM dari interaksi kreator.

Cara memakainya: shop dengan GMV bocor besar dan frekuensi tinggi adalah kandidat prioritas untuk
didekati, didaftarkan sebagai deal, atau dimasukkan ke Brand Lead Bank. Kalau mau menilai potensinya
dulu, buka **BD Value Predictor**. Untuk memilih kreator, buka **Creator Product Match** (link ada
di bawah tabel).

### 3.8 Pipeline Deal Brand

Daftar 100 deal terbaru. Kolom: Deal (ID), Brand, Campaign, Exp, **Tahap Pipeline**.

Tahap (berurutan): **prospek → nego → closing → aktif → selesai**.

Cara mengubah tahap:
1. Pada baris deal, buka dropdown **— tahap —**.
2. Pilih tahap baru, klik **Set**.
3. Perubahan tersimpan dan tercatat di audit_logs (nilai sebelum & sesudah).

Mengurutkan kolom **Tahap Pipeline** memakai urutan tahap (bukan abjad). "desc" berarti tahap paling
akhir dulu.

Kalau tabel kosong, tombol di tengah mengarahkan ke **Registrasi Deal**.

### 3.9 Report Brand Deals

Report performa per brand untuk **pitch balik** dan **saran upgrade service**.

**Langkah membuat report**

1. **Siapkan file platform** untuk shop deal tersebut: export data affiliate TikTok/Shopee yang
   difilter ke shop (idealnya) dan periode report. Format: `.xlsx`, `.xls`, `.csv`, atau `.numbers`.
2. Pilih **Deal / brand**.
3. Isi **Mulai** dan **Selesai (eksklusif)**. Tanggal selesai **tidak ikut dihitung**, jadi untuk
   September penuh pilih Mulai `2026-09-01`, Selesai `2026-10-01`. Selesai harus lebih besar dari Mulai.
4. (Opsional) isi **Ads spend brand (Rp)**. Angka ini **hanya** untuk menghitung ROAS karena belanja
   iklan brand tidak ada di data platform. Tanpa angka ini, ROAS kosong dan **tidak ada** saran upgrade.
5. Upload file di **File platform shop ini**.
6. (Opsional) centang **Ringkasan naratif (1 LLM call)**.
7. Klik **Generate Report Brand**.

**Syarat deal:** deal harus punya **shop_id**. Kalau belum, sistem menolak dan meminta kamu
melengkapinya lewat registrasi/edit deal.

**Apa yang terjadi di belakang layar**
- File dibaca **in-memory**, diambil baris untuk shop deal itu dalam periode, lalu **dibuang**. Data
  mentah **tidak disimpan**. Yang tersimpan hanya hasil report.
- Dihitung: GMV affiliate, GMV live, GMV video, order, item terjual, jumlah kreator unik.
- **ROAS** = GMV ÷ Ads spend.
- **Saran upgrade** muncul (badge hijau **✦ layak upgrade**) bila **ROAS ≥ 3** *dan*
  **GMV ≥ Rp500.000.000**. Kedua ambang bisa diubah di konfigurasi (`m8.upgrade_roas_min`,
  `m8.upgrade_gmv_min`), jadi angka ini bisa berbeda saat kamu membaca.
- Ringkasan naratif: hanya bila dicentang **dan** API key tersedia. Kalau belum, report tetap
  tersimpan sebagai *data-only (0 token)* dan pesan akan memberi tahu.

**Membaca tabel riwayat**

| Kolom | Arti |
|---|---|
| Brand, Periode | Sesuai input |
| GMV, ROAS | Hasil hitung; ROAS "—" bila ads spend tidak diisi |
| Video / View | **Catatan:** data platform MCN tidak punya kolom views, jadi nilainya selalu 0 untuk saat ini. Jangan dipakai sebagai bukti performa. |
| Creator | Jumlah kreator unik di file |
| Upgrade? | Badge layak upgrade |
| Ringkasan | Teks naratif + jumlah token, atau "data-only (0 token)" |

**Error yang umum**

| Pesan | Penyebab / solusi |
|---|---|
| "Periode tidak valid (start < end)" | Tanggal selesai harus setelah mulai |
| "File platform wajib di-upload" | Lupa melampirkan file |
| "File tidak berisi transaksi untuk shop … pada periode ini" | Shop ID di file ≠ shop ID deal, atau periode tidak cocok. Cek keduanya. |
| "Deal … belum punya shop_id" | Lengkapi shop ID deal dulu |

---

## 4. Registrasi Deal (`/deals/baru`)

Aturan penting: deal baru **wajib lewat form** ini, bukan sheet bebas. Tujuannya mencegah data
kotor seperti master lama.

**Dua tujuan simpan, ditentukan otomatis dari isianmu** (kamu tidak diminta memilih):

| Kamu isi | Hasilnya | Tampil di |
|---|---|---|
| **Product Name** atau **Product ID** | **Kartu Produk** | Tab Produk TAP |
| Hanya **Shop Name / Shop ID** (belum ada produk) | **Deal Shop** | Tab Deal Brand. Kartu produk menyusul setelah produknya turun. |
| Tidak ada identitas produk maupun shop | **Ditolak** | — |

**Isian form** (mengikuti header export TAP "Export link"): Campaign ID, Product Name, Product ID,
Sale Price, Shop Name, Shop ID, Effective Start/End Time, empat rate komisi (Creator, Affiliate
Partner, Creator Shop Ads, Affiliate Partner Shop Ads), Product Link, **Deal by**, dan **PIC TAP**.

Aturan yang perlu kamu ingat:
- **Tidak ada kolom yang wajib**, termasuk Product Name. Jangan mengarang isian yang belum kamu tahu.
  Yang ditolak hanya form kosong total atau tanpa identitas produk/shop.
- Yang **diisi** harus valid: Shop ID & Product ID **angka**; tanggal lewat **date picker**; komisi
  **0–100%**; Rupiah **angka murni** (tanpa "Rp" atau titik).
- Tanpa Product ID → sistem memberi ID internal `PRD-xxxxx` dan menandai **needs_review**. Kartu itu
  tidak bisa dicocokkan ke data TAP mingguan sampai Product ID-nya diperbaiki.
- Kombinasi (Campaign ID, Product ID) yang **sudah ada ditolak**, tidak menimpa. Pakai Edit.
- **Ads Budget & Service Fee tidak ditanyakan di sini.** Keduanya diisi per shop di **Project BD** (bagian 6).

**Upload massal produk deal lama:** di halaman Registrasi Deal ada **"Upload Produk Deal Lama via
Excel"**. Pakai export TAP apa adanya. **Deal by** dan **PIC TAP** (opsional) dijawab sekali di form
upload dan diterapkan ke semua kartu di file. Kalau dikosongkan, kolomnya **tidak disentuh**
(tidak dikosongkan). Nama BD otomatis = akunmu.

**Import Master Deal** (`/deals/import`) untuk deal lama hanya bisa oleh `bizdev_lead`, `bd_admin`,
dan Management.

---

## 5. Brand Lead Bank (`/leads`)

Tempat menyimpan **lead brand yang sudah ada kontaknya** (dari matchmaking, event, iklan, dll).
Beda dengan "Lead Shop Potensial" di workspace (itu lead otomatis dari data kebocoran). Jangan dicampur.

**Melihat & mencari**
- Cari per **Nama Brand** (pencarian per kata), filter **Niche** lewat dropdown.
- Semua BD dan CM bisa melihat semua lead. CM hanya melihat/mencari, tidak menambah.

**Tambah lead satu per satu** (form):
- **Asal Lead** (wajib): `matchmaking`, `event`, `iklan`, `rekomendasi`, `scouting`, `others` (isi
  "Asal Lain" bila Lainnya).
- Nama Toko/Brand, Kota, Niche, Link Toko, Bizdev (PIC MEA), Grup Brand, Ads Brand, Budget Marketing,
  Target ROAS, Catatan.
- **Kontak PIC** (nama, HP, email), bisa lebih dari satu.
- Layanan yang dicentang: Sample / Flash Sale / Ads.
- **Status**: `baru → kontak → nego → deal / batal`.

**Upload massal (Excel)**
- Pakai satu importer. Kolom mengikuti sheet matchmaking BizDev (Nama Brand, Bizdev, Niche, Link Toko,
  Contact PIC, Grup Brand, Sample/Flash Sale/Ads, Ads Brand). **Sheet lama bisa diupload apa adanya**.
- Ada template unduhan di panel upload.
- Tiap baris divalidasi aturan yang sama dengan form. Baris bermasalah dilaporkan, tidak membuat proses crash.
- Brand yang **sudah ada tidak dibuat dua kali**. Datanya digabung **aditif**: kolom kosong diisi,
  kontak baru ditambah, catatan ditambah baris. **Tidak ada yang ditimpa**; asal dan status tidak disentuh.

**Edit lead**: dibatasi per baris. Hanya **pembuat lead** atau **BizDev Lead / Management** yang boleh.

---

## 6. Project BD (`/bd-projects`)

Dipakai bila **beberapa shop digarap sebagai satu campaign**.

1. Klik **+ Tambah Project**: isi nama, status, **status payment**, catatan, dan pilih shop.
   - Status payment: `done`, `proses finance payment`, `proses finance brand`.
2. Buka detail project. Kamu akan melihat:
   - **Shop dalam Project** — tiap shop dengan tombol **Edit** untuk **Ads Budget & Service Fee**.
     Ini **satu-satunya tempat** mengisi kedua nominal itu. Nominalnya **per pasangan (project, shop)**,
     jadi shop yang sama bisa punya nominal berbeda di project berbeda.
   - **Produk yang dikerjasamakan** — centang produk dari kartu Produk TAP. Yang disimpan hanya
     kuncinya; harga, komisi, dan masa berlaku dibaca dari Produk TAP.
   - **Tracking Report Campaign (BD)** — upload/isi report performance dan **Creator TC & Celeb**
     (Nama creator, Event, Ads spending $ / IDR, GMV, ROAS, SS Dashboard). Template Excel tersedia.
3. Jumlah kartu, campaign, GMV, dan tanggal exp **dibaca otomatis** dari data deal. Tidak perlu diketik ulang.

Catatan: mengeluarkan shop dari project akan menghapus nominalnya. Sistem mencatat nominal itu ke
audit log lebih dulu. Mengubah nama project **tidak** menghapus nominal.

---

## 7. Alat bantu keputusan

- **Creator Product Match** (`/matching`): satu engine rekomendasi produk untuk kreator, berdasarkan
  AOV kreator per kategori → segmen harga → produk Deal TAP dan PX Exchange yang cocok. Pakai saat
  memilih kreator untuk campaign, atau menawarkan produk ke kreator.
- **BD Value Predictor** (`/predictor`): model pool, hasil berupa daftar kreator potensial + potensi
  GMV (konservatif / likely / optimis) + confidence. Tidak ada skenario komisi dan tidak ada pitch
  brand otomatis. Pakai untuk menilai deal sebelum nego.
- **Link Leakage** (`/link-leakage`): lihat shop ber-deal yang transaksinya bocor, dan lead baru.
  Status link diisi mesin dari upload mingguan, **tidak ada edit manual**.
- **Kapasitas Kreator (PX)** (`/px/capability`): baca kapasitas kreator sebelum menjanjikan kuota
  ke klien MEA Agency.

---

## 8. Skenario lengkap dari awal sampai akhir

**Brand skincare "Glow" closing, butuh 3 kreator, brand minta acc dulu.**

1. **Lead**: Glow sudah ada di Brand Lead Bank (status `nego`). Ubah ke `deal`.
2. **Registrasi Deal**: daftarkan produk Glow (Campaign ID, Product ID, harga, komisi, Shop ID).
   Isi *Deal by* dan *PIC TAP*.
3. **Pipeline**: di workspace, set tahap `closing`, lalu `aktif` saat jalan.
4. **Project BD** (bila multi-shop): buat project, edit Ads Budget & Service Fee shop Glow.
5. **Pilih kreator**: buka Creator Product Match / Predictor, tentukan kandidat.
6. **Routing**: pilih deal Glow → centang 3 kreator → centang *Brand minta acc creator dulu* →
   **Route ke CM**. Req muncul di workspace CM pemilik masing-masing.
7. **CM mengonfirmasi** (di sisi CM). Kreator yang "mau" → status Acc Brand = `menunggu`.
8. **Kirim ke brand**, lalu tekan **Brand approved** atau **Brand ditolak** sesuai jawaban.
9. Yang `fix` → **Handover Campaign Ops**.
10. **Akhir bulan**: Generate **Report Brand** (isi ads spend untuk ROAS). Bila muncul **✦ layak
    upgrade**, jadikan bahan pitch kenaikan investasi.

---

## 9. Tabel izin (siapa boleh apa)

| Aksi | Izin | Role |
|---|---|---|
| Lihat workspace | menu `BizDev Workspace` | Management, BizDev Lead, BizDev, Campaign Ops, BD Admin |
| Route req campaign | `m8.route_campaign` | Management, BizDev Lead, BizDev |
| Proses req dari CM | `m8.request_process` | Management, BizDev Lead, BizDev, BD Admin |
| Catat acc brand | `m8.brand_acc` | Management, BizDev Lead, BizDev |
| Handover Campaign Ops | `m8.handover` | Management, BizDev Lead, BizDev, Campaign Ops |
| Ubah tahap pipeline | `m8.pipeline` | Management, BizDev Lead, BizDev |
| Generate report brand | `m8.brand_report` | Management, BizDev Lead, BizDev |
| Registrasi deal | `deals.register` | Management, BizDev Lead, BizDev |
| Import master deal | `deals.import_legacy` | Management, BizDev Lead, BD Admin |
| Tambah/edit Brand Lead | `leads.create` / `leads.edit` | Management, BizDev Lead, BizDev |
| Lihat Jadwal Live | `schedule.view` | termasuk BizDev |
| Edit slot Jadwal Live | `schedule.edit` | Management, CM, BizDev Lead, BizDev, Creator Support |
| Konfirmasi kreator join (mau/tidak) | `m8.cm_confirm` | **CM/CPM, bukan BizDev** |
| Approve ads di atas cap | `m8.ads_approve` | **Director saja** |

Akses ditegakkan di **server** (RLS + pengecekan izin pada tiap aksi), bukan hanya disembunyikan di tampilan.

---

## 10. Aturan yang harus diingat (supaya tidak salah kerja)

1. **Status link & komisi kreator tidak bisa diedit manual.** Keduanya dari data platform. Kalau
   salah, perbaiki di sumbernya (upload mingguan), jangan minta edit manual.
2. **Req ads di atas cap butuh Director.** Tidak bisa dipercepat dari workspace.
3. **Routing kreator mengikuti CM pemilik.** Jangan minta CM lain mengonfirmasi kreator yang bukan
   miliknya. CPM hanya bisa bertindak atas req yang di-route ke dirinya.
4. **Semua transisi status tercatat** (audit_logs). Salah klik pun terekam, jadi baca dulu sebelum klik.
5. **Report brand tidak menyimpan file mentah.** Simpan file aslinya sendiri bila perlu bukti.
6. **Kolom Video/View di Report Brand = 0** sampai sumber datanya ada. Jangan menyampaikannya ke brand.
7. **Ambang saran upgrade bisa berubah** (konfigurasi). Angka di tutorial ini adalah nilai bawaan saat ini.
8. **Jangan mengarang data** di Registrasi Deal. Biarkan kosong bila belum tahu. Kartu akan ditandai
   *needs_review* dan bisa dilengkapi nanti.

---

## 11. FAQ / troubleshooting

| Masalah | Kemungkinan penyebab & solusi |
|---|---|
| Menu BizDev Workspace tidak ada | Role-mu bukan Management/BizDev/Campaign Ops/BD Admin. Minta ke Management. |
| Form Routing tidak muncul | Role-mu tidak punya `m8.route_campaign` (mis. BD Admin / Campaign Ops). |
| Kreator tidak terkirim saat routing | Berlabel "tanpa CPM". Minta CM Lead meng-assign kreator, atau pakai "dicarikan BizDev langsung". |
| Tombol Proses tidak muncul di Tracker | Req ads sedang "(menunggu Director)", atau role-mu tanpa `m8.request_process`. |
| Tombol Brand approved/ditolak tidak muncul | CM belum menjawab "mau", atau campaign tidak butuh acc brand, atau Status sudah `fix`/`batal`. |
| Tombol Handover tidak muncul | Status belum `fix`, atau sudah pernah di-handover. |
| Report brand gagal "tidak berisi transaksi" | Shop ID file ≠ shop ID deal, atau periode salah. |
| ROAS kosong, tidak ada saran upgrade | Ads spend belum diisi. Tanpa itu tidak ada dasar rekomendasi. |
| Slot live tidak muncul di preview BD | Bukan minggu berjalan, atau belum ditautkan ke deal/shop BD. |
| Deal baru ditolak | Duplikat (Campaign ID + Product ID sudah ada), atau tidak ada identitas produk/shop. |

---

## 12. Butuh bantuan?

Kalau ada fitur yang tidak ada di tutorial ini atau terasa tidak sesuai dengan layarmu, kemungkinan
layar sudah berubah setelah dokumen ini ditulis. Tanyakan ke Yohan/tim MEA untuk konfirmasi, dan
kabari supaya tutorial diperbarui.

*Sumber: `src/app/(portal)/workspace/bizdev/*`, `workspace/campaign-actions.ts`, `lib/m8/routing.ts`,
`lib/rbac-constants.ts`, `CLAUDE.md` (aturan #6, #9), `docs/prd/MCN_MEA_AI_Platform_Module08_Team_Workspaces.md`.*
