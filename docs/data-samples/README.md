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
