# CLAUDE.md — MCN MEA AI Platform

Baca file ini penuh sebelum menulis kode apa pun. Ini sumber kebenaran operasional.

## Apa ini
Platform internal MCN MEA (agency creator TikTok/Shopee). Menggabungkan tools terpisah jadi satu. 8 module (M1–M8). Detail bisnis: `docs/prd/`. Schema: `supabase/migrations/`. Rencana: `docs/BUILD_PLAN.md`.

## Stack (jangan ganti tanpa diminta)
- Next.js 15 App Router, TypeScript, Server Actions
- Supabase: Postgres + Auth + RLS + Edge Functions
- Tailwind. Chart: recharts.
- Pipeline berat (diff CSV, agregasi batch, scoring OKR) = Edge Function / server action, BUKAN client.
- AI layer = service terpisah, dipanggil HANYA untuk reasoning.

## ATURAN NON-NEGOTIABLE (melanggar = salah)

### 1. Token / AI
- LLM HANYA untuk reasoning: insight report naratif (M2), ringkasan performa (M3/M7/M8). Titik.
- SEMUA sisanya deterministik: SQL + rule-based + batch. Klasifikasi, agregasi, scoring, matching, prediksi GMV = TANPA LLM.
- Jangan pernah panggil LLM per-row. Kalau tergoda loop LLM, itu tanda desain salah — pakai SQL.
- Tiap LLM call: log `token_used`. Input ke LLM = angka/ringkasan yang sudah jadi, BUKAN data mentah.

### 2. Approval & Alert (pola wajib)
- Aksi menambah income / tak merugikan → auto berlaku (tetap di audit_logs).
- Aksi MANUSIA berpotensi merugikan perusahaan → butuh approval sebelum berlaku.
- Perubahan dari DATA PLATFORM yang merugikan (sharing turun, link makin bocor, ads > komisi) → ALERT, bukan approval (tak bisa diubah manual).
- SELALU tulis ke `audit_logs` (type: auto | approval | platform_alert).

### 3. Read-only (jangan bikin endpoint edit)
- `agency_links.link_status` → diisi engine M4 dari upload mingguan. TIDAK ADA edit manual, siapa pun.
- `creators.commission_share` → sync dari platform. Read-only. Turun = alert.

### 4. Satu sumber kebenaran (jangan duplikasi logic)
- Report → M2. Link status & lead → M4. Proyeksi GMV → `projectGmv()` shared (M5+M6).
- M8 workspace & M3 OKR MENG-AGREGASI/BACA sumber ini, TIDAK menghitung ulang.

### 5. M4 data = AGREGAT per produk (BUKAN per-transaksi) — penting
- Data platform TikTok = agregat per (product_id, shop_id, period). Tidak ada txn_ref/per-row transaksi.
- **Bocor per produk = affiliate_gmv di CSV-all − affiliate_gmv di CSV-agency-link**, di-join by (product_id, shop_id).
- Shop ber-deal? → join shop_id ke cooperating_shops. Non-deal → LEAD.
- Rollup creator: sum(gmv_bocor) / sum(gmv shop ber-deal) → 4 status (threshold app_config).
- File 1 creator: tanpa kolom creator (creator dari konteks upload). File multi-creator: ada kolom creator_name → resolve ke creator_id saat ingest.
- `deal_end` TIDAK ada di master shop platform → diisi dari BizDev/kontrak. Alert kadaluarsa hanya untuk shop yang punya deal_end.
- %live tersedia langsung: affiliate_live_gmv vs affiliate_video_gmv.

