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
- **Sesi live = SATU tabel dua pemilik** (`project_live_sessions`, migrasi 0066): pemiliknya
  `project_id` (Special Project M7) ATAU `schedule_slot_id` (slot Jadwal Live M13) — tepat satu
  terisi (`ck_live_session_owner`). Parser, verifikasi V1–V7, penyimpanan, shaper report
  (`lib/m7/live-ingest.ts`, `live-verify.ts`, `report-data.shapeLive`), dan catatan deterministik
  (`live-notes.ts`) DIPAKAI APA ADANYA untuk kedua pemilik; yang berbeda hanya konteks pemilik
  (parameter `LiveSessionOwner`), bukan salinan kode. Jangan pernah bikin tabel/parser/report
  kedua untuk sesi live.
- **Report Kreator (M2) v2 = 0 LLM.** Angka dari `lib/report/build.ts`, SEMUA kalimat (ringkasan,
  insight box, badge produk, rekomendasi) dari `lib/report/rules.ts` + ambang `app_config`
  (`m2.report_rules`, `m2.live_benchmarks`). `token_used` selalu 0. Tim hanya boleh menyunting
  TEKS (`creator_reports.edits_json`); angka tidak pernah bisa disunting.

### 5. M4 data = AGREGAT per produk (BUKAN per-transaksi) — penting
- Data platform TikTok = agregat per (product_id, shop_id, period). Tidak ada txn_ref/per-row transaksi.
- **Bocor per produk = affiliate_gmv di CSV-all − affiliate_gmv di CSV-agency-link**, di-join by (product_id, shop_id).
- Shop ber-deal? → join shop_id ke cooperating_shops. Non-deal → LEAD.
- Rollup creator: sum(gmv_bocor) / sum(gmv shop ber-deal) → 4 status (threshold app_config).
- File 1 creator: tanpa kolom creator (creator dari konteks upload). File multi-creator: ada kolom creator_name → resolve ke creator_id saat ingest.
- `deal_end` TIDAK ada di master shop platform → diisi dari BizDev/kontrak. Alert kadaluarsa hanya untuk shop yang punya deal_end.
- %live tersedia langsung: affiliate_live_gmv vs affiliate_video_gmv.
- Sejak 0066 `creator_top_products` ikut menyimpan dimensi per produk yang selama ini dibuang saat
  ingest (live/video GMV & order, items_sold, direct_gmv, CTR/CTOR berbobot GMV, shop_name,
  level1_category) — itulah yang membuat report "produk terbaik untuk LIVE vs VIDEO" mungkin.
  Baris batch LAMA tetap nol/null: report HARUS bilang datanya belum ada, bukan menampilkan nol.

