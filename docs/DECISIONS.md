# DECISIONS — MCN MEA Platform

Catatan keputusan user yang mengikat kode. Format: `D-<tanggal>-<n>`. Keputusan lama
yang tersebar di `CLAUDE.md` & `HANDOFF.md` tetap berlaku; file ini dimulai 2026-10-20.

## 2026-10-20 — Bulk Load Deal Brand + role Campaign Ops (Yohan)

Sumber: Google Sheet "All Brand TAP [Database Bizdev TikTok 2026]", tab
"DATA BULKING! UNTUK KO YOHAN". Migrasi `0097_deal_brand_bulkload.sql` (+ `0098` setelah import).

### D-2026-10-20-1 Status Deal Brand
- Enum baru `brand_deals.status`: `reguler` (Reguler), `running_1st_month` (Running Bulan
  Pertama), `retention` (Retention), `hold` (Hold), `stop` (Stop). Label di
  `app_config m8.deal_status_options`; util `lib/deals/deal-status.ts`.
- Variasi sheet "running", "Running 1st Month", "Running Bulan pertama" → `running_1st_month`.
- **Pemetaan nilai lama** (dijalankan 0097 di DB):

  | Lama | Baru |
  |---|---|
  | `running` | `running_1st_month` |
  | `hold` | `hold` |
  | `done` | `stop` |

- Status kosong di sheet → `NULL` + dilaporkan (Brand Testing, MIORIO, USMILE, Vibrant Glamour).
- Selama 0097 belum di-apply di suatu environment, penulisan status otomatis jatuh ke nilai
  lama (`toLegacyDealStatus`) supaya produksi tetap jalan.

### D-2026-10-20-2 Ads Brand → Project BD
- Ads support disimpan di `bd_project_shops.ads_support` (per project × shop), BUKAN di
  `bd_projects`. Alasan: satu Project BD menggabungkan beberapa shop/brand dan sheet
  menyimpan skema ads per brand, jadi satu nilai per project akan memaksa brand berbeda
  memakai skema yang sama. Pola ini sama dengan Ads Budget/Service Fee (per project × shop, 0046).
- Pilihan di `app_config m8.ads_support_options` (6 nilai).
- `brand_deals.ads_brand` = DEPRECATED, read-only (nilai mentah sheet). Tidak bisa diedit
  di form/tabel Deal Brand.
- Import TIDAK membuat Project BD otomatis. Brand tanpa Project BD → laporan
  "perlu dipasang ke Project BD".
- 6 nilai lama di luar daftar (Daily (Barcode/Invoicing) ×3, Not yet Support, Campaign
  Bulking, Daily (Barcode), Minim Support) dilaporkan saja, tidak dipetakan.

### D-2026-10-20-3 Leads
- `brand_deals.leads_type` tetap field Deal Brand; pilihan `app_config m8.leads_type_options`.
- Kolom C sheet ("Leads" pertama, isinya tahap pipeline "Deal") TIDAK disimpan; kolom N
  ("Leads" kedua) = `leads_type`. Parser memetakan per POSISI kolom.

### D-2026-10-20-4 Kunci & duplikat
- Kunci upsert `(platform, shop_id, trim(brand_name))`, case-sensitive. Satu shop_id boleh
  dipakai beberapa brand (sah). Tidak ada unique `(platform, shop_id)`; validasi "Shop ID
  sudah dipakai deal lain" di Edit deal diganti menjadi kunci yang sama.
- Di-SKIP + "perlu konfirmasi tim": duplikat persis (nama setelah trim + shop_id sama) dan
  baris tanpa Shop ID. Baris tanpa nama brand juga di-skip & dilaporkan.
- Unique index parsial (`0098`) dijalankan SETELAH import bersih.

### D-2026-10-20-5 Replace
- Data produksi `brand_deals` ditimpa isi sheet (bukan digabung) — HANYA lewat langkah
  "Promote ke Produksi" terpisah setelah persetujuan eksplisit Yohan.
- Baris produksi yang tidak ada di sheet & masih direferensikan FK → soft-deactivate
  (`deactivated_at`), tidak di-hard-delete.

### D-2026-10-20-6 Campaign Ops
- Pakai role `campaign_ops` yang sudah ada. Bizdev = leads, pitching, negosiasi, closing,
  pengelolaan brand. Campaign Ops = support administratif & operasional.
- Campaign Ops TIDAK mendapat Registrasi Deal (`deals.create`) dan BD Value Predictor
  (`m6.use`) — default "tidak" dari keputusan user. Tabel before/after di PR & `lib/rbac-constants.ts`.