### 6. Deal Registration Form (M8/BizDev) — cegah data kotor
- Master deal internal lama = berantakan (alasan platform ini dibuat). Deal BARU wajib lewat FORM tervalidasi, bukan free-text sheet.
- **Registrasi Deal = mendaftarkan KARTU PRODUK ke `products_tap`** (tab Produk TAP), bukan baris `brand_deals`. Pertanyaannya = header tabel Produk TAP (export TAP "Export link": Campaign ID, Product Name, Product ID, Sale Price, Shop Name, Shop ID, effective start/end, 4 rate komisi, Product Link) + Tipe Campaign, Ads Budget, Service Fee, Deal by, PIC TAP.
- Field wajib HANYA `product_name`; Ads Budget & Service Fee wajib saat `campaign_type = paid` (Paid Campaign — satu-satunya tipe berbayar; keputusan user 2026-08-14). Aturan ini berlaku di DUA jalur tulis: form Registrasi Deal & form Edit di tab Produk TAP, lewat `productCardIssues()` yang sama. Kolom lain boleh kosong — memaksa isian yang belum diketahui justru memancing data karangan.
- Upload massal kartu produk (termasuk "Upload Produk Deal Lama via Excel" di halaman Registrasi Deal) memakai SATU importer: `uploadProductMasterList()` (export TAP → `products_tap`, upsert per (campaign_id, product_id)). Tidak ada importer `deal_products` lagi. Export TAP tidak membawa Tipe Campaign/Ads Budget/Service Fee/Deal by/PIC TAP: di jalur deal (`uploadDealProducts`) Tipe Campaign WAJIB dijawab sekali di form lalu diisikan ke semua kartu di file (Paid Campaign ikut mewajibkan kedua nominal, aturan dari `productCardIssues()` yang sama); Deal by & PIC TAP opsional — kosong = kolomnya TIDAK disentuh (bukan dikosongkan). Nama BD tidak ditanyakan: = akun peng-upload (`uploaded_by`). Upload Master Product List di tab Produk TAP tidak menanyakannya → kolom-kolom itu tak disentuh.
- Ads Budget & Service Fee TIDAK punya kolom di tabel Produk TAP (nominal per deal, bukan atribut export platform). Keduanya dibaca per shop di tabel "Shop dari Produk TAP" yang menjumlahkannya, bersama Deal by, PIC TAP, dan Nama BD (`uploaded_by_ids`, migrasi 0045; kolom Nama BD tunduk izin `products.view_owner_name`). Nilainya tetap tersimpan di kartu & tetap bisa diperbaiki lewat form Edit di tab Produk TAP.
- Tab Deal Brand = dua tabel: `brand_deals` (deal lama) + ringkasan kartu Produk TAP per Shop Name dari view `products_tap_shop_summary` (agregasi di SQL, bukan JS). Tabel shop punya tombol Edit yang menulis ke SELURUH kartu shop itu (Shop ID & Tipe Campaign saja — kolom lain berbeda per produk). Anggota grup dipilih lewat kolom generated `products_tap.shop_key` (0043), kunci yang sama dengan group by view — jangan menyalin ekspresinya ke filter aplikasi. Ads Budget/Service Fee di form itu hanya MENGISI kartu yang kosong (menimpa serempak akan melipatgandakan total shop), dan aturan Paid Campaign hanya ditegakkan saat tipe campaign ditegaskan — kalau tidak, Shop ID tak akan pernah bisa dibetulkan pada shop yang punya kartu paid lama tanpa nominal.
- Validasi form tetap ketat untuk yang DIISI: shop_id & product_id numeric; tanggal = date picker (bukan teks "19 February 2026"); komisi = number% 0–100; Rupiah → number murni. Aturan dipakai bersama server & klien lewat `lib/deals/product-card.ts` + `lib/deals/campaign-type.ts`.
- Tanpa Product ID → dipakai ID internal `PRD-xxxxx` + `needs_review=true` (kartu tak bisa dicocokkan ke data TAP mingguan). Kombinasi (campaign_id, product_id) yang sudah ada DITOLAK, bukan ditimpa (migrasi 0040).
- Tab **Project BD** (`/bd-projects`, migrasi 0044) = pengelompokan beberapa shop jadi satu campaign. Yang disimpan HANYA nama + daftar `shop_key`; jumlah kartu, ads budget, service fee, GMV, exp date DIBACA dari `products_tap_shop_summary` — jangan pernah menyalin angka ke `bd_projects`. Tracking report campaign (report performance & Creator TC & Celeb) memakai tabel + parser yang SAMA dengan detail deal (`lib/deals/report-actions.ts`), bedanya kolom pemilik: tepat satu dari (`deal_id`, `project_id`) terisi. Template .xlsx kedua upload dibangun dari daftar kolom yang sama dengan yang dibaca parser (`lib/deals/report-template.ts`, dijaga test round-trip) — jangan menulis header template di tempat lain.
- Produk yang DIKERJASAMAKAN pada sebuah project = centangan di detail project, disimpan sebagai kunci `(campaign_id, product_id)` di `bd_project_products` (migrasi 0045). Hanya kuncinya: harga/komisi/masa berlaku tetap dibaca dari `products_tap`. Daftarnya ditulis ulang utuh tiap simpan (form mengirim keadaan akhir), sama seperti daftar shop.
- `brand_deals` (tab Deal Brand) tetap sumber deal lama: diisi Import Master Deal + form Edit deal, dan dari sanalah exp_date sinkron ke cooperating_shops.deal_end untuk alert kadaluarsa M4.
- Jadwal Live (M13): pertanyaan "Link ke deal (opsional)" di form slot memilih SHOP dari tabel "Shop dari Produk TAP" dan menyimpannya di `live_schedule_slots.shop_key` (= `products_tap.shop_key`, migrasi 0045) — bukan `deal_id`, yang tetap ada untuk slot lama. Kalau kartu shop itu punya `pic_tap`, jadwalnya muncul sebagai notifikasi (badge sidebar `/schedule` + panel di halamannya) di akun PIC TAP tersebut; hitungannya dari sumber, tidak disimpan (`lib/schedule/pic-tap-alerts.ts`).