### 6. Deal Registration Form (M8/BizDev) — cegah data kotor
- Master deal internal lama = berantakan (alasan platform ini dibuat). Deal BARU wajib lewat FORM tervalidasi, bukan free-text sheet.
- **Registrasi Deal punya DUA tujuan simpan, ditentukan dari isian — bukan ditanyakan** (`productCardTarget()`): ada Product Name atau Product ID → KARTU PRODUK di `products_tap` (tab Produk TAP); belum ada keduanya tapi Shop Name/Shop ID terisi → DEAL SHOP di `brand_deals` (tab Deal Brand), kartunya menyusul setelah produknya turun (keputusan user 2026-08-18); tidak ada identitas produk maupun shop → ditolak. Pertanyaannya = header tabel Produk TAP (export TAP "Export link": Campaign ID, Product Name, Product ID, Sale Price, Shop Name, Shop ID, effective start/end, 4 rate komisi, Product Link) + Deal by & PIC TAP. Tipe Campaign, Ads Budget, Service Fee TIDAK ditanyakan di sini.
- TIDAK ADA field yang wajib per-kolom, `product_name` sekalipun (keputusan user 2026-08-14) — memaksa isian yang belum diketahui justru memancing data karangan. Sejak 2026-08-18 tidak ada lagi kewajiban kondisional sama sekali: aturan "Ads Budget & Service Fee wajib saat `campaign_type = paid`" DIHAPUS bersama pertanyaannya, karena kedua nominal itu bukan lagi atribut kartu. Yang ditolak hanya submit yang kosong SELURUHNYA (`isEmptyProductCard()`) atau yang tidak menyebut produk maupun shop. Kartu tanpa `product_name` (seperti kartu tanpa Product ID) tersimpan dengan `needs_review=true`.
- Upload massal kartu produk (termasuk "Upload Produk Deal Lama via Excel" di halaman Registrasi Deal) memakai SATU importer: `uploadProductMasterList()` (export TAP → `products_tap`, upsert per (campaign_id, product_id)). Tidak ada importer `deal_products` lagi. Export TAP tidak membawa Deal by/PIC TAP: keduanya OPSIONAL, dijawab sekali di form upload deal (`uploadDealProducts`) lalu diisikan ke semua kartu di file; kosong = kolomnya TIDAK disentuh (bukan dikosongkan). Nama BD tidak ditanyakan: = akun peng-upload (`uploaded_by`). Upload deal TIDAK lagi menanyakan Tipe Campaign/Ads Budget/Service Fee dan tidak menulis ketiga kolom itu. Upload Master Product List di tab Produk TAP juga tidak menanyakannya → kolom-kolom itu tak disentuh.
- **Ads Budget & Service Fee = nominal per PASANGAN (project, shop)**, disimpan di `bd_project_shop_budgets` (migrasi 0046, PK (project_id, shop_key), FK komposit ke `bd_project_shops` on delete cascade). Satu shop bisa punya nominal berbeda di tiap project (DVARA di project "alya 2" ≠ DVARA di project lain). Keduanya TIDAK punya kolom di tabel Produk TAP dan BUKAN atribut kartu: `products_tap.ads_budget`/`service_fee` DEPRECATED sejak 0046 — jangan dibaca, jangan ditulis. SATU-SATUNYA tempat entri = tombol Edit per shop di detail tab **Project BD** (`updateProjectShopBudget` + `mergeShopBudget()`); form Registrasi Deal, upload deal, Edit Produk TAP, dan Edit shop Deal Brand tidak menyentuhnya. Deal by, PIC TAP, dan Nama BD (`uploaded_by_ids`, migrasi 0045; kolom Nama BD tunduk izin `products.view_owner_name`) tetap dibaca per shop dari view.
- Tab Deal Brand = SATU tabel "Shop" dari view `deal_shop_summary` (migrasi 0046/0047, mengganti `products_tap_shop_summary`; agregasi di SQL, bukan JS). Isinya: kartu `products_tap` diringkas per `shop_key`, DITAMBAH shop yang baru ada di `brand_deals` (deal terdaftar, kartu belum → `product_count=0`, bertanda "deal", namanya tertaut ke `/deals/{deal_id}`); begitu kartu produknya turun keduanya MELEBUR ke satu baris, karena `brand_deals.shop_key` (generated, 0047) memakai ekspresi yang sama dengan `products_tap.shop_key` (0043) — jangan pernah menyalin ekspresi itu ke filter aplikasi (CLAUDE.md #4). Kolom **Ads Budget & Service Fee = TOTAL `bd_project_shop_budgets` lintas project** untuk shop itu. Tombol Edit per baris menulis Shop ID & Tipe Campaign ke SELURUH kartu DAN seluruh baris deal shop itu (satu-satunya jalan mengisi Shop ID deal yang produknya belum turun, karena halaman detail deal tidak punya form edit); kolom lain berbeda per produk, dan kedua nominal dikelola di Project BD. Aturan Paid Campaign tidak ditegakkan di jalur ini.
- Validasi form tetap ketat untuk yang DIISI: shop_id & product_id numeric; tanggal = date picker (bukan teks "19 February 2026"); komisi = number% 0–100; Rupiah → number murni. Aturan dipakai bersama server & klien lewat `lib/deals/product-card.ts` + `lib/deals/campaign-type.ts`.
- Tanpa Product ID → dipakai ID internal `PRD-xxxxx` + `needs_review=true` (kartu tak bisa dicocokkan ke data TAP mingguan). Kombinasi (campaign_id, product_id) yang sudah ada DITOLAK, bukan ditimpa (migrasi 0040).
- Tab **Project BD** (`/bd-projects`, migrasi 0044) = pengelompokan beberapa shop jadi satu campaign. Yang disimpan di `bd_projects`: nama, status, **status payment** (`done|proses_finance_payment|proses_finance_brand`, migrasi 0046), catatan, + daftar `shop_key`. Jumlah kartu, campaign, GMV, exp date DIBACA dari `deal_shop_summary` — jangan pernah menyalin angka itu ke `bd_projects`. Ads Budget & Service Fee dibaca dari `bd_project_shop_budgets` untuk PROJECT ITU (detail & daftar project menampilkan angka project sendiri, bukan total shop lintas project). Daftar shop disinkron sebagai SELISIH (hapus yang keluar + tambah yang masuk), BUKAN hapus-lalu-tulis-ulang: FK cascade akan menghapus semua nominal project tiap kali namanya diubah. Nominal shop yang dikeluarkan dicatat dulu ke audit_logs sebelum hilang. Tracking report campaign (report performance & Creator TC & Celeb) memakai tabel + parser yang SAMA dengan detail deal (`lib/deals/report-actions.ts`), bedanya kolom pemilik: tepat satu dari (`deal_id`, `project_id`) terisi. Template .xlsx kedua upload dibangun dari daftar kolom yang sama dengan yang dibaca parser (`lib/deals/report-template.ts`, dijaga test round-trip) — jangan menulis header template di tempat lain.
- Produk yang DIKERJASAMAKAN pada sebuah project = centangan di detail project, disimpan sebagai kunci `(campaign_id, product_id)` di `bd_project_products` (migrasi 0045). Hanya kuncinya: harga/komisi/masa berlaku tetap dibaca dari `products_tap`. Daftarnya ditulis ulang utuh tiap simpan (form mengirim keadaan akhir), sama seperti daftar shop.
- `brand_deals` (tab Deal Brand) = sumber deal lama DAN deal baru yang produknya belum diketahui: diisi Import Master Deal, form Registrasi Deal jalur shop-saja (`registerShopDeal`), dan form Edit deal. Dari sanalah exp_date sinkron ke cooperating_shops.deal_end untuk alert kadaluarsa M4. Baris yang lahir dari Registrasi Deal TIDAK mewarisi default `campaign_type = 'paid'` — nilainya ditulis null eksplisit, karena tipe campaign tidak ditanyakan.
- Jadwal Live (M13): pertanyaan "Link ke deal (opsional)" di form slot memilih SHOP dari tabel "Shop" di tab Deal Brand (view `deal_shop_summary`) dan menyimpannya di `live_schedule_slots.shop_key` (= `products_tap.shop_key`, migrasi 0045) — bukan `deal_id`, yang tetap ada untuk slot lama. Kalau kartu shop itu punya `pic_tap`, jadwalnya muncul sebagai notifikasi (badge sidebar `/schedule` + panel di halamannya) di akun PIC TAP tersebut; hitungannya dari sumber, tidak disimpan (`lib/schedule/pic-tap-alerts.ts`).

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