- `brand_deals.campaign_ops_id` (FK team_members) dari kolom "Campaign Ops";
  "Non Campaign Ops" = NULL.
- Perubahan role akun produksi (Lala, Diena, ZamZam) = SQL disiapkan di
  `scripts/sql/campaign-ops-roles.sql`, TIDAK dijalankan tanpa persetujuan.

### D-2026-10-20-7 Niche
- Daftar baku di `app_config m8.niche_options` (32 nilai unik non-kosong dari sheet; 33 bila
  sel kosong ikut dihitung). Bisa ditambah lewat UI oleh management/bizdev_lead (izin
  `deals.niche_manage`). Form memakai dropdown + "Tambah niche baru".
- Variasi ejaan TIDAK digabung otomatis — masuk laporan sebagai usulan penggabungan.

### D-2026-10-20-8 Staging dulu
- Semua perubahan diuji di staging (`fomlangoiiywhexwoqom`). Produksi
  (`bqknstylbpwsnlgnzayw`) hanya DIBACA oleh dry-run. Apply migrasi, replace data, dan ubah
  role produksi menunggu persetujuan eksplisit Yohan.

## 2026-10-21 — Jawaban Yohan atas pertanyaan bulk load

### D-2026-10-21-1 Alias nama
- "Fanny" (kolom Bizdev) = **Fanny Putri Fernanda**; "Diena" (kolom Campaign Ops) = **Diena Shofwah**.
  Dipetakan lewat `CONFIRMED_NAME_ALIASES` (`lib/deals/bulk-deal-plan.ts`). Nama lain tetap tidak ditebak.
- Lala & ZamZam (akun belum ada / nonaktif): dibiarkan dulu, tidak memblok import.

### D-2026-10-21-2 Izin Campaign Ops
- `campaign_ops` mendapat `deals.import_legacy` (menu Import Bulk Deal Brand) dan
  `bd_project.manage` (kelola Project BD, termasuk Ads Support per shop).

### D-2026-10-21-3 Data yang dibiarkan
- 5 brand duplikat di sheet & tanggal ambigu nusantarahelm "3/1/2027": dibiarkan dulu (tetap
  di-skip / dibaca 2027-01-03 dan dilaporkan).
- Niche TIDAK digabung; usulan penggabungan dihapus dari laporan.
- 22 baris produksi yang tidak ada di sheet: dibiarkan dulu — langkah Promote nanti TIDAK
  menonaktifkan baris itu kecuali Yohan memutuskan lain (mengubah D-2026-10-20-5 untuk Promote pertama).
- Apply 0097/0098 ke produksi, Promote, dan SQL role produksi: BELUM disetujui.

## 2026-10-22 — Tampilan Deal Brand per brand (Yohan)

### D-2026-10-22-1 Tab Deal Brand = tabel per BRAND
- Yohan mengirim mock: `/deals` harus menampilkan database brand (kolom sheet "Database Bizdev"),
  bukan ringkasan shop. Tab bawaan **Brand** = satu baris per `brand_deals` aktif
  (`deactivated_at` null), kolom: Nama Brand, Bizdev, Status, Niche, Link Toko, Shop ID, Contact
  PIC Brand, Grup Brand, GMV TAP, Avg Harga Produk, Sample/Flash Sale/Ads, Ads Brand, Leads,
  Priority, Working Sheet, Campaign Ops, Campaign Name, Campaign ID, Exp Date, Countdown, Shop Code.
  Cari nama brand/Shop ID; filter Platform, Bizdev, Status, Niche, Priority, Campaign Ops; menu Kolom;
  10/halaman (bisa 25/50/100). Logika murni di `lib/deals/brand-table.ts`.
- Bizdev = akun `brand_bizdev_handlers` bila ada, selain itu label kolom Bizdev sheet (`bizdev_label`).
- Tabel per SHOP lama (`deal_shop_summary`, Edit shop, tombol & upload BizDev handler) TIDAK dihapus:
  pindah ke tab **Shop (Produk TAP)** (`/deals?view=shop`).
- Countdown dihitung saat render (tidak disimpan). Tanpa 0097 tab Brand tetap jalan dengan kolom dasar.

## 2026-10-31 — Request Ads (Jadwal Live + Special Project) & akses Finance (Yohan)

Sumber: jawaban Yohan 2026-10-31 atas `docs/plans/ADS_TRACKING_FINANCE_2026-10.md` §4.
Migrasi `0100_ads_request_finance.sql`.

