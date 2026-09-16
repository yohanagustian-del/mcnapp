# Data Samples — struktur kolom nyata dari platform TikTok

Data platform = AGREGAT per (product_id, shop_id, period), bukan per-transaksi.

## CSV-1: All Transactions (semua promosi creator)
Kolom: Date(period range) | Comparison date | Product ID | Product info | Shop ID | Shop name |
Level 1 category | Level 2 category | Affiliate GMV | Affiliate LIVE GMV | Affiliate video GMV |
Affiliate orders | Affiliate LIVE orders | Affiliate video orders | Direct GMV | ... | CTR | CTOR
- Baris pertama = "Summary" (SKIP saat ingest).
- Date format: "2026-06-03-2026-06-30" (period_start-period_end).
- GMV format: "Rp2.263.353.095" → parseRupiah.

## CSV-2: Agency-Link Transactions (subset via agency link MEA)
Kolom: Date | ... | Product ID | Product name | Shop ID | Shop name | Level 1 | Level 2 |
Affiliate GMV | Affiliate video GMV | Affiliate LIVE GMV | Orders | Collaborated creators |
Estimated/Actual affiliate partner commission | Estimated/Actual creator commission | ...
- partner commission = kandidat rate MEA (KONFIRMASI: porsi MEA atau creator?).

## Master: Cooperating Shops (shop kerjasama MEA)
Kolom: Shop ID | Shop Name | Level 2 Categories (Unique) | Total Collaborated Creators
- TIDAK ada deal_end → durasi deal dari BizDev/kontrak.
- Join ke transaksi via Shop ID.

## JOIN M4
CSV-1 ⋈ CSV-2 on (product_id, shop_id) → gmv_bocor = affiliate_gmv[all] − affiliate_gmv[agency].
shop_id ∈ cooperating_shops → ber-deal (bocor relevan); else → LEAD.

## Creator
File 1-creator: tanpa kolom creator. File multi-creator: ada kolom creator_name.

---

## Multi-creator report (TAP & MCN) — struktur
Sama seperti CSV di atas TAPI + kolom **Creator name** dan metrik: Video views, LIVE views, LIVE streams, Videos.
- 1 file bisa banyak creator (vikahere, taniaputri1707, ...). Resolve creator_name → CRT-xxxxx.
- TAP report = MCN report (struktur identik, 1 parser).
- Baris "Summary" pertama → SKIP.

## Master Deal Internal (all brand) — sumber deal_end & rate komisi
Dibuat MANUAL saat kontrak sign. BERANTAKAN (alasan platform ini dibuat). Kolom:
Nama Brand | SHOP ID | Niche | GMV TAP | Avg Harga | Tim Handler | PIC TAP | PIC ABP |
Ads Brand | Bobot ABP | Leads | Bobot(B0/B1/B2) | Diterima/Ditolak | Priority(P0-2) |
Status(Running/Hold/Done) | Campaign Name | Campaign ID | **Exp Date** | Countdown |
Link TAP | Contact PIC | Nama Grup | **Komisi Kreator** | **Komisi Mea** | Openplan | Action | Notes | Shop Code

**Ini menjawab 2 blocker:**
- Exp Date → deal_end (durasi deal) → sinkron cooperating_shops → alert kadaluarsa M4.
- Komisi Mea → rate untuk potensi komisi M5.

**Data kotor yang HARUS ditangani parser (contoh nyata):**
- Rupiah campur: "Rp1,075,484,867" vs "Rp4.131.512.642"
- Exp date teks: "19 February 2026", "1 June 2026"
- Komisi: "5-7%", "10-15%", "not found", "error", "not yet", kosong
- Countdown negatif (-98) = sudah lewat exp date
- Banyak sel kosong → jangan crash, flag review

**→ Deal BARU wajib lewat FORM tervalidasi (M8) supaya tidak berantakan lagi.**

---

## M7 v2 — TikTok LIVE Center sesi (Fase 1A, dikonfirmasi 16 Sep 2026)

2 kreator, 1 sesi masing-masing (`haikalpratama136`, `beayik`) — file asli dari
Google Drive, bukan asumsi PRD. Kolom sheet **sama persis** dengan yang sudah
diasumsikan `src/lib/m7/live-parse.ts` (tidak perlu perbaikan alias kolom).

**Product** (sumber GMV sesi, §10.2 V6): `Product ID, Product name, Attributed
GMV, Attributed items sold, Customers, AOV, Attributed SKU orders, Attributed
orders, Payment Rate, Product Impressions, CTR, Added to cart, CTOR (SKU
orders), CTOR, Watch GPM, Product Clicks, Available stock`.

**Trend Stat** (timeline per interval, bukan sumber GMV): `Time, Attributed
GMV, Attributed items sold, Customers, Attributed SKU orders, Attributed
orders, Viewers, Views, Product Impressions, LIVE CTR, Tap-through rate,
Product Clicks, Impressions, New followers, Shares, Comments, Likes, Comment
rate, Follow rate, Like rate, Share rate, AOV, CTOR (SKU orders), Watch GPM,
CTOR, Payment Rate, Show GPM, Order rate (SKU orders)`.

**Nama file — TERNYATA BEDA dari asumsi PRD** (PRD menduga
`{user}_{product|trend_stats}_Sesi_{n}__{d}_{Bulan}_{yyyy}.xlsx` dengan
underscore ganda sebelum tanggal; kenyataannya pakai koma, dan pemisah
username↔kind tidak konsisten antar akun pengunggah):
- `haikalpratama136 Product sesi 1, 15 September 2026.xlsx` (spasi sebelum kind)
- `haikalpratama136 Trend Stat Sesi 1, 15 September 2026.xlsx`
- `beayik_product Sesi 1, 15 September 2026.xlsx` (underscore sebelum kind)
- `beayik_trend stats Sesi 1, 15 September 2026.xlsx`

`src/lib/m7/live-filename.ts` sudah diperbaiki (16 Sep 2026) untuk menerima
kedua bentuk ini sekaligus bentuk lama yang diasumsikan PRD — lihat komentar
di file itu dan `__tests__/live-filename.test.ts` untuk detail regex-nya.

**Belum ada sampel** untuk Fase 1B (export harian `mcn_tiktok_product`,
`tap_tiktok_product`, `mcn_tiktok_live`, `tap_tiktok_live`, `shopee`) — ini
file per-SESI single-creator (Fase 1A), bukan file agregat harian
multi-creator/multi-shop yang dibutuhkan Fase 1B (lihat struktur "Multi-creator
report" di atas untuk perbandingan bentuknya).
