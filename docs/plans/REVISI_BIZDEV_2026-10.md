# Plan Build — Revisi MCN APP: BizDev Workspace, TAP Matchmaking, Report Brand (2026-10)

Sumber request: Google Doc "Revisi MCN APP" (1VbfS53WjEY_Ag2LgpapC_Zad6UsfBYsSMD8Wb7rm0z8), dibaca 2026-10-12.
Dokumen memuat **2 gambar yang tidak terbaca tool** (gambar "segmentasi harga semuanya 0" dan contoh
tampilan Report Kreator). Akar masalah segmentasi dipastikan lewat query ke database produksi, bukan
dari gambar.

Status: **DISETUJUI dengan keputusan interview 2026-10-12** (Q1–Q6 semuanya dijawab langsung oleh user,
lihat §0; Q1–Q4 ditanyakan dua kali karena salah klik, jawabannya sama). Siap dieksekusi T1 → T10.

---

## 0. Keputusan interview (dijawab user 2026-10-12 — jangan re-interview)

| # | Pertanyaan | **Keputusan** | Konsekuensi di tiket |
|---|---|---|---|
| Q1 | Di mana BizDev di-assign ke brand (maks 2 orang)? | **Keduanya**: tombol Edit per baris Shop di tab Deal Brand (+ pertanyaan opsional di Registrasi Deal) untuk koreksi harian, DAN upload Excel massal untuk pengisian awal. Seed otomatis dari `deal_by`/`created_by` tetap dilakukan. | T5 bertambah importer `uploadBrandBizdevHandlers` + template .xlsx (kolom: Shop ID / Shop Name / BizDev 1 / BizDev 2), pola yang sama dengan `uploadPartnershipStatus`: spec + template satu file, dijaga test round-trip. |
| Q2 | Periode angka di summary BizDev & TAP Matchmaking? | **Bulan berjalan + pemilih periode** (bulan lain / minggu W1–W5). | T6, T7, T9 memakai pemilih periode yang sama (`lib/m8/period.ts`, satu util). |
| Q3 | Report Brand v2: ganti total jalur upload file manual? | **Ganti total, 0 LLM.** Jalur upload file & ringkasan LLM dihapus; report lama (schema v1) tetap bisa dibuka read-only. | T9 menghapus `brand-report-form.tsx`, `generateBrandReport` lama, dan `lib/m8/brand-summary.ts`. |
| Q4 | Shopee di TAP Matchmaking & GMV TAP? | **Fase 1 = TikTok saja.** Shopee tampil GMV MCN-nya dengan label "GMV TAP belum tersedia untuk Shopee". Kolom penanda order SAP di laporan Shopee belum dipastikan. | T4 menulis `gmv_tap = null` untuk baris Shopee; T6/T7 menampilkan label, bukan 0. Tiket lanjutan Shopee dibuka setelah kolomnya dipastikan. |
| Q5 | Segmen harga TikTok untuk baris `items_sold = 0` tapi `orders > 0` (±17% GMV mingguan)? | **Ya, pakai `gmv/orders`** sebagai pendekatan harga, ditandai di komentar + test. | T2 langkah 4. |
| Q6 | Backfill: agregat per shop & segmen Shopee hanya terisi untuk upload berikutnya (raw dibuang). | **Ya, upload ulang September W1–W5** (file masih ada, baru diupload ulang 2026-10-05) setelah T4 rilis. Ingest idempotent per (kreator × minggu). | T10 langkah 3. Sampai backfill selesai, UI menampilkan "data periode ini belum diupload dengan versi baru". |

---

## 1. Ringkasan request dokumen → tiket

| Request di dokumen | Tiket | Catatan |
|---|---|---|
| Section paling atas BizDev Workspace: summary per BizDev (brand dihandle, GMV MCN, GMV TAP, actual revenue partner, % TAP/MCN) + tabel breakdown | T3, T4, T5, T6 | Butuh 2 data yang **belum ada**: (a) siapa BizDev per brand, (b) GMV per shop dari file mingguan. Lihat §3. |
| 1 brand bisa dihandle 2 BizDev; tanpa assign → label "Non BD Handle" | T3, T5 | Tabel baru `brand_bizdev_handlers`. |
| Ganti label "Routing Req Campaign → CM Pemilik Creator" → "Request Creator Brand Deals" | T1 | Teks saja. |
| Fitur baru TAP Matchmaking (input Shop ID / nama toko → kreator, GMV TAP, GMV MCN, gap, CM, sumber live/video, kreator yang belum pakai TAP) | T4, T7 | Data dari agregat per (kreator × shop × periode) — T4. |
| Segmentasi harga semuanya 0 — cek error | T2 | **Bug dikonfirmasi** di produksi (§2). |
| Brand Lead Bank → langsung jadi Deal Brand tanpa isi ulang | T8 | Prefill Registrasi Deal + tautan otomatis. |
| Hapus section Pipeline Deal Brand dari BizDev Workspace | T1 | Kolom `pipeline_stage` dibiarkan. |
| Report Brand otomatis dari data upload, seperti Report Kreator; menu kiri terpisah; section di workspace dihilangkan | T9 | Report Brand v2, 0 LLM, menu "Report Brand" di grup BizDev & Deal. |
| Audit letak menu sidebar vs pemakainya | T1 | Temuan di §4. |

---

## 2. Bug "segmentasi harga semuanya 0" — akar masalah (dikonfirmasi SQL produksi 2026-10-12)