### D-2026-10-31-1 Pembuat Request Ads
- Yang boleh mengajukan request ads: **CM** (`cm_lead`, `cpm` — CPM hanya kreator miliknya),
  **BizDev** (`bizdev_lead`, `bizdev`), dan **Campaign Ops** (`campaign_ops`), plus management.
  Izin `m10.brief_create`. Menggantikan jawaban awal "hanya CM".

### D-2026-10-31-2 Executor = Creator Support (satu divisi)
- Role `ads_support` tidak pernah dipakai (0 akun di produksi 2026-10-31) dan secara
  organisasi sama dengan Creator Support. Executor request ads = **`creator_support`**
  (+ management; `campaign_ops` tetap boleh mengeksekusi sesuai D-2026-10-20-6).
  `ads_support` dicabut dari semua izin dan nav; nilai enum DB dibiarkan (tidak bisa dihapus),
  `ROLES` tetap memuatnya hanya untuk kompatibilitas tipe — jangan beri akun role itu lagi.

### D-2026-10-31-3 Empat tipe pendanaan, cash/invoice untuk kreator DAN brand
- `funding_type`: `mea_budget` | `creator_budget` | `brand_budget` | `tiktok_ads_credit`.
- `creator_budget` **dan** `brand_budget` punya `payment_method`: `cash_upfront` | `invoice`.
- **Cash di awal**: Finance WAJIB mencatat uang sudah masuk (`cash_received_at`) sebelum request
  boleh lanjut ke eksekusi; ACC-nya hanya Finance (+ Director override, ter-log).
- **Invoice**: ACC boleh oleh **Head CM** (`head`, `cm_lead`) **atau Finance**; invoice terbit saat ACC,
  eksekusi boleh jalan sebelum lunas, tanggal bayar dicatat Finance di invoice.
- `mea_budget` & `tiktok_ads_credit` tidak dijawab eksplisit → **asumsi A1**: ACC-nya sama dengan
  jalur invoice (Head CM atau Finance), tanpa invoice. **Dikonfirmasi Yohan 2026-10-31 (sesi lanjutan):
  A1 tetap** — `accRolesFor()` tidak berubah.

### D-2026-10-31-4 Jatah budget MEA per kreator per bulan
- Berbeda per kreator, ditetapkan **Head** (`head`, `director`; izin `m10.mea_budget_set`).
  Tabel `creator_ads_monthly_budgets (creator_id, month)`; tanpa baris = 0 (tidak ada jatah).
- Sisa bulan **hangus** (tidak carry-over). Terpakai = Σ `budget_approved` (fallback
  `budget_requested`) request `mea_budget` bulan itu yang tidak `batal`/`ditolak`.
- Request `mea_budget` yang membuat terpakai > jatah → approval **Director** (`m10.budget_approve`)
  sebelum masuk antrean ACC. `creators.ads_budget_cap` tidak lagi dibaca.

### D-2026-10-31-5 Margin Special Project
- Hanya ads **`mea_budget`** (dan brief lama tanpa `funding_type`) yang mengurangi revenue MEA di
  `project_ads_spend_v` → `project_daily_metrics.ads_spend` → margin & alert `project_over_cap`.
  Ads kreator/brand/credit tampil sebagai informasi (`project_ads_spend_by_funding_v`).

### D-2026-10-31-6 Invoice
- File **PDF** dari MCN app (nomor `INV-YYYYMM-NNNN`, tidak pernah dipakai ulang; batal = status).
  Template resmi menyusul dari Yohan — layout awal = placeholder di `lib/m10/invoice-pdf.ts`.
- **PPN otomatis**: tarif dari `app_config m10.invoice_ppn_rate` (default 0.11), DPP = nominal request,
  total = DPP + PPN. Tidak sinkron ke CDPS (beda perusahaan).
- Jatuh tempo = `issued_at + m10.invoice_due_days` (default 14); pengingat H-`m10.invoice_reminder_days`
  (default 3) dan setelah lewat, in-app (badge + `platform_alerts`), tanpa WA/email otomatis.

### D-2026-10-31-7 Yang dibiarkan (default plan, tidak dibantah)
- Slot Jadwal Live baru tidak lagi menanyakan `ads_payer`/`ads_note` — diganti tombol Request Ads;
  nilai lama tetap tampil.
- Brief M10 lama dibiarkan apa adanya (`funding_type` null); hanya request baru wajib pendanaan.
- Jalur `creator_requests` type `ads` (CM Workspace) ditutup; sample/HSL tetap.