### 7. Data cleaning (ingest sheet lama) — WAJIB tangani
- Rupiah campur: "Rp1,075,484,867" (koma=ribuan) DAN "Rp4.131.512.642" (titik=ribuan). parseRupiah deteksi keduanya → number.
- exp_date teks bebas: "19 February 2026" → parse ke date; kosong → null.
- komisi kotor: "not found"/"error"/"5-7%"/kosong → null + flag review (jangan crash).
- Baris "Summary" (baris pertama data platform) → SKIP.
- Countdown negatif = deal lewat exp_date → active_flag=false.
- creator_name (multi-file) → resolve ke creators.id; belum ada → buat prospek + flag.

### 8. projectGmv() = SATU implementasi, dipakai M5 & M6
- Signature: `projectGmv(creatorId, subCategory, priceSegment, window=28d) → {min, max}`
- Selalu return range + disclaimer. Jangan bikin dua versi.

## Konvensi kode
- DB: snake_case. Kode: camelCase. Komponen: PascalCase.
- ID entity: `CRT-`, `DEAL-`, `LNK-` (text PK, generate util terpusat).
- Semua threshold dari tabel `app_config` — JANGAN hardcode angka (15%, 65jt, dll ada di sana).
- Rupiah: strip "Rp", titik=ribuan(hapus), koma=desimal(→titik). Util `parseRupiah()`.
- Semua mutasi entity material → tulis audit_logs.
- UI label Bahasa Indonesia; kode/komentar Bahasa Inggris.

## Enum penting (lihat migration untuk lengkap)
- role: director|head|spv|cm_lead|cpm|bizdev_lead|bizdev|campaign_ops|bd_admin|acquisition_lead|acquisition_spec|campaign_external|creator_support|finance
- link_status: via_agency|bocor_sebagian|bocor_total|belum_ada_link
- price_segment: low(<180k)|entry(180k-800k)|sweet(800k-3.6jt)|high(3.6jt-8jt)|premium(>8jt)

## RBAC
- Enforce di server (RLS + middleware), bukan cuma UI.
- Management lihat cross-team; Lead lihat tim; staff lihat scope sendiri; Finance lihat dimensi pembayaran.
- Director = owner konfigurasi OKR (target + reward) via Dashboard Director.

## Urutan kerja
Ikut `docs/BUILD_PLAN.md`. Fase 0 (fondasi) blocking semua. Jangan lompat fase.
Sebelum coding M4/M5/M6: cek `docs/BUILD_PLAN.md` bagian "BLOCKER" — ada keputusan data yang harus dikunci dulu.

## Definition of done per task
- Type-safe, RLS aktif, audit_logs tertulis untuk mutasi, threshold dari app_config, tidak ada LLM di jalur deterministik.