Tabel `creator_subcat_segment_gmv` (sumber Matriks Kategori × Segmen di `/creators/[id]`, profil
kreator di Creator Product Match, pool BD Value Predictor, Kapasitas Kreator PX):

| Sumber baris | Baris | `price_segment` null | GMV di baris null |
|---|---|---|---|
| Ingest TikTok (`ingest:*`) | 265.101 | 203.968 (77%, mayoritas GMV 0) | ±17% GMV minggu penuh |
| Ingest Shopee (`ingest-shopee:*`) | 124.928 | **124.928 (100%)** | **100%** (Rp113 M) |

Kreator aktif: **1.488 Shopee vs 1.109 TikTok** — lebih dari separuh kreator memang tidak pernah
punya segmen harga. Window terbaru (2026-10-07) 100% Shopee → semua 0.

Tiga penyebab di kode:

1. **Parser Shopee tidak membaca harga** (`src/lib/ingest/shopee-csv.ts`): export Shopee
   Conversion Report PUNYA kolom `Qty` dan `Harga(Rp)` (terlihat di fixture test
   `shopee-csv.test.ts` baris 12) tapi `SHOPEE_COLUMNS` tidak memetakannya, lalu
   `buildShopeeSubcatSegment()` (`shopee-aggregate.ts`) menulis `priceSegment: null`,
   `itemsSold: 0`, `avgPrice: null` untuk SEMUA baris — dengan komentar "tidak ada price/quantity di
   laporan Shopee", yang ternyata keliru.
2. **Baris Shopee tersimpan sebagai `platform = 'tiktok'`**: kolom `platform` ditambahkan migrasi
   0078 (default `'tiktok'`) SETELAH `writeShopeeAggregates()` (`shopee-run.ts`) ditulis, dan
   fungsi itu tidak pernah mengisi `platform` di `creator_period_summary` maupun
   `creator_subcat_segment_gmv`. Akibatnya agregat Shopee tercampur ke TikTok di setiap query yang
   memfilter platform.
3. **TikTok: baris `items_sold = 0` tapi `orders > 0`** → `buildSubcatSegment()` (`aggregate.ts`)
   memberi segmen null. Pendekatan `gmv/orders` bisa dipakai sebagai cadangan (Q5).

Perbaikan ada di **T2**. Backfill segmen Shopee butuh upload ulang file (Q6); backfill `platform`
bisa lewat SQL (`upload_batch like 'ingest-shopee:%'`).

---

## 3. Data yang belum ada untuk summary BizDev & TAP Matchmaking

Pipeline mingguan (`/ingest`) saat ini membuang grain per **shop**:

- `creator_period_summary` = per kreator × minggu (tanpa shop).
- `creator_top_products` = top-N produk per kreator (ada `shop_id`, tapi hanya N teratas — tidak
  lengkap untuk menjumlah GMV per shop).
- `products_tap` (derive TAP) = per produk, **tanpa kreator**.
- Analisa bocor M4 (`lib/m4/leak-compute.ts`) sudah menghitung per (kreator × shop × produk)
  `gmvAll` vs `gmvTap` di memori, tapi keputusan lama "rollup saja": hanya `creator_link_status`
  (per kreator) + `bd_leads` (per shop non-deal) yang disimpan; detailnya cuma CSV backup di storage.
  `leakage_products` kosong (0 baris) dan tidak diisi lagi.
- Komisi partner aktual (`actual_affiliate_partner_commission` di file TAP) **diparse tapi tidak
  disimpan di mana pun**.

