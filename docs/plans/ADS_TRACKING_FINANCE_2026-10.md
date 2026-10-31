# Plan Build — Tracking Ads (Jadwal Live + Special Project) & Akses Finance (2026-10)

Sumber request: pesan Yohan 2026-10-31 (sesi Claude Code). Status: **DISETUJUI 2026-10-31** — jawaban Yohan dicatat di `docs/DECISIONS.md` D-2026-10-31-1…7 (lihat §4). Dieksekusi T0 → T10.
Repo yang disentuh: **hanya `mcnapp`**. `AgencyAPP` (CDPS) dibaca sebagai rujukan pola (M5 Admin Finance,
M8 Ads, permintaan Top-up Saldo) — tidak ada perubahan di sana (lihat §6).

---

## 0. Kebutuhan (ringkasan request)

1. Jadwal Live (M13) dan Special Project (M7) sama-sama butuh **tracking penggunaan ads**: sesi live
   tertentu memakai ads, dan project yang berisi live mengeluarkan ads budget.
2. Ads punya **empat tipe pendanaan**:
   - **Budget MEA** — MEA yang bayar; tiap kreator punya jatah budget MEA **per bulan**.
   - **Creator budget** — kreator (atau brand lewat kreator) yang bayar; **cash di awal** atau
     **invoice dibayar belakangan** → butuh **tanggal pembayaran**.
   - **Brand budget** — brand yang bayar.
   - **TikTok Ads credit** — kredit/voucher iklan dari platform.
3. Semua tipe lewat **Finance**: cek & ACC, **buat invoice** untuk penagihan langsung ke klien,
   **pengingat penagihan**, dan **pencatatan tanggal pembayaran**.
4. Finance **belum punya akses** yang memadai di MCN app.
5. Untuk menjalankan ads, **req ads dikirim ke executor = Creator Support** dari MCN app.
6. **Hanya CM** yang boleh membuat req ads.

---

## 1. Yang SUDAH ada di mcnapp (hasil baca kode, 2026-10-31)

| Area | Yang ada sekarang | File / tabel | Celah terhadap kebutuhan |
|---|---|---|---|
| Jadwal Live (M13) | Slot punya `ads_payer` (`brand` / `mea` / `invoicing_mea` / `organik`) + `ads_note` (teks bebas "nominal & detail"). Ditampilkan di board, compact list, export. | `live_schedule_slots` (0023), `schedule/slot-form.tsx`, `lib/schedule/indicators.ts` | Hanya label. Tidak ada nominal terstruktur, tidak ada alur req → executor, tidak ada Finance, tidak ada tanggal bayar. Enum tidak memuat creator budget cash vs invoice dan TikTok credit. |
| Special Project (M7) | `special_projects.ads_budget_cap`; `project_daily_metrics.ads_spend = ads_spend_manual + project_ads_spend_v` (view dari hasil M10); `project_participants.ads_by` (`MEA` / `Brand`, catatan); alert `project_rugi` & `project_over_cap` (event, bukan approval). Finance sudah punya `m7.metrics`. | `0001`, `0012`, `0072`, `projects/[id]/page.tsx`, `lib/m7/tracking.ts` | Ads spend tidak dibedakan siapa yang bayar → margin project menghitung ads yang dibayar brand seolah biaya MEA. `ads_by` hanya catatan per peserta, tidak terhubung ke req/nominal. |
| Req ads jalur 1 — M8 CM Workspace | `creator_requests` type `ads` (+ `amount`), dicek ke `creators.ads_budget_cap` (angka statis per kreator, bukan per bulan); lewat cap → approval Director (`m8.ads_approve`); diproses **BizDev** (`m8.request_process`). Status `diajukan / diproses / selesai`. | `0006`, `workspace/cm/actions.ts`, `lib/m8/routing.ts` | Executor-nya BizDev, bukan Creator Support. Tidak tahu tipe pendanaan. Tidak terhubung ke slot/project. |
| Req ads jalur 2 — M10 Ads Support Portal | `ads_briefs` (source `cm` / `bizdev`; `creator_id` / `deal_id` / `project_id`; `budget_requested` / `budget_approved`; status `baru → menunggu_approval → dikerjakan → selesai / batal`; `assigned_to`) + `ads_campaign_results` (`ads_spent`, `gmv`, `roas` per brief per periode — **satu-satunya sumber ads spend** yang dibaca M7). Executor = `campaign_ops` + `ads_support`. | `0012`, `workspace/ads/*`, `lib/m10/ads.ts` | UI masih prototipe (ketik `creator_id`/`brief_id` manual). Executor bukan Creator Support. BizDev ikut bisa membuat. Tidak ada tipe pendanaan, Finance, invoice, tanggal bayar, slot jadwal. |
| Project BD (BizDev) | `bd_projects.status_payment` (`done` / `proses_finance_payment` / `proses_finance_brand` / `ads_by_brand`), `bd_project_shop_budgets` (Ads Budget & Service Fee per project × shop), `bd_project_shops.ads_support` (skema ads brand dari sheet). | `0044`–`0048`, `0097` | Ini **kesepakatan komersial dengan brand** (nominal deal), bukan realisasi belanja ads per sesi. Dibiarkan, dipakai sebagai rujukan "brand budget" (§2.3). |
| Role Finance | Nav: Dasbor, OKR, Kreator, Deal Brand, Project BD, Special Project. Izin: `deals.edit`, `m7.metrics`, `m8.referral_pay`. | `rbac-constants.ts` | Tidak ada antrean kerja Finance, tidak ada invoice/pembayaran, tidak ada dashboard penagihan (PRD M01 §3.1 butir 2 "Finance lihat dashboard pembayaran" belum dibangun). |
| Role Creator Support | `schedule.view/edit/verify`, `creators.edit`. PRD M01 §2.1 F: "menjalankan ads & monitoring live di luar jam kerja CPM … administrasi invoicing terkait". | `rbac-constants.ts` | Tidak punya izin eksekusi ads apa pun (`m10.brief_execute` = management + campaign_ops + ads_support). |
| Notifikasi | `platform_alerts` (feed event) + badge sidebar dihitung dari sumber saat render (`pic-tap-alerts.ts`, `contract-alerts.ts`); job pg_cron sudah dipakai (`0076` auto-verify, `0095` rollup). | — | Belum ada tipe alert untuk invoice jatuh tempo / budget MEA habis. Pola yang sama bisa dipakai. |

