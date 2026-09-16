# BUILD_PLAN_M7_V2.md — Rencana eksekusi Special Project v2 (M7/M9)

Sumber: `docs/prd/MCN_MEA_AI_Platform_Module07_Special_Project_v2.md` (PRD v2.1, 16 Sep 2026).
Aturan tetap `CLAUDE.md`. Dokumen ini = urutan kerja + pemetaan ke migrasi/file, bukan PRD baru.
Centang `[x]` saat selesai, sama seperti `docs/BUILD_PLAN.md`.

---

## 0. Ringkasan keputusan

Urutan dibalik dari urutan flow bisnis: **mesin report dulu**, pendaftaran belakangan
(keputusan #4 PRD). Alasannya sudah terbukti di audit — tidak ada satu pun angka performa
yang masuk ke project, jadi seluruh rantai report tidak pernah menghasilkan apa pun.

Yang mengikat sepanjang plan ini:

| # | Keputusan | Konsekuensi teknis |
|---|---|---|
| K1 | Sumber performa = upload file per project oleh tim | Tidak ada sinkron otomatis dari platform; semua lewat batch + audit |
| K2 | Granularitas = per kreator per hari, tidak boleh dobel | `project_creator_metrics` PK `(project_id, creator_id, date)`, `gmv_actual` GENERATED (R21) |
| K3 | Periode project mengunci data | Baris di luar `[start_date, end_date]` dibuang saat upload, dihitung `out_of_window_count` |
| K4 | Target dua lapis, yang dilaporkan = target project | `project_participants.target_gmv` NOT NULL, tapi `achievement_pct` selalu vs target project |
| K5 | Report peserta reuse `creator_reports` | `report_period_t` += `project`, bukan tabel baru (CLAUDE.md #4) |
| K6 | Insight AI pakai mesin yang sama | `src/lib/report/insight.ts` + varian prompt `project`; tidak boleh ada engine kedua |
| K7 | SAP dicoret | Hapus `'sap'` dari CHECK `metric_upload_batches.source_type` |
| K8 | Invite portal manual oleh CPM | Tidak ada integrasi Sebari/WA di scope ini |

---

## 1. Hasil audit ulang (kode + DB live, 16 Sep 2026)

PRD menandai beberapa item `[KONFIRMASI DEV]` karena repo belum diaudit. Sudah dicek.
**Empat koreksi terhadap PRD** — plan ini memakai versi yang terkoreksi:

| PRD bilang | Kenyataan di repo/DB | Dampak ke plan |
|---|---|---|
| "Server action approve/reject join request belum ada → dibuat" (keputusan #12, §6.5) | **Sudah ada**: `decideProjectJoinRequest()` di `src/app/(portal)/projects/actions.ts:392`, gated `m9.project_join_decide`, sudah auto-insert `project_participants` + audit `type:'approval'` | Fase 2 = **memperluas** action itu (wajib `target_gmv`, status `diundang`/`waitlist`, jalur eksternal), bukan menulis dari nol. Nama action dipertahankan supaya tidak ada dua pintu keputusan |
| `project_participants` 0 baris | **1 baris**, milik project id 10 | Purge id 10 (keputusan #10) ikut menghapus peserta itu → harus masuk dump `m7.project_purge` |
| Contoh §4: ads spend 1.200.000 "dari `ads_briefs` project 9" | `ads_briefs` dengan `project_id is not null` = **0 baris**; view `project_ads_spend_v` sudah ada tapi selalu 0 | Panel biaya akan menampilkan 0 sampai tim Ads mengisi `project_id` di brief. Bukan bug — kebutuhan operasional, ditulis eksplisit di UI ("belum ada brief ads tertaut project ini") |
| `creator_reports` "hanya weekly/monthly" | Benar (22 baris, enum `report_period_t` = weekly,monthly) | Butuh `ALTER TYPE ... ADD VALUE 'project'` di **migrasi terpisah** (lihat §2.1) |

Yang sudah ada dan dipakai ulang (jangan ditulis ulang):

- `src/lib/m7/tracking.ts` — `cumulativeTargets()` / `trackDaily()` / `checkProfitability()`.
  Dashboard Fase 1 dan `result_summary` **membaca** fungsi ini, tidak menghitung kurva sendiri.
- `src/lib/m7/access.ts` — `canManageProjectParticipants()` (role `m7.manage` **atau** terdaftar di
  `project_manpower`). R13 PRD = superset role; selaraskan di RBAC, bukan di UI.
- `src/lib/utils/sheet.ts` + `src/lib/ingest/parse.ts` — parser .xlsx/.csv dengan alias header
  ID/EN, skip baris "Summary", `parseRupiah()`. Parser upload project **wajib** memakai util ini.
- `src/lib/ingest/storage.ts` + bucket `ingest-uploads` (migrasi 0026) — jalur file besar.
- `src/lib/report/insight.ts` — satu-satunya pemanggil LLM di jalur report.
- `src/lib/audit.ts` (`writeAudit`), `src/lib/config.ts` (`getConfig`), `src/lib/rbac.ts`.

---

## 2. BLOCKER — kunci dulu sebelum coding

Sama seperti BLOCKER M4/M5/M6 di `docs/BUILD_PLAN.md`: item di bawah ini menghentikan
task yang bergantung padanya, **tapi tidak menghentikan seluruh Fase 1** (lihat §3).

- [ ] **B1 — Sampel export harian (A2).** Butuh 1 file tiap: product MCN, product TAP, Shopee
      afiliasi. Yang sudah diterima cuma export **LIVE Center per sesi** (addendum §9), dan itu
      format lain. Tanpa B1, `source_type` product/shopee tidak bisa dikunci headernya.
- [ ] **B2 — Keputusan Yohan: export product tanpa kolom tanggal.** Kalau TikTok cuma memberi
      rekap periode: **tolak** (default PRD, minta export harian) atau **bagi rata per hari**.
      Bagi rata merusak K2 (angka harian jadi karangan) → rekomendasi tetap tolak, dengan pesan
      error yang menyebut cara ambil export harian.
- [ ] **B3 — Stack render PNG/PDF (A13).** Repo belum punya dependensi render apa pun
      (`package.json` hanya next/react/recharts/xlsx/papaparse/zod/@anthropic-ai/sdk).
      Rekomendasi: **PNG** lewat `@vercel/og` (satori, ringan, sudah native di Vercel) dan
      **PDF** lewat route cetak A4 + `window.print()` — pola yang sudah dipakai
      `src/app/(portal)/reports/[id]/print-button.tsx`. Puppeteer ditolak (bundle size di Vercel).
      Konsekuensi jujur: "satu komponen React untuk layar, PNG, dan PDF" (§6.13) **tidak** tercapai
      penuh — satori hanya mendukung subset CSS, jadi kartu PNG jadi komponen terpisah yang
      membaca `data_json` yang sama. Sumber angkanya tetap satu.
- [ ] **B4 — Sentimen feedback vs CLAUDE.md #1.** Keputusan #11 PRD: sentimen pakai mesin LLM
      yang sama. CLAUDE.md #1: "Klasifikasi ... = TANPA LLM" dan "jangan pernah panggil LLM
      per-row". Jalan tengah yang saya usulkan: **satu call per project per batch malam**, input =
      daftar komentar yang sudah dipotong, output = label per respons; `token_used` dicatat.
      Itu memenuhi keputusan #11 tanpa melanggar larangan per-row. Butuh persetujuan Yohan.
- [ ] **B5 — Nasib input manual metrik.** `upsertCreatorMetric()` dan `upsertDailyMetric()`
      (actions.ts:250 & 313) sekarang menulis `gmv_actual` langsung. Setelah R18/R21,
      `project_creator_metrics.gmv_actual` jadi kolom GENERATED dan `project_daily_metrics`
      jadi roll-up → **kedua action itu akan gagal apa adanya**. Usulan (default plan ini):
      input manual per kreator diarahkan ke `gmv_product` dengan `batch_product_id = null`
      (ditandai "input manual" di UI), dan input harian dipersempit hanya ke kolom biaya
      (`ads_spend_manual`, `creator_commission`, `mea_revenue`). Perlu konfirmasi kalau tim
      masih mau input GMV harian manual.

---

## 3. Urutan build

Fase 1 PRD saya pecah jadi **1A / 1B / 1C** karena B1 memblokir sebagian saja. 1A bisa jalan
sekarang (format live session sudah lengkap di addendum §9), 1C bisa jalan di atas 1A.

| Fase | Scope | Blocked by | Estimasi |
|---|---|---|---|
| **0** | Hardening skema + purge + recompute + target peserta wajib | — | 2 hari |
| **1A** | Upload sesi live (`tiktok_live_session`) + verifikasi V1–V7 + dashboard | — | 4 hari |
| **1B** | Upload export harian product/shopee | B1, B2 | 2 hari |
| **1C** | Report peserta + report gabungan + PNG/PDF | 1A (1B untuk project non-live), B3 | 4 hari |
| **2** | Kebutuhan kreator, shortlist, link publik, kurasi | — | 5 hari |
| **3** | Portal peserta: info, report, feedback, sanggahan | B4 (sentimen saja) | 6 hari |
| **4** | Aktivasi portal manual CPM | — | 1 hari |

Total ±24 hari kerja (PRD memperkirakan ±9 hari untuk Fase 1 saja; pecahan 1A+1B+1C = 10 hari,
selisihnya karena verifikasi V1–V7 dan report tiga lapis dihitung terpisah).

Paralel yang aman: 1A ∥ persiapan 1C (template report), Fase 2 ∥ Fase 3 bagian info acara.
Blocking keras: Fase 0 → semua; 1A → 1C; K5 (`report_period_t`) → 1C.

---

## Fase 0 — Hardening (blocking)

Migrasi mulai dari **0052** (terakhir di repo: `0051_px_creator_capability.sql`).

### 0.1 Enum — migrasi terpisah, wajib

- [ ] `0052_m7_v2_enums.sql` — **hanya** `create type project_type_t`,
      `alter type project_status_t add value 'dibatalkan'`,
      `alter type report_period_t add value 'project'`, `create type manpower_role_t`.

> Catatan teknis: Postgres tidak mengizinkan nilai enum baru **dipakai** di transaksi yang sama
> dengan `ADD VALUE`-nya. `supabase apply_migration` membungkus tiap migrasi dalam satu
> transaksi → kalau digabung, migrasi 0053 gagal saat memetakan `type` lama ke `project_type_t`.
> Jadi 0052 tidak boleh berisi apa pun selain deklarasi enum.

### 0.2 Skema project

- [ ] `0053_m7_v2_project_hardening.sql`:
  - `special_projects` += `slug text unique`, `description`, `signup_deadline`,
    `feedback_open_at`, `feedback_close_at`, `summary_computed_at`.
  - Migrasi `type` → `project_type_t` via kolom `type_new` + mapping `lower(trim())`:
    `bootcamp→bootcamp`; `china trip`,`china`→`trip`; `showcase`,`showcase testing`→`showcase`;
    `live_event`→`event`; `flash_sale`,`campaign`→`campaign`; sisanya `other`.
    Nilai aktual di DB sekarang: `flash_sale, campaign, live_event, bootcamp, china, Showcase,
    China Trip, Bootcamp, showcase testing` — semuanya tertutup mapping ini.
  - `project_manpower.involvement` → `involvement_pct smallint check (between 0 and 100)`
    (strip `%`, cast); `role` → `manpower_role_t`.
  - `project_participants.target_gmv` → NOT NULL, backfill
    `target_gmv_project / nullif(target_creators,0)`, fallback 0; += `added_via`
    (`manual|portal|invite|external`, default `manual`), `portal_invited_at`.
  - Backfill `slug` untuk project lama (slugify nama + id).
- [ ] **Purge id 4, 5, 10** — dump baris induk + anak (`project_participants` 1 baris,
      `project_manpower`, `project_daily_metrics` 1 baris) ke `audit_logs`
      action `m7.project_purge` (`type: 'auto'`) **sebelum** delete. Dump-nya `before`, bukan `after`.
- [ ] Sinkronkan `src/lib/rbac.ts`: `m7.manage` sekarang belum memuat `bizdev`,
      `acquisition_spec`, `cpm` yang disebut R13 → tambahkan permission baru
      `m7.curate` (daftar R13) alih-alih melonggarkan `m7.manage` yang juga memberi hak ubah
      target/status project.
- [ ] Guard `selesai → aktif` hanya `director|head` (R2) di `setProjectStatus()`, ter-audit.

### 0.3 Pipeline recompute (dipakai 1A & 1B)

- [ ] `0054_m7_v2_metrics.sql`:
  - `metric_upload_batches` += `project_id bigint references special_projects(id)` (nullable,
    batch lama tetap valid), `period_start`, `period_end`, `file_hash`,
    `status text check (processed|superseded|failed|rolled_back) default 'processed'`,
    `matched_count`, `unmatched_count`, `out_of_window_count`, `unmatched_usernames jsonb`,
    `missing_columns jsonb`, `error text`;
    unique partial `(project_id, file_hash) where project_id is not null`;
    CHECK `source_type`: hapus `'sap'` (K7), tambah `'tiktok_live_session'`.
  - `project_creator_metrics`: **drop view `creator_project_progress_v` dulu** (view itu
    menyebut `gmv_actual`, jadi kolomnya tidak bisa diubah selama view hidup), lalu
    `gmv_actual` → GENERATED `coalesce(gmv_product, gmv_live_report, 0) + coalesce(gmv_shopee,0)`,
    tambah `gmv_product`, `gmv_live_report`, `gmv_shopee`, `live_gmv`, `video_gmv`, `orders`,
    `live_orders`, `live_sessions`, `batch_product_id`, `batch_live_id`, `batch_shopee_id`,
    `updated_at`; recreate view + tambahkan kolom baru ke view.
  - `project_creator_products` (baru) PK `(project_id, creator_id, product_id)`.
  - `project_daily_metrics` += `gmv_live`, `items`, `orders`, `ads_spend_manual`, `active_creators`.
  - Fungsi: `recompute_project_daily(p)`, `recompute_project_summary(p)`, `rollback_batch(b)`
    — **SQL murni** (CLAUDE.md #1: agregasi = SQL, bukan loop aplikasi).
    `ads_spend = ads_spend_manual + project_ads_spend_v`.
  - RLS: semua tabel baru `enable row level security` + policy read `authenticated`,
    mutasi hanya service role (pola 0005).
- [ ] Cron 06:00 WIB `recompute_project_summary` untuk project `aktif`
      (pg_cron / Edge Function terjadwal — pilih yang sudah dipakai repo; kalau belum ada,
      Edge Function + Supabase schedule).
- [ ] `app_config` baru: `m7.gmv_trend_tolerance` (0.02, untuk V6), `m7.feedback_window_days`
      (14), `m7.shortlist_weights`. **Tidak ada angka hardcode** (CLAUDE.md konvensi).

**DoD Fase 0:** `npm run typecheck` + `npm run test` hijau; `/projects` dan `/projects/[id]`
masih render untuk project 7/8/9; tidak ada project id 4/5/10; audit `m7.project_purge` berisi dump.

---

## Fase 1A — Upload sesi live (jalan tanpa B1)

Format sudah pasti dari addendum §9: dua file per sesi, dan **username/sesi/tanggal hanya ada di
nama file** (`{username}_product_Sesi_{n}__{d}_{Bulan}_{yyyy}.xlsx` dan `_trend_stats_`),
penulisan tidak konsisten (`product`/`Product`, `trend_stats`/`Trend_Stat`, `Sesi`/`sesi`).

- [ ] `0055_m7_v2_live_sessions.sql`: `project_live_sessions` (+ kolom atribusi §10.4),
      `project_live_intervals`, `creator_username_aliases`
      (unique `(platform, lower(username))` — satu username tidak boleh jadi alias dua kreator;
      perhatikan `creators.username` sudah unique sejak migrasi 0050, alias tidak boleh bentrok),
      view `project_creator_daily_live_v`, index `(project_id, creator_id, session_date)`, RLS.
- [ ] `src/lib/m7/live-filename.ts` — **fungsi murni** parse nama file → `{username, sessionNo,
      date, kind}`, regex case-insensitive, plus fallback null (tim isi manual). Unit test dengan
      semua varian penulisan dari sampel.
- [ ] `src/lib/m7/live-parse.ts` — baca kedua sheet lewat `parseSheet()`, header persis dari
      addendum §9, laporkan `missing_columns`. GMV sesi **selalu** dari file Product; Trend Stats
      hanya timeline + metrik penonton; selisih disimpan di `gmv_trend` (R: sumber tunggal).
- [ ] `src/lib/m7/live-verify.ts` — **fungsi murni** V1–V7 → `{level: ok|warn|block, code, message}[]`.
      V1 alias, V2 periode (R6), V3 tumpang tindih (R39), V4 file hash lintas project,
      V5 pasangan product+trend, V6 selisih GMV ≤ `m7.gmv_trend_tolerance`, V7 nomor sesi bentrok.
      Konsistensi brand **bukan** cek (§10 catatan) — jangan ditambahkan.
- [ ] Upload **selalu berkonteks kreator** (R40): UI pilih peserta dulu, baru drop file.
      Route `/projects/[id]/performa` + `live-upload-form.tsx` (client) + `live-actions.ts`.
- [ ] Layar konfirmasi per sesi (hijau/kuning/merah). Merah = tidak bisa simpan. Kuning butuh
      centang + alasan → `attribution_status='confirmed_manual'`.
- [ ] Simpan → sesi + interval + produk → `recompute_project_daily` → `recompute_project_summary`.
      Audit `m7.live_session_upload` menyimpan `uploader_id, creator_id, session_id, checks_json,
      override_reason`.
- [ ] Batalkan sesi → `voided` + recompute (audit `m7.live_session_void`).
- [ ] Hanya `verified` + `confirmed_manual` yang ikut roll-up (R41) — ditegakkan di **view/SQL**,
      bukan di filter aplikasi (CLAUDE.md #4).
- [ ] Dashboard project (§3.2) di `/projects/[id]`: header target vs aktual (pakai `trackDaily`
      yang sudah ada), chart kumulatif vs kurva, leaderboard peserta, panel biaya
      (+ pesan eksplisit kalau `project_ads_spend_v` = 0 karena belum ada brief tertaut).

**DoD 1A:** upload 2 sesi 1 kreator 1 hari → 2 baris `project_live_sessions`, 1 baris
`project_creator_metrics` (R38: agregat harian dihitung, bukan disimpan dua kali),
`result_summary` berubah dari 0; upload ulang file yang sama ditolak V4; sesi tumpang tindih ditolak V3.

---

## Fase 1B — Upload export harian (butuh B1 + B2)

- [ ] `src/lib/m7/metrics-parse.ts` — alias header per `source_type`
      (`mcn_tiktok_product`, `tap_tiktok_product`, `mcn_tiktok_live`, `tap_tiktok_live`, `shopee`),
      `missing_columns` dilaporkan, bukan crash.
- [ ] Pencocokan baris → peserta lewat `creators.username` (case-insensitive, strip `@`) atau `uid`
      (R20). Pakai `likePatternForUsername()`/`pickExactUsername()` yang sudah ada di
      `src/lib/creators/username.ts` — jangan tulis normalisasi kedua.
      Baris bukan peserta **tidak disimpan**, masuk `unmatched_count` + daftar username di preview.
- [ ] Preview sebelum commit (§3.1 langkah 3): total baris, matched, unmatched + username,
      out-of-window, estimasi GMV masuk, kolom hilang.
- [ ] Upsert per source hanya menyentuh kolomnya sendiri → R21 terpenuhi **secara struktural**,
      bukan lewat if-else di aplikasi.
- [ ] Re-upload sumber + periode sama = replace (R22), batch lama `superseded`; file duplikat
      ditolak (R23); `project_creator_products` di-replace per batch (R25).
- [ ] Riwayat batch + **Hapus batch** → `rollback_batch()` + recompute. Audit
      `m7.metrics_upload` / `m7.metrics_rollback`.

**DoD 1B:** skenario §4 PRD bisa direproduksi dengan file asli: upload product → GMV masuk;
upload live periode sama → `gmv_actual` **tidak** berubah, hanya `live_gmv` terisi.

---

## Fase 1C — Report peserta & gabungan

- [ ] `0056_m7_v2_reports.sql`: `creator_reports.project_id` FK, unique partial
      `(project_id, creator_id) where project_id is not null and status='final'`,
      policy `cr_creator_self_final` (`is_creator_user()` + `auth_creator_id()` — kedua helper
      sudah ada di DB), baris `token_baseline` untuk `report_type='project'`.
- [ ] `src/lib/m7/report-data.ts` — bangun `data_json` persis skema §6.8 (period, creator, target,
      metrics, achievement, cohort_avg, daily, top_products) **dari SQL agregat**, plus blok
      live tiga lapis (§10.5) untuk project bertipe live. Rank & cohort dihitung di SQL.
- [ ] Insight: panggil `generateInsight()` yang sudah ada dengan **varian prompt `project`**
      (3 paragraf, larangan menyebut angka di luar `data_json`). Satu call per report,
      `token_used` dicatat. Lapis sesi memakai catatan **rule-based**, bukan LLM (§10.5) —
      ini sekaligus yang menjaga CLAUDE.md #1.
- [ ] Generate massal (semua/terpilih) → draft; generate ulang → draft baru, draft lama diarsip (R26).
      Peserta `gmv_actual=0` tetap dibuatkan report (R29).
- [ ] Finalkan (reuse pola `finalizeReport`) → audit `m7.report_finalize`.
- [ ] Template output (§6.13) — sesuai B3: komponen layar + route cetak A4 (PDF) + route
      `@vercel/og` (PNG 1080×1350). Palet mengikuti **MEA Report Designer**
      (skill `mea-client-reporting`); hex final menunggu A6.
- [ ] Report gabungan PDF 2–3 halaman + PNG ringkas tanpa angka biaya/margin (D).
- [ ] Setiap unduhan → audit `m7.report_download`.

**DoD 1C:** 1 project selesai → semua peserta punya draft; finalisasi 1 report menghasilkan PNG
+ PDF yang angkanya identik dengan dashboard; tidak ada angka di narasi yang tidak ada di `data_json`.

---

## Fase 2 — Kebutuhan kreator, shortlist, kurasi

- [ ] `0057_m7_v2_recruitment.sql`: `project_creator_requirements`, upgrade
      `project_join_requests` (status → `diajukan|diundang|diterima|ditolak|waitlist|dibatalkan`,
      += `source`, `reason`, `note`, `score`; RLS creator_user hanya `diundang → diterima/ditolak`),
      `project_external_applicants` (unique `(project_id, lower(username), platform)`),
      fungsi `project_shortlist(project_id)`.
- [ ] Skor shortlist dari `app_config m7.shortlist_weights` (default {gmv .4, niche .25, level .2,
      live .15}), basis `creator_period_summary` 4 periode terakhir. **Deterministik, tanpa LLM.**
- [ ] Perluas `decideProjectJoinRequest()`: wajib `target_gmv` (saran `sisa target / sisa kuota`),
      `reject` wajib `reason`, approve eksternal = satu transaksi (buat `creators` dengan
      `tim_akuisisi='special_project'` + `project_participants`, R15). Melebihi `target_creators`
      = warning, bukan blokir (R16).
- [ ] `inviteCreators(project_id, creator_ids[])` → status `diundang`, audit `m7.invite`.
- [ ] Endpoint publik `POST /api/join/{slug}` (service role, tanpa RLS anon), rate limit 5/menit/IP,
      `ip_hash` bukan IP mentah, cek username duplikat per project. Buka pendaftaran sesuai R8.
- [ ] Tab **Pendaftar** (Internal/Eksternal) + counter diterima vs `target_creators`.

---

## Fase 3 — Portal peserta

- [ ] `0058_m7_v2_portal.sql`: `project_announcements` + `project_announcement_reads`,
      `project_feedback` (unique `(project_id, creator_id)`), RLS creator_user (peserta project,
      `published_at <= now()`, jendela feedback R31).
- [ ] Portal: tab **Info** (pinned maks 3, badge belum dibaca), **Progress & Report**
      (angka live sebelum final, narasi + unduh setelah final — R28), **Feedback**, **Undangan**.
- [ ] Sanggahan sesi (§10.3): tombol "Ini bukan data saya" → `disputed` + alasan → keluar dari
      roll-up sementara → notifikasi CPM pemilik + uploader. Tim: pindahkan ke peserta lain
      (jalankan ulang V1–V7) atau tolak sanggahan. Audit `m7.live_session_dispute` /
      `m7.live_session_reassign`.
- [ ] Sentimen feedback sesuai keputusan B4 (batch malam, satu call per project).
- [ ] `creator_feedback` lama **tidak** dipakai untuk acara (R33) — biarkan apa adanya.

---

## Fase 4 — Aktivasi portal

- [ ] Kolom "Akun portal" di daftar peserta + tombol **Undang ke portal** → `creator_users`
      status `invited` + tampilkan link/token untuk dikirim CPM sendiri (R36).
      Audit `m7.portal_invite`. Tidak ada pengiriman WA otomatis.

---

## 4. Kepatuhan CLAUDE.md (dicek per PR)

| Aturan | Cara plan ini memenuhinya |
|---|---|
| #1 LLM hanya reasoning | LLM cuma di: insight report peserta, ringkasan report gabungan, sentimen batch (B4). Parsing, matching username, V1–V7, roll-up, rank, cohort, skor shortlist = SQL/rule-based. Tidak ada LLM per-row. `token_used` dicatat tiap call |
| #2 Approval & alert | Approve/reject peserta = `type:'approval'`; upload/recompute/purge = `type:'auto'`; `project_rugi`/`project_over_cap` (sudah ada di `checkProfitability`) = `platform_alert` |
| #3 Read-only | Tidak menyentuh `agency_links.link_status` maupun `creators.commission_share` |
| #4 Satu sumber kebenaran | `project_creator_metrics` = sumber tunggal performa project; kurva & status dari `m7/tracking.ts`; insight dari `report/insight.ts`; normalisasi username dari `creators/username.ts`; `project_daily_metrics` & `result_summary` = **turunan**, tidak pernah dihitung ulang di tempat lain |
| #7 Data cleaning | Rupiah campur, tanggal teks bebas, kolom kotor → `parseRupiah()` + flag review; **jangan crash** |
| Konvensi | DB snake_case, kode camelCase, label UI Bahasa Indonesia, komentar kode Bahasa Inggris, threshold dari `app_config` |
| DoD | Type-safe, RLS aktif, audit tertulis, threshold dari config, 0 LLM di jalur deterministik |

---

## 5. Rencana test

- **Unit (vitest, pola `src/lib/**/__tests__`)**: `live-filename` (semua varian penulisan),
  `live-verify` (V1–V7, termasuk tumpang tindih & alias), `metrics-parse` (header ID/EN,
  baris Summary, out-of-window), `report-data` (rank, cohort, share_of_project),
  anti-dobel R21 (product+live hari sama → `gmv_actual` = product).
- **Round-trip**: header template parser ↔ header yang dibaca, pola `lib/deals/report-template.ts`.
- **Integrasi manual**: skenario §4 PRD di project 9 (staging `MCN MEA Staging` dulu, baru production).

---

## 6. Risiko

| Risiko | Mitigasi |
|---|---|
| B1 tidak datang dalam 1–2 minggu | 1A sudah cukup untuk project live-only; rilis 1A + 1C duluan, 1B menyusul |
| `gmv_actual` jadi GENERATED merusak input manual | B5 diputuskan sebelum 0054 dijalankan; migrasi + perubahan action masuk satu PR |
| Username kreator berubah → sesi nyasar | `creator_username_aliases` + V1 blokir, penambahan alias butuh alasan & role cm_lead ke atas |
| Angka report ≠ angka dashboard | Keduanya baca `project_creator_metrics`/`result_summary` yang sama; tidak ada perhitungan kedua di komponen report |
| Purge project menghapus data yang ternyata dipakai | Dump lengkap ke `audit_logs` sebelum delete, dijalankan di staging dulu |