Maka dibutuhkan SATU tabel agregat baru yang ditulis saat ingest dari baris MCN + TAP yang sama
(tanpa parse ulang, CLAUDE.md #4), grain **kreator × shop × periode**:

```
creator_shop_period_gmv (migrasi 0087)
  platform, creator_id, shop_id, shop_name, period_start, period_end, upload_batch,
  gmv_mcn, gmv_mcn_live, gmv_mcn_video, orders_mcn, items_sold_mcn,
  gmv_tap, gmv_tap_live, gmv_tap_video, orders_tap,
  est_partner_commission, actual_partner_commission,
  est_creator_commission, actual_creator_commission
  PK/unik (platform, creator_id, shop_id, period_start, upload_batch)
```

Dari tabel ini **dua fitur** dilayani tanpa hitung ulang:
- Summary per BizDev = SQL: shop → `shop_key` (lewat `products_tap.shop_id`/`brand_deals.shop_id`,
  join di SQL, bukan menyalin ekspresi shop_key ke aplikasi) → `brand_bizdev_handlers` → sum per
  BizDev. Shop tanpa handler = "Non BD Handle".
- TAP Matchmaking = filter `shop_id`/`shop_name` → baris per kreator; `gmv_tap > 0` = "pakai TAP",
  sisanya "belum pakai TAP"; sumber = pecahan live/video.

Catatan jujur ke UI: baris dari batch lama tidak ada → tampilkan "data periode ini belum diupload
dengan versi baru", bukan nol (pola yang sama dengan `creator_top_products` di CLAUDE.md #5).

---

## 4. Audit sidebar: letak menu vs pemakainya

Sumber: `NAV_ITEMS`/`PERMISSIONS` di `src/lib/rbac-constants.ts`, gate per halaman di
`src/app/(portal)/**/page.tsx`.

| Menu | Grup sekarang | Temuan | Tindakan (T1) |
|---|---|---|---|
| **Creator Product Match** `/matching` | BizDev & Deal | Nav memberi `bizdev_lead`/`bizdev`, tapi izin menjalankannya `m5.run` = Management + CM saja → BizDev melihat menu lalu dapat pesan "tidak punya izin". Alatnya milik CM (PRD M5 §2.5). | Pindah ke grup **Creator Management**, roles = Management + CM; tambah redirect `canAccessNav` di halaman; perbaiki teks "(CPM/CM Lead/Management/BizDev)". |
| **Special Project (M7)** `/projects` | Project & Campaign | Nav hanya lead + management + campaign_ops + finance, padahal `m7.curate` (cpm, bizdev, acquisition_spec), `m7.report_insight_edit` & `m7.participant_notes` (semua staff, keputusan 2026-09-28/30) memberi hak ke role yang menunya **tidak tampil** — mereka harus mengetik URL. | Perluas roles nav ke semua role di `m7.curate` ∪ `m7.participant_notes` (kecuali `od_viewer`). |
| **Upload Data Platform Mingguan** `/ingest` | Data Platform | `m4.upload` memberi `campaign_ops`, nav tidak. | Tambah `campaign_ops` ke nav, atau cabut dari `m4.upload` — pilih tambah nav (lebih kecil). |
| **Perpanjangan Kreator** | Akuisisi | CM ikut punya akses (Q7 Paket D) sehingga CPM melihat grup "Akuisisi" berisi satu menu. Bukan salah, hanya membingungkan. | Biarkan; alternatif: tautan di CM Workspace sudah ada. Tidak diubah. |
| **External Workspace** | Project & Campaign | Pemakainya `campaign_external` + BizDev view. Grup tidak salah secara fungsi. | Tidak diubah. |
| **Report Brand** (baru) | — | Dokumen minta menu terpisah seperti Report Kreator. | Tambah `/brand-reports` di grup **BizDev & Deal**, roles = `m8.brand_report` (Management + bizdev_lead + bizdev). (T9) |
| **TAP Matchmaking** (baru) | — | Alat BizDev. | Tambah `/tap-matchmaking` di grup **BizDev & Deal**, roles = Management + `BIZDEV_ROLES`. (T7) |
| Label role di layout | — | `ROLE_LABELS` di `(portal)/layout.tsx` tidak punya `ads_support` & `od_viewer` → tampil kode mentah. | Tambah dua label. |
| Dasbor `/dashboard` | Umum | Masih menampilkan teks "Status Fase 0 … M4/M2 menyusul di Fase 1". | Ganti jadi ringkasan netral (di luar scope dokumen, kecil, ikut T1). |

Yang sudah sesuai (tidak diubah): Deal Brand, Registrasi Deal, Project BD, Import Master Deal,
Brand Lead Bank (CM lihat saja), Produk TAP (CM & BizDev sama-sama mengunggah), BD Value Predictor
(`m6.run` = nav), Kapasitas Kreator PX, Jadwal Live, Report Kreator, Link Leakage, Ads Support,
Acquisition Workspace, Tim, Config OKR, OD Oversight, Retensi Data.

---

## 5. Tiket (1 tiket = 1 PR, urutan ketergantungan)

| Tiket | Judul | Blokir | Migrasi | Butuh jawaban |
|---|---|---|---|---|
| T1 | Nav audit + label "Request Creator Brand Deals" + hapus section Pipeline | — | tidak | — |
| T2 | Fix segmentasi harga: parser Shopee baca Qty/Harga + platform Shopee + cadangan gmv/orders | — | SQL backfill `platform` saja (tanpa DDL) | Q5 ✔ |
| T3 | Migrasi 0087: `creator_shop_period_gmv`, `brand_bizdev_handlers`, `brand_reports` v2 | — | file saja | Q1, Q3 ✔ |
| T4 | Ingest menulis `creator_shop_period_gmv` (TikTok MCN+TAP; Shopee MCN saja) | T3 | — | Q4 ✔ |
| T5 | Assign BizDev per brand (maks 2): Edit per baris + upload Excel + badge "Non BD Handle" | T3 | — | Q1 ✔ |
| T6 | BizDev Workspace: section summary per BizDev + tabel breakdown (paling atas) | T4, T5 | — | Q2 ✔ |
| T7 | Halaman TAP Matchmaking `/tap-matchmaking` | T4 | — | Q2, Q4 ✔ |
| T8 | Brand Lead Bank → Registrasi Deal (prefill + tautan otomatis) | — | tidak | — |
| T9 | Report Brand v2 `/brand-reports` (otomatis dari data mingguan, 0 LLM) + hapus section di workspace | T3, T4 | — | Q3 ✔ |
| T10 | FINAL: apply 0087 (staging → prod via `apply_migration`), backfill, HANDOFF/CLAUDE.md | semua | apply | Q6 ✔ |

### Status tiket (diperbarui di PR tiap tiket)

| Tiket | Branch | PR | Status |
|---|---|---|---|
| T1 | `claude/revisi-bizdev-t1-nav-audit` | #106 | merged |
| T2 | `claude/revisi-bizdev-t2-segmentasi-harga` | #107 | merged (backfill `platform` menunggu T10) |
| T3 | `claude/revisi-bizdev-t3-migrasi-0087` | #108 | merged (file saja; apply di T10) |
| T4 | `claude/revisi-bizdev-t4-ingest-shop-period` | #109 | merged (tulis tabel aktif setelah 0087 di-apply; sebelum itu dilewati dengan pesan) |
| T5 | `claude/revisi-bizdev-t5-bizdev-handler` | #110 | merged (aktif setelah 0087 di-apply; seed handler di T10) |
| T6 | `claude/revisi-bizdev-t6-summary-bizdev` | #111 | merged (angka muncul setelah 0087 di-apply + upload ulang) |
| T7 | — | — | belum |
| T8 | — | — | belum |
| T9 | — | — | belum |
| T10 | — | — | belum (migrasi 0087: staging ✗ · production ✗) |

### T1 — Nav audit + label + hapus Pipeline
- **File:** `src/lib/rbac-constants.ts`, `src/app/(portal)/layout.tsx`,
  `src/app/(portal)/matching/page.tsx`, `src/app/(portal)/workspace/bizdev/page.tsx`,
  `src/app/(portal)/workspace/bizdev/actions.ts`, `src/app/(portal)/workspace/bizdev/pipeline-table.tsx`
  (hapus), `src/lib/m8/routing.ts` (`PIPELINE_STAGES`/`PipelineStage` hapus bila tak dipakai lagi),
  `src/app/(portal)/dashboard/page.tsx`, test `src/lib/__tests__/rbac.test.ts` & `nav-ui.test.ts`.
- **Langkah:**
  1. `/matching`: `group: "Creator Management"`, `roles: [...MANAGEMENT_ROLES, ...CM_ROLES]`;
     halaman redirect ke `/dashboard` bila `!canAccessNav`. Teks izin disesuaikan.
  2. `/projects`: roles = gabungan `PERMISSIONS["m7.curate"]` ∪ `PERMISSIONS["m7.participant_notes"]`
     (semua kecuali `od_viewer`). Tambah test: setiap role di `m7.curate` bisa `canAccessNav(/projects)`.
  3. `/ingest`: tambah `campaign_ops`.
  4. `ROLE_LABELS`: `ads_support: "Ads Support"`, `od_viewer: "OD Viewer"`.
  5. BizDev Workspace: judul section "Routing Req Campaign → CM Pemilik Creator" →
     **"Request Creator Brand Deals"** (judul saja; deskripsi 3 kolom tetap). Hapus section
     "Pipeline Deal Brand", komponen `PipelineTable`, action `setPipelineStage`, dan izin
     `m8.pipeline` (tidak ada pemakai lain). Kolom `brand_deals.pipeline_stage` DIBIARKAN (data
     lama), catat di CLAUDE.md #6.
  6. Dasbor: ganti paragraf "Status Fase 0" dengan tautan ke workspace sesuai role.
- **Test:** rbac/nav test diperbarui; `npx tsc --noEmit`, `npx vitest run`.

### T2 — Fix segmentasi harga
- **File:** `src/lib/ingest/shopee-csv.ts`, `shopee-aggregate.ts`, `shopee-run.ts`,
  `aggregate.ts` (TikTok), test `__tests__/shopee-*.test.ts`, `aggregate.test.ts`;
  SQL backfill (dijalankan via `execute_sql`, bukan migrasi DDL).
- **Langkah:**
  1. `SHOPEE_COLUMNS` + `ShopeeRow`: tambah `qty: "qty"`, `unitPrice: "harga(rp)"` (parse
     `parseRupiah`, qty integer; nilai kotor → null, jangan crash — CLAUDE.md #7).
  2. `buildShopeeSubcatSegment()`: segmen per baris = `priceSegmentOf(unitPrice, bounds)` bila harga
     terbaca, else `gmv/qty`, else null; `itemsSold += qty`; `avgPrice = gmv/itemsSold`. Kunci grup
     ikut segmen (sama persis dengan `buildSubcatSegment` TikTok). `bounds` dari
     `segments.price_bounds` (sudah dibaca TikTok — pakai loader yang sama).
  3. `writeShopeeAggregates()`: isi `platform: "shopee"` di `creator_period_summary` DAN
     `creator_subcat_segment_gmv`; `items_sold` period summary = Σ qty.
  4. TikTok `buildSubcatSegment()` (Q5): bila `items_sold = 0` dan `orders > 0`, segmen dari
     `gmv/orders`; `avg_price` ikut; tanpa kolom baru (cukup catat di komentar + test).
  5. Backfill SQL (T10): `update creator_subcat_segment_gmv set platform='shopee' where upload_batch
     like 'ingest-shopee:%'`; sama untuk `creator_period_summary`. Segmen Shopee lama hanya terisi
     lewat upload ulang (Q6).
  6. UI `/creators/[id]` Matriks & `ProductMatchView`: bila semua baris window terbaru tanpa segmen,
     tampilkan "Segmen harga belum tersedia untuk batch ini (upload ulang file periode ini)" —
     bukan tabel nol.
- **Verifikasi:** test fixture Shopee dengan Qty/Harga → segmen sesuai bounds; test platform
  tersimpan 'shopee'; query produksi setelah upload ulang: `null_seg` Shopee turun mendekati 0.

### T3 — Migrasi 0087 (file saja; apply di T10)
- **File:** `supabase/migrations/0087_shop_period_gmv_bizdev_handlers.sql`.
- **Isi:**
  1. `creator_shop_period_gmv` (kolom di §3) + index `(shop_id, period_start)`,
     `(creator_id, period_start)`, `(upload_batch)`; RLS select authenticated + **restrictive deny
     `is_creator_user()`** (CLAUDE.md #9 — jangan lupa); tulis via service role saja.
  2. `brand_bizdev_handlers (shop_key text, member_id uuid references team_members, assigned_by uuid,
     created_at, primary key (shop_key, member_id))` + trigger `check` maks 2 baris per `shop_key`
     (ditegakkan juga di server action). RLS: select authenticated, deny creator.
  3. View `shop_period_summary` (security_invoker): sum `creator_shop_period_gmv` per
     (platform, shop_id, period_start) + `creator_count`.
  4. View `bizdev_brand_perf` (security_invoker): `shop_period_summary` ⟕ shop_key (via
     `products_tap`/`brand_deals` `shop_id → shop_key`, distinct) ⟕ `brand_bizdev_handlers`;
     baris tanpa handler → `member_id null` (= "Non BD Handle").
  5. `brand_reports`: tambah `shop_key text`, `schema_version int default 1`, `edits_json jsonb`,
     `status text default 'draft'`, `finalized_by/finalized_at`; `deal_id` jadi nullable (report v2
     berbasis shop). Seed `app_config m8.brand_report_rules` (ambang insight, mis. %TAP rendah,
     pertumbuhan minggu-ke-minggu) — jangan hardcode.
  6. Seed `app_config m8.bizdev_summary` = `{ "default_period": "month" }` bila Q2 = bulan berjalan.
- **Catatan drift:** constraint `platform_alerts_alert_type_check` berbentuk `= ANY('{…}')` sejak
  0083 — migrasi ini TIDAK menyentuhnya.

### T4 — Ingest menulis `creator_shop_period_gmv`
- **File:** `src/lib/ingest/aggregate.ts` (fungsi murni baru `buildCreatorShopPeriod(mcnRows, tapRows)`),
  `run.ts` (langkah tulis, delete-then-insert per kreator × periode seperti `writeAggregates`),
  `shopee-aggregate.ts` + `shopee-run.ts` (gmv_mcn saja, kolom TAP null), test.
- **Aturan:** join TAP ke MCN per (creator_name, shop_id) dari baris yang SAMA dengan analisa
  bocor (tidak parse ulang). File TAP 1-kreator tanpa kolom creator → kreator dari konteks upload
  (CLAUDE.md #5). `actual_partner_commission` = Σ `actualPartnerCommission` baris TAP shop itu.
  Shopee: `gmv_tap` null (bukan 0) sampai Q4 dijawab.
- **Test:** round-trip MCN+TAP sample → Σ gmv_mcn per kreator = `creator_period_summary.affiliate_gmv`
  kreator itu (invariant), Σ gmv_tap = `CreatorLeakRollup.gmvTap`.

### T5 — Assign BizDev per brand (Q1: Edit per baris DAN upload Excel)
- **File:** `src/app/(portal)/deals/shop-edit-button.tsx`, `src/lib/deals/shop-edit.ts`,
  `src/app/(portal)/deals/actions.ts` (`setBrandBizdevHandlers`, `uploadBrandBizdevHandlers`),
  `deal-form.tsx` (+ pertanyaan "BizDev handler", opsional, maks 2),
  `src/lib/deals/bizdev-handler-spec.ts` (kolom + parser + template .xlsx dalam SATU file, dijaga
  test round-trip — pola `partnership-spec.ts`), `components/bizdev-handler-badge.tsx`, tombol
  "Upload BizDev Handler" di tab Deal Brand.
- **Aturan:** izin `deals.edit`; maks 2 member ber-role `BIZDEV_ROLES`; simpan sebagai selisih
  (hapus yang keluar + tambah yang masuk), audit_logs `type: auto`. Seed awal (T10, SQL): dari
  `products_tap.deal_by` dan `brand_deals.created_by` per shop_key bila ber-role BizDev.
- **Upload Excel:** kolom `Shop ID | Shop Name | BizDev 1 | BizDev 2` (nama BizDev dicocokkan ke
  `team_members.name` ber-role BizDev, tidak peka huruf besar/kecil). Shop dicari lewat `shop_id`
  dulu, lalu nama (SQL, bukan ekspresi shop_key di aplikasi). Shop tak ditemukan / nama BizDev tak
  dikenal → baris DILEWATI dan ditampilkan sebagai peringatan (bukan dibuat baru) — sama seperti
  `uploadPartnershipStatus`. Sel kosong = tidak mengubah assignment lama; isi file = keadaan akhir
  (2 nama menggantikan yang lama).
- **Tampilan:** kolom "BizDev" di tabel Shop (tab Deal Brand) dan detail deal; tanpa handler →
  badge abu "Non BD Handle".

### T6 — BizDev Workspace: summary per BizDev (section paling atas)
- **File:** `src/app/(portal)/workspace/bizdev/page.tsx`, komponen baru `bizdev-summary.tsx`
  (client, sort + paginasi memakai `components/table-controls.tsx`), `src/lib/m8/bizdev-summary.ts`
  (murni: dari baris view → kartu per BizDev).
- **Kartu per BizDev:** jumlah brand dihandle, GMV MCN, GMV TAP, Actual Revenue Partner,
  %TAP/MCN. Brand dengan 2 handler dihitung penuh di keduanya (bukan dibagi dua) — ditulis di
  keterangan. Baris "Non BD Handle" ikut tampil paling bawah.
- **Tabel breakdown:** satu baris per (BizDev × brand): semua kolom di atas + jumlah kreator +
  periode. Scope: `bizdev`/`campaign_ops`/`bd_admin` melihat semua (sama seperti tabel Shop); Lead
  & Management melihat semua.
- **Periode:** pemilih di URL (`?period=2026-10`), default bulan berjalan (Q2). Angka dari
  `bizdev_brand_perf`, bukan dihitung di JS.

### T7 — TAP Matchmaking `/tap-matchmaking`
- **File:** `src/app/(portal)/tap-matchmaking/page.tsx`, `actions.ts` (server action pencarian),
  `result-view.tsx`; `src/lib/m8/tap-matchmaking.ts` (murni: baris view → dua tabel + header);
  nav item + ikon di `nav-ui.ts`.
- **Input:** Shop ID atau nama toko (ILIKE per kata, pola `brandLeadSearchPatterns`), platform,
  periode. Lebih dari satu shop cocok → pilih dulu.
- **Output (sesuai tabel di dokumen):** header Total Creator (pakai TAP), Total GMV TAP, Total GMV
  MCN kreator pemakai TAP, Total GMV semua kreator di shop; tabel kiri = kreator pakai TAP (nama,
  GMV TAP, GMV MCN, GAP, CM pemilik, sumber live/video %); tabel kanan = semua kreator dengan
  GMV di shop (username, GMV, status "MCN" / "belum pakai TAP", CM). Kreator tanpa `owner_cpm_id`
  → "—". Ekspor CSV satu tombol.
- **Deterministik, 0 LLM.** Tidak ada tulisan ke DB kecuali audit `tap_matchmaking.search`
  (opsional, untuk OKR BizDev).

### T8 — Brand Lead Bank → Registrasi Deal
- **File:** `src/app/(portal)/leads/[id]/page.tsx`, `src/app/(portal)/deals/baru/page.tsx`,
  `deal-form.tsx`, `src/app/(portal)/deals/actions.ts` (`registerDealCard`/`registerShopDeal`),
  `src/app/(portal)/leads/actions.ts` (`markLeadConverted` dipakai ulang).
- **Langkah:**
  1. Tombol **"Daftarkan jadi Deal Brand"** di `/leads/[id]` → `/deals/baru?lead_id=…`.
  2. `deals/baru/page.tsx` membaca lead (gate `leads.view`), mengirim `defaults` ke `DealForm`:
     Shop Name ← `shop_name`, Deal by ← akun login bila ber-role BizDev, BizDev handler ← lead
     `bizdev_names` yang cocok ke `team_members` (T5), platform ← `platforms[0]` bila satu,
     `lead_id` hidden. Kontak PIC & link toko dititipkan ke `notes` deal (pola "titipan" yang sudah
     ada di `registerShopDeal`).
  3. Server: setelah deal/kartu tersimpan dan `lead_id` ada → panggil logika `markLeadConverted`
     (verifikasi lead belum terkonversi; jalur kartu produk tanpa deal_id → simpan `converted_shop_key`
     baru? **Tidak**: untuk kartu produk, tandai lead `status='deal'` + `converted_deal_id` null dan
     catat `shop_key` di `notes`; jalur shop → `converted_deal_id = DEAL-xxx`). Audit `lead.convert`.
  4. Form "Tandai sudah jadi Deal" (tempel ID) tetap ada untuk deal yang sudah terlanjur dibuat.
- **Validasi tetap** `productCardSchema`; tidak ada field wajib baru (CLAUDE.md #6).

### T9 — Report Brand v2 `/brand-reports`
- **File:** `src/app/(portal)/brand-reports/page.tsx` (daftar + form generate: shop + periode),
  `[id]/page.tsx`, `actions.ts` (`generateBrandReportV2`, `saveBrandReportEdits`, `finalize`),
  `src/lib/brand-report/build.ts` (angka dari `creator_shop_period_gmv` + `products_tap`),
  `rules.ts` (kalimat deterministik dari ambang `app_config m8.brand_report_rules`),
  `components/brand-report-view.tsx` (tab: Ringkasan · Kreator · Live vs Video · Produk TAP ·
  Rekomendasi upgrade), nav "Report Brand" grup BizDev & Deal.
- **Angka:** GMV MCN, GMV TAP, %TAP, live/video, orders, jumlah kreator & top-10 kreator (nama +
  CM), produk TAP aktif shop itu, actual revenue partner, tren minggu-ke-minggu. ROAS hanya bila
  ads spend diisi manual di form (tidak ada di data platform) — dan ambang upgrade
  `m8.upgrade_roas_min`/`m8.upgrade_gmv_min` yang sudah ada dipakai apa adanya.
- **Teks:** 100% rule-based, `token_used = 0`; tim boleh menyunting teks (`edits_json`), angka tidak.
  Opsi "ringkasan naratif LLM" lama DIHAPUS bersama jalur upload file (Q3); `lib/m8/brand-summary.ts`
  dihapus bila tidak ada pemakai lain.
- **Workspace BizDev:** section "Report Brand Deals (§2B.4)" + `brand-report-form.tsx` dihapus,
  diganti tautan ke `/brand-reports`. Report lama (`schema_version 1`) tetap bisa dibuka read-only.
- **Portal kreator tidak boleh melihat report brand**: `brand_reports` saat ini HANYA punya policy
  `select to authenticated using (true)` (0006) tanpa restrictive deny `is_creator_user()` — ditambal
  di migrasi 0087 (T3), pola sama `products_tap`/`brand_leads`.

### T10 — FINAL
1. `apply_migration` 0087 ke staging `fomlangoiiywhexwoqom` → verifikasi SQL → production
   `bqknstylbpwsnlgnzayw` (JANGAN `supabase db push`, lihat HANDOFF 2026-09-12). `get_advisors`
   security tanpa temuan baru.
2. Backfill SQL: `platform='shopee'` (T2), seed `brand_bizdev_handlers` (T5).
3. Upload ulang file mingguan (Q6) → cek `creator_shop_period_gmv` terisi, summary BizDev & TAP
   Matchmaking menampilkan angka, segmen Shopee tidak lagi null.
4. Perbarui `HANDOFF.md`, `CLAUDE.md` (#4: `creator_shop_period_gmv` = satu-satunya sumber GMV per
   shop; #6: pipeline_stage dibiarkan, Report Brand v2 = 0 LLM; #9: tabel baru wajib deny creator),
   `docs/BUILD_PLAN.md` Fase 7.

---

## 6. Yang SENGAJA tidak dilakukan
- Tidak menghitung GMV per shop dari `creator_top_products` (hanya top-N, angkanya pasti kurang).
- Tidak menghidupkan kembali `leakage_products`/jalur per-produk: grain per (kreator × shop) sudah
  cukup untuk kedua fitur, dan per-produk sudah ada di CSV backup analisa bocor.
- Tidak menambah LLM di mana pun (CLAUDE.md #1); Report Brand v2 mengikuti Report Kreator v2.
- Tidak mengubah `agency_links.link_status`, `commission_share`, atau status kemitraan (read-only).

---

## 7. Keputusan tertunda (diambil opsi konservatif saat eksekusi full-auto, ditanyakan sekali di akhir)

Format: `ID | tiket | pertanyaan | contoh kasus nyata | opsi | yang diambil + alasan | dampak kalau diubah`.

| ID | Tiket | Pertanyaan | Contoh kasus nyata | Opsi | Diambil + alasan | Dampak kalau diubah |
|---|---|---|---|---|---|---|
| K1 | T1 | Menu Special Project kini tampil untuk SEMUA role staff (kecuali `od_viewer`), termasuk `finance`, `creator_support`, `ads_support`, `campaign_external`. Perlu dipersempit? | `m7.participant_notes` & `m7.report_insight_edit` = semua role kecuali od_viewer (keputusan 2026-09-28/30) → `creator_support` sudah boleh mengisi catatan "Performa per Kreator" tapi dulu harus mengetik URL `/projects`. | A: semua role ber-izin M7 (sesuai plan) · B: hanya `m7.curate` ∪ finance · C: biarkan seperti dulu | A — plan §4 menulis gabungan `m7.curate` ∪ `m7.participant_notes`; menyembunyikan menu dari role yang punya hak tulis hanya memaksa mengetik URL. | Ubah satu baris `roles` `/projects` di `rbac-constants.ts` + test `audit nav 2026-10`. |
| K2 | T2 | Segmen harga Shopee per baris: `Harga(Rp)` (harga satuan) didahulukan, `Total Pembelian/Qty` hanya cadangan. Benar begitu, atau justru harga efektif setelah diskon (`gmv/qty`) yang dipakai? | Fixture `shopee-csv.test.ts`: `Qty=1, Harga(Rp)=50000, Total Pembelian=100000` — dua sumber bisa berbeda (voucher/diskon/bundling); di data nyata selisih ini menentukan segmen di sekitar batas 180rb/800rb. | A: `Harga(Rp)` dulu, cadangan `gmv/Qty` · B: `gmv/Qty` dulu (harga efektif, konsisten dengan TikTok `gmv/items_sold`) · C: hanya `Harga(Rp)` | A — kolom harga eksplisit dari platform lebih jujur daripada turunan; TikTok memakai turunan karena file TikTok tidak punya kolom harga. | Ganti urutan di `shopeeRowSegment()` (`shopee-aggregate.ts`) + 1 test; segmen batch yang sudah diupload baru berubah setelah upload ulang. |
| K3 | T2 | `/creators/[id]` & Creator Product Match: Product Match TIDAK diubah karena engine-nya menghitung segmen dari AOV `gmv/orders` per kategori (bukan kolom `price_segment`), jadi sudah tidak nol untuk Shopee. Pesan "segmen belum tersedia" hanya di Matriks `/creators/[id]`. Perlu juga di Product Match? | `lib/product-match/engine.ts` baris 59: `segment: priceSegmentOf(aov, bounds)` dengan `aov = gmv/orders`. | A: biarkan (tidak ada nol) · B: tambah catatan "segmen dari AOV" di Product Match | A — tidak ada tampilan nol yang perlu ditutupi. | Hanya teks UI. |
| K4 | T3 | View `bizdev_brand_perf` hanya memuat shop yang punya kartu Produk TAP atau baris Deal Brand (punya `shop_key`). Shop tempat kreator berjualan tanpa deal apa pun TIDAK masuk "Non BD Handle". Benar? | Data mingguan TikTok memuat ribuan shop non-deal (`bd_leads` M4 = shop non-deal); kalau ikut, baris "Non BD Handle" akan menelan hampir seluruh GMV MCN dan summary BizDev tidak terbaca. | A: hanya shop ber-kartu/deal (brand) · B: semua shop, non-deal ikut "Non BD Handle" · C: non-deal jadi baris terpisah "Shop non-deal" | A — "Non BD Handle" di dokumen = brand yang belum di-assign BizDev, bukan semua toko. Shop non-deal tetap terlihat lengkap di TAP Matchmaking. | Ubah `join shop_map` → `left join` di view + label baris ketiga di summary (migrasi kecil). |
| K5 | T3 | Satu `shop_id` yang tercatat di beberapa kartu dengan ejaan Shop Name berbeda (→ beberapa `shop_key`) dipetakan ke SATU `shop_key` (kartu Produk TAP didahulukan, lalu urutan abjad). | `products_tap.shop_key` = `platform:Shop Name` (0082) — "DVARA" vs "Dvara Official" dengan shop_id sama menghasilkan dua kunci; tanpa pemilihan, GMV shop itu terhitung dua kali di summary. | A: pilih satu (kartu dulu) · B: bagi rata · C: tampilkan semua (dobel) | A — mencegah GMV dobel; ejaan ganda tetap bisa dirapikan lewat tombol Edit shop. | Ubah `order by` di CTE `shop_map`. |
| K6 | T4 | Baris TAP tanpa kolom kreator di file MCN multi-kreator: GMV TAP-nya DIBAGI proporsional GMV MCN tiap kreator di shop itu (aturan alokasi M4 yang sama). Kalau shop itu tidak punya GMV MCN di file → tidak diatribusikan, dilaporkan sebagai peringatan. | `run.ts` sudah mencatat "N baris TAP tanpa nama kreator tidak dapat diatribusikan" untuk file multi-kreator; `leak-compute.ts` memakai `allocateAgencyGmv` (proporsional) untuk kasus yang sama. | A: proporsional (sama dengan M4) · B: lewati seluruhnya · C: tolak upload | A — konsisten dengan angka bocor M4; tidak membuang GMV TAP. | Ganti cabang alokasi di `buildCreatorShopPeriod()` + 1 test. |
| K7 | T5 | Upload Excel: baris dengan BizDev 1 terisi tapi BizDev 2 kosong — BizDev kedua yang lama ikut dihapus (isi file = keadaan akhir) atau dipertahankan? | Brand "Skintific" sekarang dipegang Rina + Budi; file berisi `Skintific | Rina | (kosong)`. | A: keadaan akhir = hanya Rina (Budi dilepas) · B: sel kosong per kolom = tidak mengubah kolom itu (Budi tetap) | A — plan T5 "isi file = keadaan akhir (2 nama menggantikan yang lama)"; hanya baris yang KEDUA kolom BizDev-nya kosong yang tidak mengubah apa pun. | Ubah `buildBizdevHandlerRows`/`uploadBrandBizdevHandlers` agar menggabung dengan handler lama; 1 test. |
| K8 | T5 | Registrasi Deal untuk brand yang SUDAH punya BizDev handler: isian "BizDev handler" diabaikan (tidak menimpa) dan diberi catatan. | Kartu produk baru untuk shop lama (mis. DVARA sudah dipegang Rina) didaftarkan oleh Budi yang memilih dirinya sendiri sebagai handler. | A: abaikan + catatan (ubah lewat tombol BizDev) · B: timpa · C: tambahkan bila slot < 2 | A — form registrasi dipakai banyak BizDev; menimpa diam-diam bisa melepas penanggung jawab brand orang lain. | Ganti cabang di `assignHandlersOnRegister()`; 1 test. |
| K9 | T5 | Siapa yang boleh mengubah BizDev handler: izin `deals.edit` (Management, BizDev Lead, BizDev, Campaign Ops, BD Admin, Finance) — termasuk BizDev biasa mengubah brand milik BizDev lain. | `deals.edit` dipakai juga oleh form Edit deal; Finance ikut karena dimensi pembayaran. | A: `deals.edit` (sesuai plan) · B: hanya Management + BizDev Lead · C: B + BizDev untuk brand tanpa handler / miliknya sendiri | A — sesuai plan T5; semua perubahan tercatat di audit_logs (`deals.bizdev_handler`). | Ganti izin di `bizdev-handler-actions.ts` (+ gerbang per baris bila C). |
| K10 | T6 | Migrasi 0087 (belum di-apply) diubah di T6: view `shop_period_summary`/`bizdev_brand_perf` kini punya dua grain (`period_kind` = week/month, `period_key`) + view `shop_key_map`, supaya total bulanan & jumlah kreator distinct sebulan dihitung SQL, bukan JS. | Kreator yang berjualan di brand yang sama di W1 dan W2 dihitung 1 di tampilan bulanan (count distinct), bukan 2. | A: dua grain di view (dipakai) · B: hanya mingguan, bulanan dijumlah di aplikasi (kreator terhitung dobel) | A — sesuai aturan "agregasi di SQL"; belum ada data yang bergantung pada bentuk lama. | Tidak ada — bentuk view final ikut apply di T10. |
| K11 | T6 | Summary BizDev terlihat oleh semua role yang membuka BizDev Workspace (Management + BizDev Lead/BizDev/Campaign Ops/BD Admin), tanpa pembatasan "hanya brand saya". | Plan T6: "Scope: bizdev/campaign_ops/bd_admin melihat semua (sama seperti tabel Shop)". | A: semua lihat semua · B: BizDev hanya kartu & brand miliknya | A — sesuai plan; perbandingan antar BizDev memang tujuan section ini. | Filter `member_id = akun login` di `page.tsx` untuk role non-lead. |