**Kesimpulan:** bahan dasarnya sudah ada tetapi **terpecah di dua jalur req ads** (M8 `creator_requests` vs
M10 `ads_briefs`) yang executor-nya salah (BizDev / ads_support, bukan Creator Support) dan tidak mengenal
pendanaan maupun Finance. Yang harus dibangun bukan modul baru dari nol, melainkan **satu jalur Request Ads**
di atas `ads_briefs` (karena `ads_campaign_results.ads_spent`-nya sudah menjadi sumber tunggal ads spend M7 —
CLAUDE.md #4), lalu lapisan Finance di atasnya.

---

## 2. Desain yang diusulkan

### 2.1 Satu entitas: **Request Ads** (= `ads_briefs` diperluas, bukan tabel baru)

Pemilik request = tepat satu dari (pola `project_live_sessions` 0066):
- `schedule_slot_id` → slot Jadwal Live (kreator, tanggal, brand/shop_key ikut dari slot), **baru**;
- `project_id` (+ `creator_id` peserta, opsional) → Special Project, **sudah ada**.
`deal_id` tetap ada untuk brief lama; request baru tidak lagi memakainya sebagai pemilik.

Kolom baru di `ads_briefs` (migrasi `0100`):

| Kolom | Isi |
|---|---|
| `schedule_slot_id bigint → live_schedule_slots` | pemilik slot; `ck_ads_brief_owner` = tepat satu dari (`schedule_slot_id`, `project_id`) untuk baris baru (baris lama `deal_id`-only dikecualikan lewat `created_at < tanggal migrasi`) |
| `funding_type text` | `mea_budget` / `creator_budget` / `brand_budget` / `tiktok_ads_credit` |
| `payment_method text` | hanya untuk `creator_budget` (dan `brand_budget` bila Q3 = ya): `cash_upfront` / `invoice` |
| `payer_name text` | nama kreator/brand yang ditagih (prefill dari slot/peserta) |
| `budget_month date` | bulan jatah budget MEA yang dipakai (hanya `mea_budget`), = bulan tanggal live |
| `finance_status text` | `belum_dicek` / `disetujui` / `ditolak` |
| `finance_checked_by uuid`, `finance_checked_at`, `finance_note` | jejak ACC Finance |
| `cash_received_at date` | tanggal uang masuk untuk `cash_upfront` (syarat ACC) |
| `executed_by uuid`, `executed_at` | Creator Support yang menjalankan (menggantikan makna `assigned_to`) |

Kolom `status` dipertahankan tetapi tabel transisinya diperluas (§2.4). `ads_campaign_results` tidak berubah:
tetap satu baris per (request, periode) dengan `ads_spent` sebagai realisasi.

Pemetaan nilai lama `live_schedule_slots.ads_payer` → `funding_type`: `mea → mea_budget`,
`brand → brand_budget`, `invoicing_mea → creator_budget + invoice`, `organik → tidak ada request`.
Kolom `ads_payer`/`ads_note` di slot **tidak dihapus** (data & export lama), tetapi form slot tidak lagi
menanyakannya untuk slot baru — diganti tombol **"Request Ads"** (Q6).

### 2.2 Jatah budget MEA per kreator per bulan

- Tabel `creator_ads_monthly_budgets (creator_id, month date, budget numeric, set_by, set_at)`; PK
  (creator_id, month). Nilai default dari `app_config m10.mea_monthly_budget_default` (bisa 0 = tidak ada
  jatah) — jadi baris hanya perlu dibuat untuk kreator yang jatahnya beda dari default.
- **Terpakai** = Σ `budget_approved` request `mea_budget` bulan itu yang statusnya bukan `batal`/`ditolak`
  (view `creator_mea_budget_usage_v`, agregasi di SQL). Realisasi = Σ `ads_spent` hasil.
- Request `mea_budget` yang membuat terpakai > jatah → **approval Director** (reuse `m10.budget_approve`,
  CLAUDE.md #2: aksi manusia berpotensi merugikan). Lewat jatah tanpa approval tidak mungkin.
- `creators.ads_budget_cap` (statis) **dipensiunkan** sebagai basis cek; dibiarkan sebagai kolom lama.
- Siapa yang menetapkan jatah: `m10.mea_budget_set` = management + `cm_lead` (Q4).

### 2.3 Tipe pendanaan dan apa yang dilakukan Finance

| `funding_type` | Siapa bayar | Gate Finance sebelum eksekusi | Invoice | Tanggal bayar |
|---|---|---|---|---|
| `mea_budget` | MEA | Cek & ACC (cocokkan jatah bulan, nominal wajar) | tidak | tidak |
| `creator_budget` + `cash_upfront` | kreator/brand lewat kreator | ACC hanya setelah `cash_received_at` diisi Finance | tidak (kuitansi = audit log) | `cash_received_at` |
| `creator_budget` + `invoice` | kreator/brand lewat kreator | ACC → invoice terbit; eksekusi boleh jalan sebelum lunas | **ya** | `paid_at` di invoice |
| `brand_budget` | brand (transfer / barcode / invoice ke brand — skema ada di `m8.ads_support_options`) | Cek & ACC | **Q3** | tergantung Q3 |
| `tiktok_ads_credit` | platform | Cek & ACC (nomor/nominal kredit) | tidak | tidak |

### 2.4 Mesin status Request Ads (tabel transisi, ditegakkan server + test)

```
diajukan ──(mea_budget lewat jatah)──▶ menunggu_approval_director ──approve──▶ menunggu_finance
diajukan ──(lainnya)────────────────────────────────────────────────────────▶ menunggu_finance
menunggu_approval_director ──tolak──▶ ditolak
menunggu_finance ──ACC Finance──▶ siap_dieksekusi ──Creator Support klaim──▶ dikerjakan ──input hasil (final)──▶ selesai
menunggu_finance ──tolak Finance──▶ ditolak
diajukan / menunggu_* / siap_dieksekusi ──CM batalkan──▶ batal
```

Pesan validasi Bahasa Indonesia dalam kurung siku, contoh:
`[request ads masih menunggu ACC Finance — belum bisa dieksekusi]`,
`[pembayaran cash belum tercatat, isi tanggal uang masuk sebelum ACC]`,
`[jatah budget MEA bulan ini tersisa Rp X, request melebihi — butuh approval Director]`,
`[hanya CM pemilik kreator yang boleh membuat request ads]`.

Nilai lama `baru` / `menunggu_approval` / `dikerjakan` / `selesai` / `batal` dipetakan di migrasi
(`baru → menunggu_finance`? **Q8**).

### 2.5 Invoice & pembayaran (Finance)

- `ads_invoices` — `id text PK` format `INV-YYYYMM-NNNN` (generator terpusat, pola ID entity CLAUDE.md),
  `request_id`, `bill_to_type` (`creator` / `brand`), `bill_to_name`, `amount`, `issued_at`, `due_date`
  (= issued + `app_config m10.invoice_due_days`), `status` (`terbit` / `lunas` / `batal`), `paid_at`,
  `paid_amount`, `proof_url`, `note`, `created_by`. Flag **jatuh tempo** dihitung (`due_date < today` dan
  belum lunas), tidak disimpan — sama dengan pola CDPS M5.
- `ads_invoice_events` — append-only (`invoice_id`, `event` = `dibuat` / `dikirim` / `diingatkan` /
  `dibayar` / `dibatalkan`, `actor`, `payload`, `created_at`), trigger tolak UPDATE/DELETE.
- Satu request = maksimal satu invoice aktif (unique parsial `request_id where status <> 'batal'`).
- Nomor invoice **tidak pernah dipakai ulang**; batal = status, bukan hapus.
- Pengingat penagihan (§2.6) membaca `ads_invoices` saja.

### 2.6 Pengingat & notifikasi (deterministik, 0 LLM)

- Badge sidebar untuk **Finance**: jumlah request `menunggu_finance` + invoice jatuh tempo ≤ H-`m10.invoice_reminder_days`
  dan yang sudah lewat. Dihitung saat render dari sumber (pola `pic-tap-alerts.ts`).
- Badge untuk **Creator Support**: request `siap_dieksekusi` yang live-nya hari ini/besok.
- Badge untuk **CM**: request miliknya yang `ditolak` atau invoice kreatornya jatuh tempo.
- `platform_alerts` tipe baru (membaca bentuk constraint `= ANY (...)` seperti 0083): `ads_invoice_due`,
  `ads_invoice_overdue`, `ads_mea_budget_exhausted`. Ditulis oleh job pg_cron harian 06:00 WIB (pola 0076),
  idempoten per (invoice, tipe, hari).

### 2.7 Dampak ke Jadwal Live & Special Project

- **Slot Jadwal Live**: tombol "Request Ads" (hanya tampil untuk CM pemilik kreator slot) membuka form
  request terprefill (kreator, tanggal, brand/shop_key). Kartu slot menampilkan badge pendanaan + status
  request (bukan lagi `ads_payer`). Compact list & export: kolom "Pembayar Ads" dibaca dari request bila ada,
  jatuh ke `ads_payer` lama bila tidak.
- **Special Project**: tombol "Request Ads" di tab Performa per Kreator (per peserta) dan di header project.
  Panel biaya memisahkan ads per `funding_type`; **margin MEA hanya mengurangkan ads `mea_budget`** (Q7).
  `project_ads_spend_v` ditambah view `project_ads_spend_by_funding_v`; `ads_spend_manual` tetap ada untuk
  project lama.
- **Alert `project_over_cap`** tetap membandingkan total ads MEA terhadap `ads_budget_cap` project.

### 2.8 RBAC

| Izin | Role | Catatan |
|---|---|---|
| `m10.brief_create` | **hanya `cm_lead`, `cpm`** (+ management) | BizDev **dicabut** (Q1). CPM hanya kreator miliknya (`assertCreatorInScope`). |
| `m10.brief_execute` | management + **`creator_support`** (+ `campaign_ops`, `ads_support` tetap? **Q2**) | executor klaim & input hasil |
| `m10.result_input` | sama dengan execute | |
| `m10.budget_approve` | `director` | lewat jatah MEA (tetap) |
| `m10.mea_budget_set` (baru) | management + `cm_lead` | jatah per kreator per bulan |
| `finance.ads_review` (baru) | `finance` + management | ACC / tolak request |
| `finance.invoice_manage` (baru) | `finance` + management | terbit / batal invoice, catat pembayaran |
| `finance.view` (baru) | `finance`, management, `od_viewer` (read) | halaman `/finance` |

Nav: grup baru **"Finance"** berisi `/finance` (Antrean & Penagihan Ads) untuk `finance` + management;
menu "Ads Support (M10)" diganti nama **"Request Ads"** (`/ads`) di grup *Project & Campaign* untuk
CM + Creator Support + management (+ Q2). Dijaga `rbac.test.ts` (od_viewer tetap tanpa izin tulis).

---

## 3. Tiket (1 tiket = 1 PR, urut)

| # | Tiket | Isi | Bergantung pada |
|---|---|---|---|
| T0 | Keputusan | Jawaban Q1–Q10 → `docs/DECISIONS.md` (satu entri per keputusan) + update plan ini | — |
| T1 | Migrasi `0100_ads_request_finance.sql` | kolom baru `ads_briefs` + constraint pemilik; `creator_ads_monthly_budgets`; `ads_invoices` + `ads_invoice_events` (append-only trigger); view `creator_mea_budget_usage_v`, `project_ads_spend_by_funding_v`; tipe `platform_alerts` baru; `app_config` (`m10.mea_monthly_budget_default`, `m10.invoice_due_days`, `m10.invoice_reminder_days`); RLS: deny `is_creator_user()` RESTRICTIVE di semua tabel/view baru, `security_invoker` di view; pemetaan status lama. **Tanpa `DROP POLICY/TRIGGER`** (K23). Test `missing-migration.test.ts`. | T0 |
| T2 | RBAC & nav | izin §2.8, grup nav Finance, rename menu, `rbac.test.ts` | T0 |
| T3 | `lib/m10/request.ts` (murni, test dulu) | tabel transisi + pesan `[...]`, `needsDirectorApproval(usage, jatah, nominal)`, `financeGate(funding, paymentMethod, cashReceivedAt)`, `invoiceDue(issuedAt, dueDays)`, generator `INV-`; spec pendanaan satu file (`lib/m10/funding-spec.ts`: enum, label BI, aturan) — **jangan ada versi kedua** di UI | T0 |
| T4 | Request Ads UI (`/ads`) | daftar per role (CM: miliknya; Creator Support: antrean eksekusi; management: semua) · form request terprefill dari slot & project (server action `createAdsRequest`, scope CPM) · klaim & input hasil · batalkan · audit_logs tiap mutasi. Mengganti form prototipe `workspace/ads/page.tsx` (redirect `/workspace/ads → /ads`). | T1–T3 |
| T5 | Finance (`/finance`) | antrean `menunggu_finance` (ACC / tolak + catatan; cash → wajib `cash_received_at`) · terbit invoice (nomor otomatis, tampilan cetak HTML) · catat pembayaran (`paid_at`, nominal, bukti) · tabel piutang (filter jatuh tempo) · riwayat `ads_invoice_events` | T1–T3 |
| T6 | Integrasi Jadwal Live | tombol Request Ads di slot, badge pendanaan/status, compact list & export, form slot tidak lagi menanyakan `ads_payer` untuk slot baru, `copy-week` tidak menyalin request | T4 |
| T7 | Integrasi Special Project | tombol Request Ads per peserta/project, panel biaya per pendanaan, margin MEA (Q7), `project_over_cap` memakai ads MEA | T4 |
| T8 | Pensiunkan jalur lama | `creator_requests` type `ads` tidak bisa dibuat lagi (form CM Workspace mengarah ke `/ads`; `sample`/`hsl` tetap), `adsNeedsDirectorApproval` M8 diganti pemanggilan T3; `creators.ads_budget_cap` tidak dibaca lagi | T4 |
| T9 | Pengingat & badge | job pg_cron harian (`platform_alerts`), badge sidebar Finance / Creator Support / CM (dihitung saat render) | T5 |
| T10 | Dokumentasi | CLAUDE.md #10 "Request Ads & Finance" (sumber tunggal, aturan read-only invoice), tutorial `docs/TUTORIAL_REQUEST_ADS_FINANCE.md`, HANDOFF | T4–T9 |

Verifikasi tiap PR: `npx tsc --noEmit`, `npx vitest run` (tes transisi, jatah budget, invoice, RBAC,
immutability event invoice), `npx next build`; migrasi diuji di **staging** dulu (D-2026-10-20-8), apply ke
produksi menunggu persetujuan Yohan.

---

## 4. Pertanyaan Q1–Q10 — DIJAWAB 2026-10-31 (ringkasan; detail di DECISIONS.md)

| # | Jawaban Yohan |
|---|---|
| Q1 | Pembuat request = CM, BizDev, Campaign Ops (D-1). |
| Q2 | ads_support & creator_support = satu divisi → executor `creator_support` (D-2). |
| Q3 | Brand budget juga cash di awal / invoice (D-3). |
| Q4 | Jatah MEA beda per kreator, ditetapkan Head, sisa hangus (D-4). |
| Q5 | Cash → Finance cek uang masuk; invoice → ACC Head CM atau Finance (D-3). |
| Q6 | Default (slot baru tanpa ads_payer) (D-7). |
| Q7 | Ya, margin hanya ads MEA (D-5). |
| Q8 | Default (brief lama dibiarkan) (D-7). |
| Q9 | PDF, template menyusul, PPN otomatis, tanpa sinkron CDPS (D-6). |
| Q10 | Default (in-app) (D-6). |

Tabel pertanyaan asli dipertahankan di bawah sebagai arsip.

### Arsip pertanyaan

| # | Pertanyaan | Usulan default kalau tidak dijawab |
|---|---|---|
| Q1 | "Hanya CM yang bisa membuat req ads" — berlaku juga untuk Special Project dan live brand deal yang slotnya diinput BizDev? Artinya BizDev **tidak** bisa lagi membuat brief ads (sekarang bisa). | Ya, hanya CM (`cm_lead`, `cpm`) + management. BizDev meminta ke CM pemilik kreator. |
| Q2 | Executor = Creator Support. Role `ads_support` & `campaign_ops` (M10 lama) masih ikut mengeksekusi, atau dicabut? | Creator Support utama; `campaign_ops`/`ads_support` **tetap** boleh (tidak merugikan), management juga. |
| Q3 | **Brand budget**: brand bayar langsung ke TikTok (barcode/transfer) atau MEA menagih brand lewat invoice? Kalau keduanya ada, `payment_method` (cash/invoice) berlaku juga untuk brand. | Keduanya: `brand_budget` punya `payment_method` juga; `barcode/transfer langsung` = `cash_upfront` dengan tanggal konfirmasi. |
| Q4 | Jatah budget MEA per kreator per bulan: angka **seragam** (satu default) atau **beda per kreator**? Siapa yang menetapkan? Sisa bulan lalu hangus? | Default seragam di `app_config` + override per kreator-bulan oleh management/CM Lead; sisa hangus (tidak carry-over). |
| Q5 | Urutan gate: Finance ACC **sebelum** eksekusi untuk SEMUA tipe (termasuk `mea_budget` & TikTok credit), atau untuk `mea_budget` Finance hanya memantau? | Semua tipe lewat Finance sebelum eksekusi (sesuai kalimat "semua mode butuh finance cek & acc"). |
| Q6 | Slot Jadwal Live: `ads_payer`/`ads_note` lama dihentikan untuk slot baru (diganti tombol Request Ads), atau tetap ditanyakan sebagai catatan? | Dihentikan untuk slot baru; data lama tetap tampil. |
| Q7 | Margin Special Project: ads yang dibayar brand/kreator/credit **tidak** mengurangi revenue MEA (hanya `mea_budget`)? | Ya — hanya ads MEA yang jadi biaya MEA; tipe lain tampil sebagai informasi. |
| Q8 | Brief M10 lama (status `baru` / `dikerjakan`, belum ada tipe pendanaan): dipetakan ke `menunggu_finance` (Finance cek ulang) atau ditandai `funding_type = null` dan dibiarkan selesai apa adanya? | Dibiarkan apa adanya (`funding_type` null, status lama tetap), hanya request baru yang wajib pendanaan. |
| Q9 | Invoice: cukup nomor + tampilan cetak HTML dari MCN app, atau harus sinkron ke sistem finance existing / CDPS (`TRX-`/`installments`)? Butuh PPN? | Nomor + cetak HTML di MCN app, tanpa PPN, tanpa sinkron (CDPS = klien agency, bukan kreator MCN). |
| Q10 | Pengingat penagihan: cukup badge + feed alert di MCN app (in-app), atau perlu kirim WA/email ke kreator/brand? | In-app saja (konsisten dengan notifikasi lain); tombol "salin teks tagihan" untuk dikirim manual via WA. |

---

## 5. Risiko & catatan desain

- **Jangan bikin tabel request kedua.** `ads_campaign_results.ads_spent` sudah dibaca M7 lewat
  `project_ads_spend_v`; memindahkan request ke tabel baru memutus sumber tunggal itu.
- `creator_requests` type `ads` dan `creators.ads_budget_cap` adalah **duplikasi logika** yang sudah ada
  (jalur 1 vs 2) — T8 menutupnya, bukan menambah jalur ketiga.
- Invoice & event pembayaran = **riwayat immutable** (trigger tolak update/delete pada `ads_invoice_events`;
  `ads_invoices` hanya berubah status/tanggal lewat server action beraudit).
- Nilai threshold/durasi (jatah default, hari jatuh tempo, H-berapa pengingat) **wajib** di `app_config`.
- Semua tabel/view baru wajib restrictive deny `is_creator_user()` (CLAUDE.md #9 aturan umum).
- Migrasi dikirim ke `apply_migration` **tanpa** `DROP POLICY/TRIGGER` (catatan K23, HANDOFF 2026-10-13).

---

## 6. Rujukan dari CDPS (AgencyAPP) — dibaca, tidak diubah

- **M5 Admin Finance** (`docs/prd/CDPS_Module5_Admin_Finance.md`, `packages/domain/src/finance.ts`):
  transaksi = invoice, `installments` dengan `due_date`, `reminder_h3_sent_at`, `overdue_notified_at`;
  flag *jatuh tempo* dihitung, bukan status; `payment_verifications` append-only; pengingat H-3 ke Finance +
  PIC. → pola yang sama dipakai §2.5–2.6 (skala lebih kecil: satu invoice per request, tanpa termin).
- **M8 Ads** (`docs/prd/CDPS_Module8_Ads.md`): sumber dana `klien` / `paket_mea` di `strategi_resource`,
  **Top-up Saldo** = permintaan `REQ-` yang dirutekan ke Finance (`[Diajukan] → [Diproses] → [Selesai]`).
  → gagasan "request → Finance → eksekusi" sama dengan §2.4.
- Bridge CDPS↔MCN yang ada (MSDPS order, PX) **tidak menyentuh ads/finance**; sinkron invoice MCN ke CDPS
  **tidak** direncanakan (Q9).

---

## 7. Status eksekusi (2026-10-31, PR #139, branch `claude/ads-tracking-finance-mcn-c0e49s`)

**Selesai (T0–T10), semua di-push dan tsc/vitest/build hijau:**

| Tiket | Hasil | File utama |
|---|---|---|
| T0 | Keputusan Yohan dicatat | `docs/DECISIONS.md` D-2026-10-31-1…7 |
| T1 | Migrasi 0100 — **sudah di-apply & diverifikasi di STAGING** (`fomlangoiiywhexwoqom`), **belum di produksi** | `supabase/migrations/0100_ads_request_finance.sql` |
| T2 | RBAC & nav | `src/lib/rbac-constants.ts` (`ADS_REQUESTER_ROLES`, `ADS_EXECUTOR_ROLES`, `finance.*`, `m10.mea_budget_set`, nav `/ads` + grup Finance `/finance`), `src/lib/nav-ui.ts`, `src/lib/__tests__/rbac.test.ts` |
| T3 | Lib murni + 19 test | `src/lib/m10/funding-spec.ts`, `src/lib/m10/request.ts`, `src/lib/m10/__tests__/request.test.ts` |
| T4 | Halaman Request Ads | `src/app/(portal)/ads/{page,actions}.tsx`, `ads/baru/{page,request-form}.tsx`, `ads/[id]/{page,request-actions}.tsx`, `ads/jatah/{page,mea-budget-form}.tsx`, pemuat `src/lib/m10/request-data.ts`, badge `src/components/ads-request-badge.tsx` |
| T5 | Halaman Finance + invoice PDF | `src/app/(portal)/finance/{page,actions}.tsx`, `finance/invoice/[id]/{page,invoice-actions}.tsx`, `finance/invoice/[id]/pdf/route.ts`, `src/lib/m10/invoice-data.ts`, `src/lib/m10/invoice-pdf.ts` (pdf-lib, layout placeholder) |
| T6 | Jadwal Live | `schedule/slot-form.tsx` (tombol Request Ads, `ads_payer` lama hidden), `schedule-board.tsx` (badge), `schedule/page.tsx` (muat request per slot), `src/lib/schedule/types.ts` (`SlotAdsRequestSummary`) |
| T7 | Special Project | `projects/[id]/page.tsx` (panel ads per pendanaan, tombol Request Ads per peserta, margin hanya ads MEA) |
| T8 | Jalur lama ditutup | `workspace/cm/{page,actions}.tsx` (type `ads` ditolak), `workspace/ads/page.tsx` → redirect `/ads` |
| T9 | Badge & pengingat | `src/lib/m10/badges.ts`, `(portal)/layout.tsx`; cron `run_m10_invoice_reminders()` di 0100 |
| T10 | Dokumentasi | CLAUDE.md #10, `docs/TUTORIAL_REQUEST_ADS_FINANCE.md`, HANDOFF.md |

**Sisa pekerjaan (urutan yang disarankan untuk sesi berikutnya):**

1. **Apply 0100 ke produksi** (`bqknstylbpwsnlgnzayw`) lewat `apply_migration` — hanya setelah Yohan menyetujui
   (D-2026-10-20-8). Setelah apply, verifikasi dengan query yang sama seperti staging: 7 kolom `ads_briefs`,
   3 tabel, 3 view, 3 policy deny RESTRICTIVE, trigger `trg_ads_invoice_events_immutable`, 3 `app_config m10.invoice_*`,
   constraint `platform_alerts` memuat `ads_invoice_due/overdue/ads_mea_budget_exhausted`, job cron `m10_invoice_reminders`.
   Catatan: constraint `platform_alerts_alert_type_check` berbentuk `= ANY('{…}'::text[])` — blok di 0100 sudah
   membaca bentuk itu (diperbaiki 2026-10-31 setelah ketahuan di staging).
2. **Buat akun role `finance`** di `/tim` (produksi belum punya satu pun). Tanpa itu tidak ada yang bisa ACC cash
   atau mencatat pembayaran invoice.
3. **Template invoice resmi** dari Yohan → ganti layout di `src/lib/m10/invoice-pdf.ts` (`buildInvoicePdf`);
   pemanggilnya (`/finance/invoice/[id]/pdf`) tidak perlu diubah.
4. **QA manual per role di staging**: CPM buat request dari slot Jadwal Live (cek sisa jatah MEA & scope kreator) →
   Head/Director set jatah di `/ads/jatah` → Finance catat uang masuk & ACC (cash) / Head CM ACC (invoice → invoice
   terbit) → Creator Support klaim, input realisasi, selesai → Finance unduh PDF, catat terkirim, catat lunas →
   cek margin Special Project hanya memakai ads MEA.
5. **Konfirmasi asumsi A1** (D-2026-10-31-3): ACC Budget MEA & TikTok credit oleh Head CM atau Finance. Bila
   Yohan ingin lain → ubah `accRolesFor()` di `src/lib/m10/request.ts` + test + DECISIONS.
6. Opsional: `compact-list.tsx` Jadwal Live masih menampilkan kolom "Pembayar Ads"/"Catatan Ads" dari nilai lama;
   kalau mau, ganti sumbernya ke request (pola `SlotAdsRequestSummary` di board).
7. Opsional: alert `ads_mea_budget_exhausted` sudah terdaftar di constraint tetapi belum ada penulisnya —
   kandidat: tulis saat `checkMeaBudget().remaining === 0` di `createAdsRequestAction`.

### 7.1 Sesi lanjutan 2026-10-31 (PR #139 sudah merge → PR baru dari `claude/ads-tracking-finance-mcn-xk3imf`)

| Butir | Status |
|---|---|
| 1. Apply 0100 ke produksi | **Selesai 2026-10-31** (disetujui Yohan) — terverifikasi: 7 kolom `ads_briefs`, 3 tabel, 3 view, 3 policy deny RESTRICTIVE, trigger immutable, 3 `app_config m10.invoice_*`, constraint `platform_alerts` memuat 3 tipe baru (tipe lama termasuk `partnership_drop` tetap), job cron `m10_invoice_reminders` `0 23 * * *` aktif. 0098 tetap ditunda (tidak terkait). |
| 2. Akun role `finance` | **Menunggu Management** — Finance = Endang Puji Astuti (`endangpujia046@gmail.com`). Dibuat lewat `/tim` → Tambah anggota (izin `team.add_single` = director/head/spv), role `finance`; password sementara dikirim lewat WA. Tidak bisa dari sesi agent (butuh Auth Admin). |
| 3. Template invoice resmi | **Belum** — template belum dikirim; `buildInvoicePdf` tetap placeholder. |
| 4. QA manual per role di staging | **Belum** — butuh akun per role di staging (checklist tetap di butir 4 di atas). |
| 5. Asumsi A1 | **Dikonfirmasi** — A1 tetap (DECISIONS D-2026-10-31-3). |
| 6. `compact-list.tsx` | **Selesai** — kolom "Request Ads" + "Nominal / Catatan Ads" + facet "Pendanaan Ads" dari request (`loadSlotAdsRequestSummaries` + `slotAdsDisplay`, dipakai juga kalender); slot lama = "(lama)". |
| 7. Alert `ads_mea_budget_exhausted` | **Selesai** — `lib/m10/mea-budget-alert.ts` (`syncMeaBudgetExhaustedAlert`), dipanggil saat buat request, `applyTransition`, dan set jatah; tampil di `/ads/jatah` + badge `/ads`. Tidak butuh migrasi baru (tipe sudah ada di constraint 0100). |

