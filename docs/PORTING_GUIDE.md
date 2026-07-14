# PORTING GUIDE — Replikasi Fitur MCN MEA Platform

Dokumen ini adalah blueprint **stack-agnostic** untuk mereplikasi fitur-fitur terpilih dari mcnapp ke platform lain. Setiap fitur didokumentasikan dalam 5 lapisan: **skema data → aturan bisnis → algoritma → validasi → alur UI**, sehingga bisa diimplementasikan ulang di stack apa pun (bukan hanya Next.js + Supabase).

Referensi kode sumber ditulis di tiap bagian bila butuh detail implementasi persis.

**Cakupan (sesuai permintaan):**

| Bagian | Fitur | Sumber di mcnapp |
|--------|-------|------------------|
| [1](#bagian-1--creator-upload-data-mingguan-cm-workspace-jadwal-live) | Creator, Upload Data Mingguan, CM Workspace, Jadwal Live | `/creators`, `/ingest`, `/workspace/cm`, `/schedule` |
| [2](#bagian-2--deal-merchant-registrasi-deal-import-master-deal-bizdev-workspace) | Deal Merchant: Registrasi Deal, Import Master Deal, BizDev Workspace | `/deals/baru`, `/deals/import`, `/workspace/bizdev` |
| [3](#bagian-3--acquisition-workspace) | Acquisition Workspace | `/workspace/acquisition` |
| [0](#bagian-0--fondasi-bersama-wajib-dibangun-dulu) | Fondasi bersama (WAJIB dibangun dulu) | `src/lib/utils/`, `audit.ts`, `config.ts` |

---

## Peta Ketergantungan Antar Fitur

Bangun sesuai urutan ini — panah = "membutuhkan":

```
Fondasi (util parser + audit_logs + app_config + master creators)
   │
   ├─→ Upload Data Mingguan (ingest) ──→ creator_period_summary (tabel agregat)
   │                                          │
   │                                          ├─→ CM Workspace (growth W1-W5, alert)
   │                                          └─→ Acquisition (GMV post-join)
   │
   ├─→ Registrasi Deal / Import Master ──→ brand_deals + cooperating_shops
   │                                          │
   │                                          ├─→ BizDev Workspace (pipeline, brand report)
   │                                          └─→ Jadwal Live (deal_id opsional di slot)
   │
   └─→ Jadwal Live (butuh: creators + team_members; opsional: brand_deals)
```

Minimum tabel per grup fitur:

- **Grup 1**: `creators`, `upload_batches`, `creator_period_summary`, `creator_subcat_segment_gmv`, `creator_top_products`, `platform_alerts`, `live_schedule_slots`, `audit_logs`, `app_config`
- **Grup 2**: `brand_deals`, `deal_products`, `cooperating_shops`, `bd_leads`, `audit_logs`
- **Grup 3**: `acquisitions`, `referrals`, `creators`, `creator_period_summary` (untuk GMV post-join)

---

## Bagian 0 — Fondasi Bersama (WAJIB dibangun dulu)

Semua fitur di bawah bergantung pada 5 komponen ini. Tanpa ini, penyalinan fitur akan menghasilkan data kotor yang sama seperti sheet lama.

### 0.1 `parseRupiah()` — parser Rupiah toleran

Data legacy campur dua format ribuan. Aturan (sumber: `src/lib/utils/rupiah.ts`):

```
Input                  → Output
"Rp1,075,484,867"      → 1075484867   (koma = ribuan)
"Rp4.131.512.642"      → 4131512642   (titik = ribuan)
"Rp1.234.567,89"       → 1234567.89   (titik ribuan, koma desimal)
"(1.000)"  / "-1000"   → -1000        (kurung/minus = negatif)
"1234567"              → 1234567
"" / "-" / "abc"       → null         (JANGAN crash — caller flag review)
```

Algoritma:
1. Strip `Rp`/`rp.` dan whitespace; deteksi negatif (prefix `-` atau wrap `(...)`).
2. Jika ada titik DAN koma: separator **terakhir** = desimal, yang lain = ribuan.
3. Jika hanya satu jenis separator: kalau semua grup setelah separator berukuran 3 digit dan grup pertama 1–3 digit → ribuan (hapus); kalau ada tepat 2 bagian dan bagian kedua ≤ 2 digit → desimal; selain itu → `null`.
4. Return `null` untuk apa pun yang tak yakin — **jangan pernah menebak**.

### 0.2 `parseCommission()` — parser komisi kotor

Sumber: `src/lib/utils/commission.ts`. Return `{min, max, isRange}` atau `null`:

```
"10%"        → {min:10, max:10, isRange:false}
"5-7%"       → {min:5,  max:7,  isRange:true}   → simpan raw + flag review
"7,5%"       → {min:7.5, max:7.5}               (koma desimal diterima)
"not found" / "error" / "" / free text → null    → simpan raw + flag review
nilai di luar 0–100 → null
```

Prinsip penyimpanan: **selalu simpan dua kolom** — `komisi_raw` (teks asli) dan `komisi_pct` (angka hasil parse, `min` bila range). Nilai null bukan error, tapi sinyal "butuh review manusia".

### 0.3 `parseFlexibleDate()` — parser tanggal bebas

Sumber: `src/lib/utils/date.ts`. Menerima: `"19 February 2026"`, `"19 Februari 2026"` (bulan ID/EN + singkatan), `"2026-02-19"`, `"19/02/2026"` (day-first default; fallback month-first bila bagian tengah > 12 seperti `"04/21/2026"`), `"11-Dec-2026"`. Output ISO `YYYY-MM-DD` atau `null`. Validasi kalender nyata (tolak 31 Feb).

### 0.4 `audit_logs` — jejak semua mutasi

```sql
create table audit_logs (
  id bigserial primary key,
  actor_id uuid,            -- null utk system job (isi actor_label)
  action text not null,     -- misal 'brand_deal.register', 'ingest.run', 'schedule.verify'
  entity_type text not null,
  entity_id text,
  before jsonb, after jsonb,
  type text not null check (type in ('auto','approval','platform_alert')),
  created_at timestamptz default now()
);
```

Aturan pemetaan `type` (ini keputusan produk, bukan teknis):
- Aksi **menambah income / tidak merugikan** → langsung berlaku, `type='auto'` (tetap dicatat).
- Aksi **manusia yang berpotensi merugikan** (contoh: request ads melewati budget cap) → butuh **approval** dulu, `type='approval'`.
- Perubahan **dari data platform yang merugikan** (link bocor, komisi turun) → **alert** (tidak bisa di-approve/ditolak karena faktanya sudah terjadi), `type='platform_alert'`.

### 0.5 `app_config` — semua threshold, nol hardcode

```sql
create table app_config (key text primary key, value jsonb not null);
```

Semua angka ambang dibaca dari sini saat runtime. Threshold yang dipakai fitur-fitur dalam dokumen ini:

| Key | Nilai default | Dipakai oleh |
|-----|--------------|--------------|
| `m8.perf_drop` | `0.15` | Alert GMV turun >15% minggu-ke-minggu (CM Workspace) |
| `m8.gmv_post_join_days` | (mis. `90`) | Window GMV post-join (Acquisition) |
| `ingest.top_n_products` | `20` | Berapa produk top disimpan per kreator per batch |
| `segments.price_bounds` | `{"low":180000,"entry":800000,"sweet":3600000,"high":8000000}` | Segmentasi harga saat agregasi |
| `m4.bocor_sebagian` / `m4.bocor_total` | `0.10` / `0.50` | Rollup status bocor per kreator |

### 0.6 ID entity

Text PK dengan prefix, digenerate util terpusat (`src/lib/utils/id.ts`): `CRT-xxxx` (creator), `DEAL-xxxx` (deal), `LNK-xxxx` (link). Keuntungan: ID terbaca manusia di sheet/chat, dan FK lintas tabel jelas asal-usulnya.

---

## Bagian 1 — Creator, Upload Data Mingguan, CM Workspace, Jadwal Live

### 1.1 Master Creator

```sql
create table creators (
  id text primary key,                 -- 'CRT-...'
  name text not null,                  -- = username platform (kunci resolve saat ingest)
  niche text,                          -- auto-fill dari ingest (top niche)
  top_niches jsonb,                    -- ranked list, auto-fill
  status text default 'prospek'        -- prospek | binding | aktif | nonaktif
    check (status in ('prospek','binding','aktif','nonaktif')),
  platform text,                       -- tiktok | shopee (kreator DIPISAH per platform)
  jenis_creator text,                  -- live | video | mixed — derived dari rasio GMV live vs video
  gmv numeric default 0,               -- RATA-RATA GMV BULANAN (bukan total!) — auto-fill
  gmv_live numeric, gmv_video numeric, -- rata-rata bulanan juga
  commission_share numeric,            -- READ-ONLY: sync platform, tak ada endpoint edit
  owner_cpm_id uuid,                   -- FK team_members; assignment oleh CM Lead
  live_roster boolean default false,   -- flag manual: tampil di kalender jadwal live
  ads_budget_cap numeric,              -- cap utk approval request ads
  created_at timestamptz default now()
);
```

Aturan penting yang sering terlewat saat porting:

1. **`creators.gmv` = rata-rata total BULANAN**, bukan total kumulatif. Dihitung ulang tiap ingest dari seluruh histori `creator_period_summary` (lihat §1.2.6).
2. **`commission_share` read-only** — tidak boleh ada form edit. Nilai turun → generate alert, bukan update manual.
3. **Kreator per platform terpisah**: username sama di TikTok dan Shopee = dua baris creator berbeda. Resolve name selalu di-scope `platform`.
4. **Auto-create prospek**: nama kreator di file upload yang belum ada di master → buat otomatis (status sesuai konteks: dari report performa = `aktif`, dari file leak = `prospek`) + laporkan di hasil upload.

### 1.2 Upload Data Mingguan (Ingest Pipeline)

Ini fitur paling kompleks di grup 1. Arsitektur final (setelah beberapa iterasi produksi): **process-on-ingest, drop-raw** — file diparse, diagregasi in-memory, lalu **baris mentah TIDAK PERNAH ditulis ke DB**. Hanya agregat yang disimpan. Terbukti memproses 2.528 + 1.746 baris dalam 16 detik (versi sebelumnya yang menulis staging ke DB: >6 menit dan gagal).

#### 1.2.1 Skema window upload: W1–W5 (LOCKED)

Semua upload mingguan mengikuti window kalender tetap per bulan:

```
W1 = tanggal 1–7      W2 = 8–14      W3 = 15–21      W4 = 22–28
W5 = 29–akhir bulan   (Februari non-kabisat TIDAK punya W5)
```

Validasi (sumber: `validateW1W5Period` di `src/lib/utils/date.ts`):
- Periode file harus **persis** salah satu window (start & end cocok exact).
- Periode **tidak boleh menyeberang bulan**.
- File dengan periode lain (mis. export bulanan, atau 27 Jun–4 Jul) → **DITOLAK** dengan pesan yang menyebut periode file + daftar window valid bulan itu. Jangan diam-diam menerima.

#### 1.2.2 Idempotency & batch ID

```
batch_id = "ingest:<periodStart>:<hash8>"
           hash8 = 8 karakter pertama sha256 isi file
```

Pelajaran produksi yang mahal (bug nyata yang pernah terjadi): batch ID yang hanya `ingest:<periodStart>` membuat upload CM A **menghapus** data CM B di minggu yang sama. Solusi final:

- Batch ID mengandung hash file → dua file berbeda utk minggu sama = dua batch berdampingan.
- Replace di-scope **PER (creator × minggu)**: delete-then-insert hanya untuk kreator yang ada DI FILE INI pada periode ini — bukan wipe seluruh batch/minggu.
- Upload ulang file yang sama persis → hash sama → batch_id sama → replace idempoten.

```sql
create table upload_batches (
  batch_id text primary key,
  source_type text not null,           -- 'mcn' | 'tap' | 'shopee' | 'master'
  uploaded_by uuid, uploaded_at timestamptz,
  row_count_raw int, creators_count int,
  period_start date, period_end date,
  file_hash text,
  status text default 'staging' check (status in ('staging','processed','failed')),
  processed_at timestamptz, error text
);
```

Guard tambahan: sebelum proses, cek batch `processed` lain yang **periodenya beda tapi overlap tanggal** → tolak (mencegah data pra-skema-W1W5 tumpang tindih). Periode identik = jalur replace normal.

#### 1.2.3 Parsing file platform

File export TikTok (CSV/XLSX) — dua varian:
- **File 1-creator**: tanpa kolom creator → creator dari konteks upload.
- **File multi-creator**: ada kolom `creator_name` → resolve ke `creators.id` per baris (case-insensitive by lowercased name).

Aturan parse per baris (sumber: `src/lib/ingest/parse.ts`):
1. Baris pertama "Summary" (baris total dari platform) → **SKIP**.
2. Header dinormalisasi: trim → lowercase → spasi jadi `_`. Sediakan **tabel alias header Bahasa Indonesia → internal name** (export platform ikut bahasa akun user) — header English menang bila keduanya ada.
3. Baris tanpa `product_id` ATAU `shop_id` → skip + catat alasan (tak bisa di-join/agregasi).
4. `items_sold = 0` **TIDAK di-skip** — GMV tetap dihitung; hanya `avg_price` yang jadi null.
5. Kolom `Date` platform = rentang: `"2026-06-03-2026-06-30"` → parse jadi `{start, end}`.
6. Semua nilai uang lewat `parseRupiah`; count lewat parser integer toleran; persentase (`ctr`, `ctor`) lewat parser persen.
7. Kumpulkan `skipped[]` (row + alasan) — laporkan ke user, jangan telan.
8. Bila 0 baris valid padahal file ada isinya → pesan diagnostik yang menyebut **header yang ditemukan vs yang diharapkan** (bukan error generik).

#### 1.2.4 Agregasi in-memory (1 pass, deterministik, 0 LLM)

Tiga output dari satu kali baca baris (sumber: `src/lib/ingest/aggregate.ts`):

**(a) `creator_period_summary`** — satu baris per kreator per minggu:

```sql
create table creator_period_summary (
  id bigserial primary key,
  creator_id text not null, period_start date not null, period_end date not null,
  upload_batch text not null,
  gmv_total numeric default 0,          -- = affiliate_gmv (platform tak punya kolom total lain)
  affiliate_gmv numeric, affiliate_live_gmv numeric, affiliate_video_gmv numeric,
  live_orders int, video_orders int, orders int, items_sold int,
  direct_gmv numeric, refund_gmv numeric,
  ctr numeric, ctor numeric,            -- rata-rata TERTIMBANG GMV, bukan rata-rata biasa
  live_pct numeric,                     -- affiliate_live_gmv / affiliate_gmv (div-0 → null)
  created_at timestamptz default now(),
  unique (creator_id, period_start, upload_batch)
);
```

Rumus kunci:
- `ctr = Σ(ctr_baris × gmv_baris) / Σ(gmv_baris)` — weighted by GMV supaya representatif terhadap "di mana uangnya".
- `live_pct = live_gmv / total_gmv`, guard pembagi nol → null (null ≠ 0: null = tak diketahui).

**(b) `creator_subcat_segment_gmv`** — GMV per (kreator × kategori level-2 × segmen harga):

- Segmen harga dihitung **per baris produk** dari `avg_price = affiliate_gmv / items_sold`, lalu baris dengan (creator, kategori, segmen) sama dijumlahkan.
- Bounds segmen dari config: `low <180k | entry 180k–800k | sweet 800k–3.6jt | high 3.6jt–8jt | premium >8jt`.
- `items_sold=0` → segmen `null` (GMV tetap masuk bucket null).

**(c) `creator_top_products`** — top-N produk per kreator (default N=20 dari config): jumlahkan per (creator, product, shop), rank by GMV desc, buang sisanya (sesuai prinsip drop-raw).

#### 1.2.5 Urutan orkestrasi

Sumber: `runIngest` di `src/lib/ingest/run.ts`. Tanpa transaksi lintas-tabel (Supabase JS tak punya), jadi urutan disusun best-effort aman:

```
1. Parse file (MCN wajib; TAP/agency-link opsional) → rows in-memory
2. Validasi W1-W5 + cek overlap batch → TOLAK di sini bila gagal (belum tulis apa pun)
3. Resolve creator_name → creators.id (auto-create yang belum ada)
4. upload_batches: upsert status='staging'
5. (opsional) derive katalog produk dari file TAP
6. Agregasi in-memory → delete-then-insert 3 tabel agregat (scope per creator×minggu)
7. Auto-fill master creators (lihat 1.2.6)
8. upload_batches → status='processed'
9. audit_logs (type auto): periode, jumlah baris, jumlah kreator, jumlah baris agregat
GAGAL di langkah mana pun → upload_batches.status='failed' + kolom error diisi
```

**Kontrak error ke UI (penting, pelajaran produksi):** server action JANGAN pernah `throw` ke client — di production framework menyensor pesan error. Selalu return `{ok:true, result} | {ok:false, error}` dengan pesan lengkap (periode file, window valid, header ditemukan).

#### 1.2.6 Auto-fill master creators pasca-ingest

Setelah agregat tertulis, update master `creators` per kreator yang ada di batch:

- `status` → `aktif` (muncul di report performa = sudah join).
- `platform` → sumber report (tiktok/shopee).
- `jenis_creator` → dari rasio live vs video GMV **batch ini**.
- `gmv`, `gmv_live`, `gmv_video` → **rata-rata total bulanan** dari SELURUH histori `creator_period_summary` (bukan cuma batch ini). Algoritma: kelompokkan minggu per bulan kalender (dedupe per (creator, period_start), createdAt terbaru menang; bila dua period_start jatuh di minggu yang sama, baris dengan tanggal mulai kanonik 1/8/15/22/29 menang) → jumlahkan minggu terisi per bulan → rata-ratakan lintas bulan yang PUNYA data (bulan kosong tidak dihitung sebagai nol). Sumber: `buildMonthlyAverages` di `src/lib/m8/weekly-growth.ts`.
- `niche`/`top_niches` → ranking GMV per kategori level-2, gabungan batch ini + histori.
- Satu UPDATE + satu audit per kreator, **hanya field yang berubah**; field manual CM tidak disentuh.

#### 1.2.7 Lane 2 — upload hasil analisis leak (opsional utk grup fitur ini)

Bila platform baru juga butuh status link bocor: analisis dilakukan tool eksternal (Excel artifak per CM per minggu), platform hanya **menyimpan rollup**: per kreator per minggu → `gmv_affiliate_total`, `gmv_bocor`, `leak_ratio`, `status`. Klasifikasi 4 status dari threshold config: ratio 0 → `via_agency`; > `m4.bocor_sebagian` (0.10) → `bocor_sebagian`; > `m4.bocor_total` (0.50) → `bocor_total`; tanpa link → `belum_ada_link`. Detail per produk tetap di Excel, tidak disimpan.

### 1.3 CM Workspace

Halaman kerja Creator Manager. Prinsip: **meng-agregasi/membaca** tabel sumber, tidak menghitung ulang pipeline.

#### 1.3.1 Scope akses

- CPM hanya melihat/mengelola creator dengan `owner_cpm_id = dirinya`.
- CM Lead & management: lintas semua creator.
- Enforce di **server** (bukan cuma sembunyikan tombol di UI).

#### 1.3.2 Assignment creator → CPM

Action `assignCreator` (CM Lead/Head only): update `creators.owner_cpm_id`, tulis audit dengan before/after.

#### 1.3.3 Pertumbuhan GMV mingguan W1–W5 + alert

Tampilan inti CM Workspace: tabel kreator × minggu (W1..W5) untuk bulan terpilih, dengan panah delta dan total bulan. Algoritma (sumber: `buildMonthlyGrowth` di `src/lib/m8/weekly-growth.ts`):

```
Input : rows creator_period_summary {creatorId, periodStart, affiliateGmv, createdAt}
1. Filter bulan "YYYY-MM"; dedupe (creatorId, periodStart) → createdAt terbaru menang
2. week_index dari HARI period_start: 1-7→W1, 8-14→W2, 15-21→W3, 22-28→W4, ≥29→W5
   (dua baris beda jatuh di minggu sama → yang period_start-nya kanonik 1/8/15/22/29 menang)
3. Per kreator: weeks[5] (null = minggu tak ada data — BUKAN nol)
4. monthTotal   = Σ minggu terisi
   deltas[i]    = (w[i] − w[prevTerisi]) / w[prevTerisi]   (baseline 0 → null)
   monthGrowth  = (mingguTerisiTerakhir − mingguTerisiPertama) / mingguTerisiPertama
```

**Alert penurunan performa** (`refreshGrowthAlerts`): GMV turun > `m8.perf_drop` (config, 0.15) periode-ke-periode → buat `platform_alerts` type `perf_drop` yang ditujukan ke CPM owner. Ini **event, bukan approval** (fakta platform). Pulih → **auto-resolve** alert-nya.

```sql
create table platform_alerts (
  id bigserial primary key,
  alert_type text not null,     -- 'perf_drop' | 'link_bocor' | 'deal_expiring' | ...
  creator_id text, shop_id text,
  target_member_id uuid,        -- CPM owner
  detail jsonb,
  resolved boolean default false, resolved_at timestamptz,
  created_at timestamptz default now()
);
```

#### 1.3.4 Request kreator (sample / ads / HSL) + approval gate

```sql
create table creator_requests (
  id bigserial primary key,
  creator_id text not null,
  type text check (type in ('sample','ads','hsl')),
  target_brand text,
  status text default 'diajukan' check (status in ('diajukan','diproses','selesai')),
  needs_approval boolean default false,      -- utk jalur ads > cap
  requested_by uuid, created_at timestamptz default now()
);
```

Aturan approval (contoh penerapan pola approval §0.4):
- Sample: tak terbatas, langsung `auto`.
- Ads: cek terhadap `creators.ads_budget_cap`. **Melewati cap atau cap belum diverifikasi → butuh approval Director** sebelum diproses. Ditolak → request ditutup.

#### 1.3.5 Fitur CM lain (ringkas)

- **Shop lead manual**: CM menemukan shop potensial → insert `bd_leads` dengan `source='manual_cm'` (masuk pipeline BizDev, §2.4).
- **Kontrak e-sign**: state machine status `draft → sent → signed | expired`, tiap transisi ter-audit.
- **Komplain kreator**: reply **append-only** (tak bisa edit/hapus); body/severity/category **immutable** setelah dibuat; status `baru → dalam-penyelesaian → selesai` (yang menutup dicatat).
- **CM self-sourced deal**: CM boleh daftarkan deal untuk kreatornya sendiri tanpa lewat BizDev — dicatat `sourced_by_role='cm'` supaya kontribusinya terlihat; validasi sama dengan form BizDev (§2.2).

### 1.4 Jadwal Live (Live Schedule)

Pengganti Google Sheet penjadwalan live. Matriks **creator × 7 hari** (Senin-start) dengan verifikasi pasca-live.

#### 1.4.1 Skema

```sql
-- Flag roster di master creator (kurasi manual siapa yang tampil di kalender)
alter table creators add column live_roster boolean not null default false;

create table live_schedule_slots (
  id bigserial primary key,
  creator_id text not null references creators(id),
  schedule_date date not null,
  start_time time, end_time time,          -- null utk status 'off'
  status text not null default 'scheduled'
    check (status in ('scheduled','tentative','off','done')),
  off_reason text,                         -- free text saat 'off' (mis. "pulang kampung")
  brand_name text,                         -- FREE TEXT (sheet punya nilai "MIX Brand")
  deal_id text references brand_deals(id), -- OPSIONAL link ke deal terdaftar
  deals_by text check (deals_by in ('bd','cm','creator')),
  ads_payer text check (ads_payer in ('brand','mea','invoicing_mea','organik')),
  ads_note text,
  pk_ready boolean not null default false,          -- Product Knowledge siap
  product_set_title text,
  product_connected_tap boolean not null default false,
  fokus_produk text,
  actual_start time, actual_end time,      -- diisi saat verifikasi
  verified_by uuid, verified_at timestamptz,
  created_by uuid not null, updated_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index on live_schedule_slots (schedule_date);
create index on live_schedule_slots (creator_id, schedule_date);
```

Keputusan desain penting:
- **TIDAK ada unique (creator, tanggal)** — satu kreator boleh multi-slot sehari (2 brand live + 1 organik).
- `brand_name` free text + `deal_id` opsional — jangan paksa FK, data lapangan tidak selalu punya deal terdaftar.
- Tanggal = **wall-clock date** (string `YYYY-MM-DD`), tanpa konversi timezone. Jangan pernah `new Date(iso)` untuk aritmetika tanggal (itu parse UTC dan bisa geser hari) — pakai split string + kalender integer.

#### 1.4.2 Siklus status & verifikasi

```
scheduled ──┐
tentative ──┼──(verifikasi: isi actual_start/end)──→ done  [TERKUNCI: tak bisa edit/hapus]
off         │   (tidak diverifikasi — memang tidak live)
            └──(bisa diedit/dihapus selama belum done)
```

- Verifikasi dilakukan CM (jam kerja) ATAU Creator Support (di luar jam kerja CM) → set `actual_start`, `actual_end`, `verified_by`, `verified_at`, status → `done`.
- Slot `done` = **locked** — update/delete ditolak di server.
- Panel operasional: "Verifikasi Hari Ini" (slot hari ini yang pending) + "Terlewat belum diverifikasi" (slot lampau masih `scheduled|tentative`).

#### 1.4.3 Indikator visual (pure function, hitung saat render)

Sumber: `src/lib/schedule/indicators.ts`:

| Indikator | Kondisi |
|-----------|---------|
| PK ✘ | status pending (`scheduled|tentative`) && `!pk_ready` |
| TAP ✘ | status pending && `!product_connected_tap` |
| Butuh verifikasi (ring merah) | status pending && `schedule_date < hari_ini` |
| "Besok belum ada jadwal" | cell besok kosong (hari yang hanya berisi slot OFF = sengaja tidak live, TIDAK diwarning) |

#### 1.4.4 Salin minggu (copy week)

Sumber: `buildCopiedSlots` di `src/lib/schedule/copy-week.ts` — transform murni:

- Map tiap slot non-OFF ke tanggal target dengan **offset hari-dalam-minggu yang sama**.
- Pertahankan: jam, brand, deal_id, deals_by, ads_payer/note, product_set_title, fokus_produk.
- **Reset**: status → `scheduled`, `pk_ready` → false, `product_connected_tap` → false, semua field verifikasi/actual → null.
- Slot OFF di-skip. Server action **menolak** salin bila minggu target sudah terisi.

Week math: Senin sebagai awal minggu — `backToMonday = (dayOfWeek + 6) % 7`.

#### 1.4.5 Matriks permission jadwal

| Aksi | Boleh |
|------|-------|
| View | Management + CM + BD + Creator Support (CPM hanya kreator sendiri, role lain semua) |
| Edit slot | CM + BD + CS (CPM scope `owner_cpm_id`) |
| Verify | CM + CS + management |
| Kelola roster | CM Lead + CPM + management |

Semua mutasi → `audit_logs` type `auto` (aksi `schedule.create/update/delete/verify/roster`) — kebutuhan eksplisit: "siapa edit tercatat".

---

## Bagian 2 — Deal Merchant: Registrasi Deal, Import Master Deal, BizDev Workspace

### 2.1 Skema inti

```sql
create table brand_deals (
  id text primary key,                    -- 'DEAL-...'
  brand_name text not null,               -- WAJIB persis display platform (kunci join)
  shop_id text,                           -- numeric-string; UNIK antar deal terdaftar
  niche text, brand_link text,
  campaign_name text, campaign_id text,
  exp_date date,                          -- masa berlaku deal (dari form/date picker)
  deal_end date,                          -- SELALU = exp_date (di-set saat insert)
  komisi_kreator_raw text,                -- teks asli ("5-7%")
  komisi_kreator_pct numeric,             -- hasil parse (min bila range)
  komisi_mea_raw text, komisi_mea_pct numeric,
  pic_tap uuid,                           -- PIC internal
  gmv_tap numeric, avg_price numeric,
  ads_budget numeric, service_fee numeric,
  campaign_type text default 'paid'
    check (campaign_type in ('paid','sample','extra_commission')),
  status text check (status in ('running','hold','done')),
  priority text,                          -- P0 | P1 | P2
  pipeline_stage text,                    -- tahapan pipeline BizDev
  review_flags jsonb,                     -- daftar masalah data dari importer legacy
  notes text, created_by uuid, created_at timestamptz default now()
);

create table deal_products (              -- 1 deal → N produk
  id bigserial primary key,
  deal_id text not null references brand_deals(id),
  product_id text, product_name text not null, product_link text,
  niche text, exp_date date,
  komisi_kreator_pct numeric, komisi_mea_pct numeric,
  ads_budget numeric, service_fee numeric,
  status text default 'running' check (status in ('running','hold','done')),
  created_by uuid
);

create table cooperating_shops (          -- master shop ber-deal (kunci join data platform)
  shop_id text primary key,
  shop_name text,
  deal_id text references brand_deals(id),
  deal_start date,
  deal_end date,                          -- DIISI dari brand_deals.exp_date, BUKAN dari platform
  active_flag boolean default true        -- computed: deal_end >= today
);
```

**Relasi kunci yang membuat semuanya bekerja:** `brand_deals.exp_date` → sync ke `cooperating_shops.deal_end`. Data platform TIDAK punya info masa berlaku deal — hanya master internal yang tahu. `cooperating_shops` inilah yang jadi kunci join "shop ini ber-deal atau tidak" untuk deteksi bocor dan alert kadaluarsa.

### 2.2 Registrasi Deal (form tervalidasi)

Alasan fitur ini ada: master deal lama berantakan (itulah kenapa platform dibuat). **Deal BARU wajib lewat form tervalidasi, bukan free-text.**

Aturan validasi (sumber: `dealFormSchema` di `deals/actions.ts`):

| Field | Aturan |
|-------|--------|
| `brand_name` | wajib; **persis display platform** |
| `shop_id` | wajib; regex `^\d+$` (angka murni); **unik** — cek duplikat sebelum insert, tolak dengan menyebut deal existing |
| `niche` | wajib |
| `exp_date` | wajib; dari **date picker** (`YYYY-MM-DD`) — bukan teks bebas |
| `komisi_kreator_min/max` | number 0–100; max opsional; **max ≥ min** (validasi silang) |
| `komisi_mea_min/max` | idem |
| `pic_tap` | wajib; pilih dari daftar team member (bukan ketik nama) |
| `campaign_name` | wajib |
| `brand_link` | opsional; harus URL valid bila diisi |
| `gmv_tap`, `avg_price`, `ads_budget`, `service_fee` | opsional; number non-negatif (Rupiah murni tanpa "Rp") |
| `campaign_type` | `paid` \| `sample` \| `extra_commission` (sample & komisi extra = non-berbayar) |

Alur simpan (urutan penting):

```
1. Validasi schema → gagal: return fieldErrors per field (bukan pesan generik)
2. Validasi silang komisi max ≥ min
3. Cek shop_id duplikat → tolak: "Shop ID X sudah terdaftar di deal DEAL-..."
4. Bentuk komisi_raw: "5%" atau "5-7%" (dari min/max) — simpan raw + pct(=min)
5. INSERT brand_deals (deal_end = exp_date)
6. UPSERT cooperating_shops {shop_id, deal_id, deal_end=exp_date,
   active_flag = exp_date >= today}   ← sinkronisasi kunci
7. INSERT deal_products dari baris dinamis form (nama produk wajib per baris;
   produk mewarisi niche/exp_date/komisi deal)
8. audit_logs action 'brand_deal.register' type 'auto'
9. Return sukses + laporan parsial (mis. "sync shop gagal: ..." — jangan telan error sekunder)
```

### 2.3 Import Master Deal Legacy (parser toleran)

Prinsip berlawanan dengan form: **jangan pernah crash, jangan pernah tolak baris — simpan + flag**. Sumber: `importLegacyDeals`.

Aturan per baris:

1. Sheet legacy sering punya baris judul/index sebelum header asli → **probe header**: skip baris sampai ketemu kolom dikenal (`nama_brand`/`brand`/`shop_id`). Kalau tak ketemu → error yang menyebut kolom yang diharapkan.
2. Baris "Summary" dan baris kosong total → skip diam-diam.
3. `brand_name` kosong → skip + catat.
4. Setiap field kotor menghasilkan **flag** (bukan penolakan):
   - `shop_id` non-numeric → flag `shop_id tidak numeric: "..."`; simpan null.
   - `gmv_tap`/`avg_price` gagal `parseRupiah` → flag; simpan null.
   - `exp_date` gagal `parseFlexibleDate` → flag; simpan null.
   - komisi gagal `parseCommission` → flag `komisi kotor`; range ("5-7%") → tetap tersimpan (pct=min) tapi di-flag `komisi range`.
5. **Countdown negatif** ATAU `exp_date < hari ini` → deal expired → `cooperating_shops.active_flag = false`.
6. Simpan baris dengan `review_flags = [daftar flag]` → UI menampilkan deal yang butuh review.
7. Sinkron `cooperating_shops` hanya bila `shop_id` valid DAN `exp_date` terbaca.
8. Laporan hasil: `inserted` + daftar `{row, reason}` — termasuk baris yang "tersimpan DENGAN flag review".
9. Kenali alias header sheet nyata: `nama_brand|brand_name|brand`, `avg_harga|avg_price`, `nama_bd → tim_handler`, `nama_campiagn` (typo asli di sheet!) → `campaign_name`, `ads` (Rp) → `ads_budget`.

Ada juga **bulk upload produk deal** terpisah (Excel): resolve deal per baris via `deal_id` ATAU `shop_id`, field kotor lewat parser toleran yang sama.

### 2.4 BizDev Workspace

Empat fungsi utama:

**(a) Tracker request semua CM** — baca `creator_requests` lintas CPM (BizDev melihat semua, untuk eksekusi sample/ads/HSL).

**(b) Pipeline deal** — kolom `brand_deals.pipeline_stage` digerakkan manual per tahap; tiap perubahan ter-audit. Tampilkan `shop_name` + `shop_id` sebagai subteks (fallback `shop_id` bila nama null).

**(c) Lead BD** (`bd_leads`) — gabungan lead otomatis (dari analisis leak: shop non-deal dengan frekuensi × GMV tinggi) dan manual dari CM:

```sql
create table bd_leads (
  id bigserial primary key,
  shop_id text unique, shop_name text,
  frequency int, total_gmv numeric,
  priority_score numeric,               -- deterministik: frekuensi × GMV
  first_seen_week date,
  source text check (source in ('auto_m4','artifact','manual_cm')),
  status text default 'baru' check (status in ('baru','diambil','deal'))
);
```

**(d) Brand report** — agregasi deterministik `transactions/summary` per shop ber-deal + ROAS (bila ads spend diisi) + saran upgrade service bila ROAS ≥ `m8.upgrade_roas_min` dan GMV ≥ `m8.upgrade_gmv_min` (config). Ringkasan naratif LLM = **opsional dan satu-satunya titik LLM** di workspace — token dicatat.

**(e) Routing campaign lintas workspace** — state machine murni (sumber: `src/lib/m8/routing.ts`):

```
BizDev route request (owner_cpm_id AUTO dari creators.owner_cpm_id)
  → CM konfirmasi: mau | tidak
      → [bila needs_brand_acc: menunggu acc brand → approved | ditolak]
          → final: fix | batal
              → handover ke Campaign Ops
```

```sql
create table campaign_requests (
  id bigserial primary key,
  deal_id text references brand_deals(id),
  creator_id text, owner_cpm_id uuid,          -- auto-derived saat routing
  cm_confirm_status text default 'menunggu' check (cm_confirm_status in ('menunggu','mau','tidak')),
  needs_brand_acc boolean,
  brand_acc_status text default 'n_a' check (brand_acc_status in ('n_a','menunggu','approved','ditolak')),
  final_status text default 'proses' check (final_status in ('proses','fix','batal')),
  created_at timestamptz default now()
);
```

Implementasikan sebagai **pure function transisi** (state + event → state baru | error) supaya bisa di-unit-test tanpa DB; server action hanya memanggil transisi + tulis DB + audit. Transisi ilegal (mis. handover sebelum `fix`) → tolak di server.

---

## Bagian 3 — Acquisition Workspace

Mencatat kinerja tim akuisisi: closing binding kreator baru, referral, handoff ke CM, dan atribusi GMV pasca-join.

### 3.1 Skema

```sql
create table acquisitions (
  id bigserial primary key,
  creator_id text not null references creators(id),
  specialist_id uuid not null,          -- = actor yang mencatat (kinerja pribadi)
  lead_source text not null check (lead_source in ('inbound','outbound','platform')),
  binding_date date not null,
  commission_share_at_binding numeric,  -- SNAPSHOT komisi saat binding
  gmv_last_30d numeric,                 -- GMV 30 hari SEBELUM binding (baseline, log-only)
  gmv_post_join numeric,                -- GMV window N hari SETELAH binding (di-refresh)
  gmv_quarter_actual numeric,           -- GMV binding_date → akhir quartal (atribusi OKR)
  quarter_end date,                     -- akhir quartal kalender dari binding_date
  handoff_done boolean default false,
  notes text, created_at timestamptz default now()
);

create table referrals (
  id bigserial primary key,
  new_creator_id text not null references creators(id),
  referrer_creator_id text references creators(id),   -- null utk referral platform
  referral_source text not null check (referral_source in ('antar_creator','platform')),
  commission_status text default 'pending' check (commission_status in ('pending','dibayar')),
  recorded_by uuid, created_at timestamptz default now()
);
```

### 3.2 Aturan bisnis per action

**`recordAcquisition`** (catat closing binding):
1. Validasi: creator ada; `lead_source` salah satu dari 3; `binding_date` format ISO.
2. **Snapshot `commission_share` saat binding** — nilai ini sync platform & bisa berubah; snapshot membekukan kondisi saat closing (untuk sengketa/OKR).
3. Hitung **GMV 30 hari sebelum binding** dari `creator_period_summary` (`period_start` dalam `[binding-30d, binding]`) — baseline log-only.
4. Hitung `quarter_end` = akhir quartal kalender dari binding_date:
   ```
   q = ceil(bulan / 3);  bulanAkhir = q*3;  quarter_end = hariTerakhir(tahun, bulanAkhir)
   // binding 20 Feb → 31 Mar
   ```
5. Insert; **specialist = actor sendiri** (kinerja pribadi — Lead melihat agregat tim, bukan menginput atas nama orang).
6. Creator `status='prospek'` → naikkan ke `binding`. (Ini aksi menambah income → `auto`, tetap ter-audit.)

**`recordReferral`**:
- `antar_creator` **wajib** punya `referrer_creator_id`; `platform` justru **tanpa** perujuk (set null). Dua mekanisme komisinya beda — jangan disatukan.
- Validasi kedua creator ada di master.

**`markReferralPaid`** (permission terpisah — dimensi pembayaran: lead/finance/management):
- Guard: sudah `dibayar` → tolak (idempotent-by-rejection). Audit before/after.

**`markHandoffDone`** (handoff ke CM):
- **Prasyarat keras**: creator sudah punya `owner_cpm_id` — belum di-assign → tolak dengan pesan mengarahkan ("minta CM Lead assign dulu di CM Workspace"). Handoff bukan sekadar toggle; ia menjamin tidak ada kreator "yatim".
- Sukses → `handoff_done=true` + creator status → `aktif`.

**`refreshGmvPostJoin`** (job hitung ulang, deterministik):
```
window = config m8.gmv_post_join_days
untuk tiap acquisition dengan binding_date:
  gmv_post_join    = Σ affiliate_gmv creator_period_summary
                     WHERE period_start ∈ [binding_date, binding_date + window)
  gmv_quarter_actual = Σ affiliate_gmv WHERE period_start ∈ [binding_date, quarter_end]
```
Catatan grain: basis per-**periode/minggu** (period_start dalam window), bukan per-hari — konsisten dengan tabel agregat.

### 3.3 Tampilan workspace

- Closing per specialist & per sumber lead (inbound/outbound/platform).
- Daftar referral + status komisi.
- Antrean handoff (binding tapi belum handoff) dengan blocker "belum ada CPM".
- Tombol refresh GMV post-join (job di atas).

---

## Checklist Porting per Fitur

Gunakan sebagai definition-of-done saat replikasi:

**Semua fitur:**
- [ ] Semua mutasi menulis audit log (actor, before/after, type)
- [ ] Semua threshold dari tabel config, nol angka hardcode
- [ ] Server action return `{ok, error}` — tidak pernah throw mentah ke client
- [ ] Otorisasi di server (bukan hanya menyembunyikan UI)

**Upload mingguan:**
- [ ] Validasi W1–W5 exact-match + tolak lintas bulan, pesan menyebut window valid
- [ ] batch_id mengandung hash file; replace scoped per (creator × minggu)
- [ ] Baris Summary di-skip; baris tanpa product/shop id di-skip dengan alasan
- [ ] `items_sold=0` tetap dihitung GMV-nya
- [ ] ctr/ctor weighted-by-GMV; live_pct guard div-0 → null
- [ ] Raw rows tidak pernah masuk DB
- [ ] Auto-create creator yang belum ada + laporkan
- [ ] `creators.gmv` = rata-rata bulanan dari seluruh histori, dihitung ulang pasca-ingest

**CM Workspace:**
- [ ] Scope CPM = kreator sendiri; Lead/management lintas
- [ ] Minggu tanpa data = null, bukan 0 (delta dihitung vs minggu TERISI sebelumnya)
- [ ] Alert perf_drop dari config + auto-resolve saat pulih
- [ ] Request ads > cap → jalur approval; sample → auto

**Jadwal Live:**
- [ ] Multi-slot per creator per hari diizinkan
- [ ] Slot done terkunci dari edit/delete
- [ ] Copy week: reset status/PK/TAP/verifikasi, skip OFF, tolak bila target terisi
- [ ] Date math pakai string wall-clock, bukan objek Date lokal

**Deal:**
- [ ] Form baru: shop_id numeric+unik, exp_date date-picker, komisi number (bukan teks)
- [ ] exp_date selalu sync ke cooperating_shops.deal_end + active_flag
- [ ] Importer legacy: tidak pernah crash; field kotor → null + review_flags
- [ ] Simpan komisi dua kolom: raw + pct

**Acquisition:**
- [ ] Snapshot commission_share saat binding
- [ ] Handoff diblok sampai creator punya owner CPM
- [ ] Referral antar_creator wajib perujuk; platform tanpa perujuk
- [ ] GMV post-join & quartal dihitung dari tabel agregat, window dari config
