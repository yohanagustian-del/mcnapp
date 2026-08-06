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

### 3. Read-only = field bersumber PLATFORM (jangan bikin endpoint edit)
- `agency_links.link_status` → diisi engine M4 dari upload mingguan. TIDAK ADA edit manual, siapa pun.
- `creators.commission_share` → sync dari platform. Read-only. Turun = alert.
- **BATAS aturan ini (direvisi 2026-08-04):** read-only absolut hanya untuk field yang DIHITUNG
  engine atau DISYNC dari platform — di situ edit manual = memalsukan data platform.
- Catatan internal atas kesepakatan dengan pihak luar (mis. transaksi finance: metode & tujuan
  pembayaran klien) BUKAN data platform. Kesepakatan memang bisa berubah → boleh diubah, TAPI
  lewat jalur approval (#9), bukan UPDATE langsung dan bukan edit di DB.

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
- Field wajib: brand_name (sesuai display platform), shop_id, niche, exp_date (→ deal_end), komisi_kreator, komisi_mea, pic_tap, campaign_name.
- Validasi form: shop_id numeric & unik; exp_date = date picker (bukan teks "19 February 2026"); komisi = number% (tolak "not found"/"error"/kosong; range "5-7%" → min & max terpisah); Rupiah → number murni.
- exp_date deal → sinkron ke cooperating_shops.deal_end untuk alert kadaluarsa M4.

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

### 9. Transaksi finance BOLEH diubah — lewat change request + approval Director (M14, baru 2026-08-04)
Klien nyata mengubah metode/rekening pembayaran setelah transaksi tercatat. Sebelum aturan ini
satu-satunya jalan adalah edit langsung di DB — tanpa jejak, tanpa persetujuan. Aturan barunya:
- **Pengaju**: Senior/Lead Finance (role `finance_lead`) + management. Staff `finance` TIDAK boleh
  mengajukan — hanya mencatat transaksi baru & membaca.
- **Pemutus**: Director SAJA (`finance.approve_change`). Head/SPV pun tidak.
- **Pengaju ≠ pemutus** — ditegakkan di `apply_finance_change()`, bukan hanya di server action:
  izin "ajukan" mencakup management (termasuk Director), jadi tanpa itu Director bisa
  mengajukan lalu menyetujui pengajuannya sendiri dan gate-nya tak berarti apa-apa.
- **Field terkunci** (nominal, metode, termin, status bayar, bank/rekening/nama pemilik, invoice,
  jatuh tempo, pihak terkait) → masuk `finance_transaction_changes` status `menunggu`; nilai lama
  tetap berlaku sampai Director approve. Daftarnya dari `app_config finance.guarded_fields`.
- **Field bebas** (keterangan) → berlaku langsung + audit `auto` (tidak merugikan, #2).
- **TIDAK ADA UPDATE langsung** ke field terkunci. Penegakan di DB (trigger
  `guard_finance_txn_update`), bukan cuma di server action — server action pakai service-role
  yang bypass RLS, jadi trigger adalah penjaga yang tak bisa dilewati. Satu-satunya jalur yang
  boleh menyentuhnya: `apply_finance_change()`, dipanggil setelah approval Director.
- Satu transaksi maksimal SATU pengajuan `menunggu` (unique index) — kalau tidak, dua pengajuan
  yang bertentangan bisa di-approve berurutan dan yang terakhir menang diam-diam.
- Semua tahap (ajukan / approve / tolak / batal) → `audit_logs` type `approval`.

## Konvensi kode
- DB: snake_case. Kode: camelCase. Komponen: PascalCase.
- ID entity: `CRT-`, `DEAL-`, `LNK-` (text PK, generate util terpusat).
- Semua threshold dari tabel `app_config` — JANGAN hardcode angka (15%, 65jt, dll ada di sana).
- Rupiah: strip "Rp", titik=ribuan(hapus), koma=desimal(→titik). Util `parseRupiah()`.
- Semua mutasi entity material → tulis audit_logs.
- UI label Bahasa Indonesia; kode/komentar Bahasa Inggris.

## Enum penting (lihat migration untuk lengkap)
- role: director|head|spv|cm_lead|cpm|bizdev_lead|bizdev|campaign_ops|bd_admin|acquisition_lead|acquisition_spec|campaign_external|creator_support|finance_lead|finance|ads_support|od_viewer
- link_status: via_agency|bocor_sebagian|bocor_total|belum_ada_link
- finance_payment_method: transfer_bank|virtual_account|ewallet|qris|kartu_kredit|tunai|potong_komisi
- finance_change_status: menunggu|approved|ditolak|dibatalkan
- price_segment: low(<180k)|entry(180k-800k)|sweet(800k-3.6jt)|high(3.6jt-8jt)|premium(>8jt)

## RBAC
- Enforce di server (RLS + middleware), bukan cuma UI.
- Management lihat cross-team; Lead lihat tim; staff lihat scope sendiri; Finance lihat dimensi pembayaran.
- Director = owner konfigurasi OKR (target + reward) via Dashboard Director, DAN satu-satunya
  pemberi approval perubahan transaksi finance (#9).
- Divisi Finance dua tingkat: `finance_lead` (Senior/Lead — boleh mengajukan perubahan transaksi)
  dan `finance` (staff — catat & baca saja).
- `/finance/transactions` ditutup untuk `od_viewer`: baris transaksi memuat rekening tujuan,
  di luar cakupan oversight OD (RLS 0032).

## Urutan kerja
Ikut `docs/BUILD_PLAN.md`. Fase 0 (fondasi) blocking semua. Jangan lompat fase.
Sebelum coding M4/M5/M6: cek `docs/BUILD_PLAN.md` bagian "BLOCKER" — ada keputusan data yang harus dikunci dulu.

## Definition of done per task
- Type-safe, RLS aktif, audit_logs tertulis untuk mutasi, threshold dari app_config, tidak ada LLM di jalur deterministik.
