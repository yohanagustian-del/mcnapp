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
