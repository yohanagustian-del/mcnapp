# M7 v2 — Pecahan PR (Special Project v2)

Turunan dari `docs/BUILD_PLAN_M7_V2.md`. Dokumen ini memecah rencana jadi **26 PR** yang
masing-masing bisa di-review dan di-merge sendiri.

PRD: `docs/prd/MCN_MEA_AI_Platform_Module07_Special_Project_v2.md`.
Keputusan terkunci (B1/B2 tolak, B3 report di dashboard, B4 rule-based, B5 full upload):
lihat §2 rencana induk.

## Status per 16 Sep 2026 — sebagian besar SUDAH dikerjakan

Rencana ini dieksekusi lewat PR #25–#31 yang sudah merge ke `main`. Dokumen tetap disimpan
sebagai catatan alasan di balik tiap pemecahan, bukan lagi sebagai antrian kerja.

| Blok | PR pelaksana | Status |
|---|---|---|
| Fase 0 (PR-01…04) | #25 | ✅ merged |
| Fase 1A (PR-05…10) | #26, #30 | ✅ merged |
| Fase 1C + 1D (PR-13…18) | #27, #31 | ✅ merged |
| Fase 2 (PR-19…22) | #28 | ✅ merged |
| Fase 3 (PR-23…26) | #29 | ✅ merged |
| **Fase 1B (PR-11, PR-12)** | — | ⛔ **belum** — menunggu sampel export harian |

Skema untuk Fase 1B sudah siap (`source_type` product/shopee + `rollback_batch` sudah
menanganinya di migrasi 0054), yang belum ada cuma parser + UI upload-nya
(`src/lib/m7/metrics-parse.ts` belum dibuat).

**Nomor migrasi aktual berbeda dari draft awal** karena cron mengambil migrasi sendiri
(0055): live sessions jadi 0056, reports 0057, recruitment 0058, portal 0059. Tabel di bawah
sudah dikoreksi ke nomor yang benar-benar dipakai.

## Aturan pemecahan

1. **Satu PR = maksimal satu file migrasi.** Migrasi bernomor urut, tidak boleh dua PR terbuka
   memakai nomor yang sama — ambil nomor saat PR dibuat, bukan saat ditulis.
2. **Migrasi yang mematahkan kode lama wajib satu PR dengan perbaikan kodenya.** Contoh:
   `gmv_actual` jadi GENERATED (PR-03) harus sekaligus mencabut `upsertCreatorMetric()`,
   kalau tidak `main` merah di antara dua PR.
3. **Fungsi murni dipisah dari UI.** Lib + unit test lebih dulu (PR ganjil kecil), baru server
   action + halaman. Reviewer bisa memeriksa aturan bisnisnya tanpa membaca JSX.
4. **Tiap PR draft dulu**, jadi non-draft setelah `npm run typecheck` + `npm run test` hijau.
5. Branch: `claude/m7v2-<nn>-<slug>`. Judul PR: `M7v2-<nn>: <ringkas>`.
6. PR yang menyentuh DB dijalankan di **`MCN MEA Staging`** dulu, baru production.

## Peta PR

| PR | Judul | Fase | Migrasi | Tergantung | Est. |
|---|---|---|---|---|---|
| 01 | Enum M7 v2 | 0 | 0052 | — | 0,5 h |
| 02 | Hardening `special_projects` + purge project test | 0 | 0053 | 01 | 1 h |
| 03 | Pipeline metrik + cabut input GMV manual | 0 | 0054 | 02 | 1,5 h |
| 04 | Recompute terjadwal + seed `app_config` | 0 | 0055 | 03 | 0,5 h |
| 05 | Skema sesi live + alias username | 1A | 0056 | 03 | 0,5 h |
| 06 | Lib parse nama file & isi file sesi live | 1A | — | — | 1 h |
| 07 | Lib verifikasi V1–V7 | 1A | — | 05, 06 | 1 h |
| 08 | Upload sesi live berkonteks kreator + layar konfirmasi | 1A | — | 07 | 1,5 h |
| 09 | Dashboard project (target, kurva, leaderboard, biaya) | 1A | — | 08 | 1,5 h |
| 10 | Riwayat batch + batalkan sesi | 1A | — | 08 | 0,5 h |
| 11 | Lib parser export harian (tolak rekap periode) | 1B | — | sampel file | 1 h |
| 12 | Upload export harian + preview + replace | 1B | — | 11 | 1 h |
| 13 | Skema report project | 1C | 0057 | 03 | 0,5 h |
| 14 | Lib `report-data` (data_json + blok live) | 1C | — | 13 | 1,5 h |
| 15 | Generate & finalkan report peserta | 1C | — | 14 | 1 h |
| 16 | Halaman report peserta & report gabungan | 1C | — | 15 | 1 h |
| 17 | Portal: tab Progress & Report | 1D | — | 16 | 1 h |
| 18 | Undang akun portal (CPM) | 1D | — | 02 | 1 h |
| 19 | Skema rekrutmen (requirements, applicants, join requests) | 2 | 0058 | 02 | 1 h |
| 20 | Kebutuhan kreator + shortlist + undang | 2 | — | 19 | 2 h |
| 21 | Kurasi: perluas keputusan join + tab Pendaftar | 2 | — | 19 | 1,5 h |
| 22 | Link publik `/join/{slug}` + endpoint | 2 | — | 19 | 1,5 h |
| 23 | Skema info acara & feedback | 3 | 0059 | 02 | 0,5 h |
| 24 | Info acara (publish tim + baca portal) | 3 | — | 23 | 1 h |
| 25 | Feedback + sentimen rule-based | 3 | — | 23 | 1,5 h |
| 26 | Sanggahan sesi + pindah peserta | 3 | — | 08, 17 | 1,5 h |

Jalur kritis: 01 → 02 → 03 → 05 → 06/07 → 08 → 13 → 14 → 15 → 16 → 17.
Bisa paralel: 06 & 11 (lib murni, tak saling sentuh), 18 ∥ 16, 19–22 ∥ 23–25.

Jumlah estimasi per PR = **±28 hari-dev**, lebih tinggi dari ±23 hari di rencana induk. Selisihnya
memang biaya pemecahan (tiap PR punya ongkos review, migrasi, dan verifikasi staging sendiri).
Pakai 23–28 hari sebagai rentang, bukan angka tunggal.

---

## Fase 0 — Fondasi

### PR-01 — Enum M7 v2
**Kenapa terpisah:** Postgres melarang memakai nilai enum baru di transaksi yang sama dengan
`ADD VALUE`-nya, dan `apply_migration` membungkus tiap migrasi dalam satu transaksi. Digabung =
PR-02 gagal saat memetakan `type`.

- `supabase/migrations/0052_m7_v2_enums.sql`
  - `create type project_type_t as enum ('bootcamp','training','event','showcase','campaign','trip','other')`
  - `create type manpower_role_t as enum ('pic','project_manager','cm','cpm','akuisisi','bizdev','support','other')`
  - `alter type project_status_t add value 'dibatalkan'`
  - `alter type report_period_t add value 'project'`

**DoD:** migrasi jalan di staging; tidak ada perubahan kode lain di PR ini.

---

### PR-02 — Hardening `special_projects` + purge project test
- `supabase/migrations/0053_m7_v2_project_hardening.sql`
  - `special_projects` += `slug text unique`, `description`, `signup_deadline`,
    `feedback_open_at`, `feedback_close_at`, `summary_computed_at`; backfill `slug`.
  - `type` → `project_type_t` lewat `type_new`, mapping `lower(trim())`:
    `bootcamp→bootcamp`; `china trip`,`china`→`trip`; `showcase`,`showcase testing`→`showcase`;
    `live_event`→`event`; `flash_sale`,`campaign`→`campaign`; sisanya `other`.
  - `project_manpower.involvement` → `involvement_pct smallint check (0..100)`;
    `role` → `manpower_role_t`.
  - `project_participants.target_gmv` NOT NULL (backfill `target_gmv / nullif(target_creators,0)`,
    fallback 0); += `added_via`, `portal_invited_at`.
  - Purge project id 4, 5, 10 — **dump induk + anak ke `audit_logs` action `m7.project_purge`
    sebelum delete** (id 10 punya 1 peserta, jangan hilang tanpa jejak).
- `src/lib/rbac.ts`: permission baru `m7.curate` sesuai R13 (jangan melonggarkan `m7.manage`,
  karena itu juga memberi hak ubah target & status).
- `src/app/(portal)/projects/actions.ts`: `setProjectStatus()` — transisi `selesai → aktif`
  hanya `director|head`, ter-audit; tambah status `dibatalkan`.
- `src/app/(portal)/projects/**`: form create/edit pakai enum `project_type_t` (dropdown),
  `involvement_pct` number input.

**DoD:** `/projects` & `/projects/[id]` render untuk project 7/8/9; tidak ada id 4/5/10;
audit `m7.project_purge` berisi dump lengkap; typecheck + test hijau.

---

### PR-03 — Pipeline metrik + cabut input GMV manual (B5)
**Satu PR karena saling mematahkan:** `gmv_actual` jadi GENERATED, jadi action yang menulisnya
harus hilang di commit yang sama.

- `supabase/migrations/0054_m7_v2_metrics.sql`
  - `metric_upload_batches` += `project_id`, `period_start`, `period_end`, `file_hash`,
    `status (processed|superseded|failed|rolled_back)`, `matched_count`, `unmatched_count`,
    `out_of_window_count`, `unmatched_usernames jsonb`, `missing_columns jsonb`, `error`;
    unique partial `(project_id, file_hash) where project_id is not null`;
    CHECK `source_type`: hapus `'sap'`, tambah `'tiktok_live_session'`.
  - `drop view creator_project_progress_v` → ubah `project_creator_metrics` → recreate view.
    `gmv_actual` GENERATED `coalesce(gmv_product, gmv_live_report, 0) + coalesce(gmv_shopee,0)`;
    tambah `gmv_product`, `gmv_live_report`, `gmv_shopee`, `live_gmv`, `video_gmv`, `orders`,
    `live_orders`, `live_sessions`, `batch_product_id`, `batch_live_id`, `batch_shopee_id`,
    `updated_at`.
  - `project_creator_products` baru, PK `(project_id, creator_id, product_id)`.
  - `project_daily_metrics` += `gmv_live`, `items`, `orders`, `ads_spend_manual`, `active_creators`.
  - Fungsi SQL: `recompute_project_daily(p)`, `recompute_project_summary(p)`, `rollback_batch(b)`.
    `ads_spend = ads_spend_manual + project_ads_spend_v`.
  - RLS semua tabel baru: read `authenticated`, mutasi service role saja.
- Cabut input manual:
  - hapus `upsertCreatorMetric()` (`projects/actions.ts:250`) + form pemanggilnya di
    `projects/[id]/creator-performance-table.tsx`;
  - `upsertDailyMetric()` (`:313`) → hanya `ads_spend_manual`, `creator_commission`, `mea_revenue`;
  - kolom GMV/items/orders di tabel harian jadi read-only + label
    "Angka GMV hanya dari upload — tidak bisa diisi manual."

**DoD:** tidak ada satu pun jalur tulis `gmv_actual` dari UI (`grep` bersih);
`recompute_project_daily` pada project kosong menghasilkan 0 tanpa error; typecheck + test hijau.

---

### PR-04 — Recompute terjadwal + seed `app_config`
- Cron 06:00 WIB `recompute_project_summary` untuk project `aktif`
  (pg_cron kalau sudah dipakai repo; kalau belum, Edge Function + Supabase schedule).
- Seed `app_config`: `m7.gmv_trend_tolerance` (0.02), `m7.feedback_window_days` (14),
  `m7.shortlist_weights`, `m7.sentiment_rules`.
- Audit `m7.summary_recompute` untuk tiap jalannya cron.

**DoD:** jalankan manual sekali di staging, `summary_computed_at` terisi.

---

## Fase 1A — Upload sesi live

### PR-05 — Skema sesi live + alias username
- `supabase/migrations/0056_m7_v2_live_sessions.sql`
  - `project_live_sessions` (kolom §9 + atribusi §10.4: `attribution_status`, `attribution_note`,
    `confirmed_by/at`, `checks_json`, `filename_product`, `filename_trend`, `uploaded_by`,
    `disputed_at`, `dispute_reason`), unique `(project_id, creator_id, session_date, session_no)`.
  - `project_live_intervals` (per 30 menit).
  - `creator_username_aliases`, unique `(platform, lower(username))` — awas bentrok dengan
    `creators.username` yang sudah unique sejak 0050.
  - View `project_creator_daily_live_v` — **filter `verified|confirmed_manual` ada di sini**,
    bukan di aplikasi (CLAUDE.md #4).
  - Index `(project_id, creator_id, session_date)`, RLS.

**DoD:** view mengembalikan 0 baris tanpa error di project kosong.

---

### PR-06 — Lib parse nama file & isi file sesi live
Murni, tanpa DB dan tanpa UI — supaya reviewer bisa memeriksa aturannya langsung.

- `src/lib/m7/live-filename.ts` — `parseLiveFilename(name)` → `{username, sessionNo, date, kind}`
  atau `null`. Regex case-insensitive, menutup varian `product`/`Product`,
  `trend_stats`/`Trend_Stat`, `Sesi`/`sesi`.
- `src/lib/m7/live-parse.ts` — baca dua sheet lewat `parseSheet()` yang sudah ada; header persis
  addendum §9; lapor `missing_columns` alih-alih crash. **GMV sesi selalu dari file Product**;
  Trend Stats hanya timeline + metrik penonton.
- `src/lib/m7/__tests__/live-filename.test.ts`, `live-parse.test.ts` — termasuk nama file yang
  tidak terbaca dan file dengan kolom kurang.

**DoD:** test hijau; tidak ada import Supabase di kedua file.

---

### PR-07 — Lib verifikasi V1–V7
- `src/lib/m7/live-verify.ts` — fungsi murni, input fakta yang sudah diambil pemanggil
  (alias kreator, periode project, sesi existing, hash yang sudah ada), output
  `{level: 'ok'|'warn'|'block', code, message}[]`:
  - V1 username nama file = username aktif/alias peserta terpilih → **blok**
  - V2 tanggal sesi dalam periode project → **blok** (R6)
  - V3 tidak tumpang tindih sesi lain kreator itu di hari sama → **blok** (R39)
  - V4 `file_hash` belum pernah masuk (lintas project) → **blok**
  - V5 Product & Trend berpasangan → **peringatan**
  - V6 selisih GMV Product vs Trend ≤ `m7.gmv_trend_tolerance` → **peringatan**
  - V7 `session_no` belum ada untuk (kreator, tanggal) → **blok** + tawaran replace
- Konsistensi brand **bukan** cek — jangan ditambahkan (§10 catatan PRD).
- Test: tiap kode cek, plus kasus semua-hijau.

**DoD:** test hijau; tidak ada I/O di file ini.

---

### PR-08 — Upload sesi live berkonteks kreator + layar konfirmasi
- `src/app/(portal)/projects/[id]/performa/page.tsx` — tab Performa.
- `live-upload-form.tsx` (client): pilih peserta dulu (R40), baru drop banyak file.
- `live-actions.ts`: pasangkan file → jalankan V1–V7 → kembalikan hasil untuk layar konfirmasi →
  simpan sesi + interval + produk → `recompute_project_daily` → `recompute_project_summary`.
- Merah tidak bisa disimpan; kuning butuh centang + alasan → `confirmed_manual`.
- Audit `m7.live_session_upload` menyimpan `uploader_id, creator_id, session_id, checks_json,
  override_reason`.

**DoD:** 2 sesi 1 kreator 1 hari → 2 baris sesi, **1** baris `project_creator_metrics`;
file sama diupload dua kali ditolak V4; sesi tumpang tindih ditolak V3.

---

### PR-09 — Dashboard project
- Header: target project vs aktual (GMV, %), hari tersisa, peserta aktif/total, live contribution
  — pakai `trackDaily()` yang sudah ada, jangan hitung kurva lagi.
- Chart harian kumulatif vs `daily_target_curve` (recharts, sudah jadi dependensi).
- Leaderboard peserta: rank, nama, GMV, % target pribadi, live share, items, hari aktif.
- Panel biaya: ads spend (`project_ads_spend_v` + manual), commission, MEA revenue, margin —
  **tampilkan pesan eksplisit** kalau 0 karena belum ada `ads_briefs` tertaut project.
- Export xlsx leaderboard (`xlsx` sudah ada).

**DoD:** angka header identik dengan `result_summary`; tidak ada perhitungan kedua di komponen.

---

### PR-10 — Riwayat batch + batalkan sesi
- Daftar batch per project: file, sumber, periode, baris masuk, GMV, uploader, status.
- **Batalkan sesi** → `attribution_status='voided'` + recompute, audit `m7.live_session_void`.
- **Hapus batch** → `rollback_batch()` + recompute, audit `m7.metrics_rollback`.

**DoD:** setelah rollback, `result_summary` kembali ke nilai sebelum batch itu.

---

## Fase 1B — Upload export harian (menunggu sampel file)

### PR-11 — Lib parser export harian
- `src/lib/m7/metrics-parse.ts` — alias header per `source_type`
  (`mcn_tiktok_product`, `tap_tiktok_product`, `mcn_tiktok_live`, `tap_tiktok_live`, `shopee`).
- **B1/B2:** file tanpa kolom tanggal per baris **ditolak**, pesan menyebut cara ambil export
  harian. Tidak ada opsi bagi rata, tidak ada flag untuk mengaktifkannya.
- Pencocokan username pakai `likePatternForUsername()`/`pickExactUsername()` yang sudah ada —
  jangan tulis normalisasi kedua.
- Test: header ID & EN, baris "Summary" di-skip, out-of-window, **file rekap periode ditolak**.

**DoD:** test hijau memakai sampel asli yang disimpan di `docs/data-samples/`.

---

### PR-12 — Upload export harian + preview + replace
- Preview sebelum commit: total baris, matched, unmatched + daftar username, out-of-window,
  estimasi GMV masuk, kolom hilang.
- Upsert per source **hanya menyentuh kolomnya sendiri** → R21 terpenuhi secara struktural.
- Re-upload sumber + periode sama = replace (R22), batch lama `superseded`;
  file duplikat ditolak (R23); `project_creator_products` di-replace per batch (R25).
- Audit `m7.metrics_upload`.

**DoD:** upload product → GMV masuk; upload live periode sama → `gmv_actual` **tidak** berubah,
hanya `live_gmv` terisi (uji anti-dobel R21).

---

## Fase 1C — Report

### PR-13 — Skema report project
- `supabase/migrations/0057_m7_v2_reports.sql`
  - `creator_reports.project_id` FK `special_projects(id)`.
  - Unique partial `(project_id, creator_id) where project_id is not null and status='final'`.
  - Policy `cr_creator_self_final` (`is_creator_user()` + `auth_creator_id()` + `status='final'`).
  - Baris `token_baseline` untuk `report_type='project'`.

**DoD:** dua report final untuk (project, creator) sama ditolak DB, bukan ditolak aplikasi.

---

### PR-14 — Lib `report-data`
- `src/lib/m7/report-data.ts` — bangun `data_json` persis skema §6.8: `period`, `creator`,
  `target`, `metrics`, `achievement` (rank & share), `cohort_avg`, `daily`, `top_products`.
  **Rank dan cohort dihitung di SQL**, bukan di JS.
- Project bertipe live: tambah blok tiga lapis §10.5 (project → hari → sesi).
- Test: rank, `share_of_project`, cohort, peserta `gmv=0`.

**DoD:** test hijau; fungsi tidak memanggil LLM.

---

### PR-15 — Generate & finalkan report peserta
- Generate massal (semua/terpilih) → draft; generate ulang → draft baru, draft lama diarsip (R26).
- Insight: `generateInsight()` yang sudah ada + **varian prompt `project`** (3 paragraf,
  larangan menyebut angka di luar `data_json`). Satu call per report, `token_used` dicatat.
  Lapis sesi memakai catatan rule-based, bukan LLM.
- Peserta `gmv_actual=0` tetap dibuatkan report (R29).
- Finalkan → audit `m7.report_finalize`; generate → `m7.report_generate`.

**DoD:** 1 project selesai → semua peserta punya draft; `token_used` terisi; tidak ada engine
insight kedua di repo.

---

### PR-16 — Halaman report peserta & report gabungan (B3)
- `ProjectReportView` — **satu komponen** dipakai halaman tim dan portal kreator (PR-17).
- `/projects/[id]/report/[creatorId]` (tim) dan `/projects/[id]/ringkasan` (report gabungan).
- Palet MEA Report Designer, chart `recharts`. `PrintButton` yang sudah ada dipakai ulang.
- **Tidak ada** route PNG, generator PDF, atau dependensi baru — B3.

**DoD:** angka di halaman identik dengan dashboard; `package.json` tidak bertambah.

---

## Fase 1D — Report sampai ke kreator

### PR-17 — Portal: tab Progress & Report
- `/portal/projects` → tab Progress & Report: angka live sebelum final, narasi setelah final (R28).
- Peserta **hanya** melihat report final miliknya — ditegakkan RLS, bukan filter query.

**DoD:** uji dua akun kreator; akun B tidak bisa membaca report akun A (uji lewat query langsung,
bukan lewat UI).

---

### PR-18 — Undang akun portal (CPM)
- Kolom "Akun portal" di daftar peserta + tombol **Undang ke portal** → `creator_users`
  status `invited` + tampilkan link/token untuk dikirim CPM sendiri (R36).
- Audit `m7.portal_invite`. Tidak ada pengiriman WA otomatis (K8).

**DoD:** satu peserta yang diundang bisa login dan melihat reportnya.

---

## Fase 2 — Rekrutmen & kurasi

### PR-19 — Skema rekrutmen
- `supabase/migrations/0058_m7_v2_recruitment.sql`
  - `project_creator_requirements` (§6.4).
  - `project_join_requests`: status → `diajukan|diundang|diterima|ditolak|waitlist|dibatalkan`;
    += `source`, `reason`, `note`, `score`; RLS creator_user hanya `diundang → diterima/ditolak`.
  - `project_external_applicants` (§6.6), unique `(project_id, lower(username), platform)`.
  - Fungsi `project_shortlist(project_id)`.

**DoD:** baris `project_join_requests` lama tetap valid setelah CHECK diganti.

---

### PR-20 — Kebutuhan kreator + shortlist + undang
- Tab **Kebutuhan Kreator**: niche (multi), platform, min level, follower tier, min GMV 30 hari,
  wajib live roster, catatan.
- **Cari Kreator** → shortlist berskor dari `app_config m7.shortlist_weights`, basis
  `creator_period_summary` 4 periode terakhir. Deterministik, tanpa LLM. Exclude yang sudah
  peserta/pending.
- `inviteCreators(project_id, creator_ids[])` → status `diundang`, audit `m7.invite`.

**DoD:** ubah bobot di `app_config` → urutan shortlist berubah tanpa deploy.

---

### PR-21 — Kurasi: perluas keputusan join + tab Pendaftar
- Perluas `decideProjectJoinRequest()` yang **sudah ada** (jangan bikin action kedua):
  wajib `target_gmv` (saran `sisa target / sisa kuota`), reject wajib `reason`,
  approve eksternal = satu transaksi (buat `creators` `tim_akuisisi='special_project'` +
  `project_participants`, R15).
- Melebihi `target_creators` → warning, bukan blokir (R16).
- Tab **Pendaftar**: sub-tab Internal/Eksternal, filter status, counter diterima vs target.
- Audit `m7.join_approve`, `m7.join_reject`, `m7.external_approve`, `m7.external_reject`.

**DoD:** approve tanpa `target_gmv` ditolak; peserta hasil approve muncul di dashboard.

---

### PR-22 — Link publik `/join/{slug}`
- Halaman publik tanpa login + `POST /api/join/{slug}` (service role, tanpa RLS anon).
- Rate limit 5/menit/IP, simpan `ip_hash` (bukan IP mentah), cek username duplikat per project.
- Buka pendaftaran sesuai R8 (`open_for_signup` AND `now() < signup_deadline` AND status
  ∈ planning/aktif). Audit `m7.external_apply`.

**DoD:** submit ke slug yang pendaftarannya tutup ditolak; rate limit terbukti di test.

---

## Fase 3 — Info acara, feedback, sanggahan

### PR-23 — Skema info acara & feedback
- `supabase/migrations/0059_m7_v2_portal.sql`
  - `project_announcements` + `project_announcement_reads` (§6.10).
  - `project_feedback` (§6.11), unique `(project_id, creator_id)`.
  - RLS creator_user: peserta project, `published_at <= now()`, jendela feedback R31.

---

### PR-24 — Info acara
- Tim: buat/publish pengumuman, maksimal 3 pinned (R17). Audit `m7.announcement_publish`.
- Portal: tab **Info** + badge belum dibaca (`project_announcement_reads`).

---

### PR-25 — Feedback + sentimen rule-based (B4)
- Form feedback (§3.8): rating keseluruhan/materi/mentor/penyelenggaraan (1–5), NPS (0–10),
  bagian paling bermanfaat, yang perlu diperbaiki, mau ikut lagi. Tidak anonim (R32).
- `src/lib/m7/feedback-sentiment.ts` — **fungsi murni, nol LLM**: sinyal utama `rating_overall`
  + `nps` (numerik), sinyal pendukung leksikon kata dari `app_config m7.sentiment_rules`
  (bisa ditambah tanpa deploy) → `positif|netral|negatif` + skor.
- Agregat masuk `result_summary` + halaman report gabungan. Ringkasan naratifnya **nebeng** call
  insight report gabungan yang sudah ada, bukan call baru.
- Audit `m7.feedback_submit`.

**DoD:** test `feedback-sentiment` dengan komentar nyata; `grep` memastikan tidak ada import
`insight.ts` di jalur feedback.

---

### PR-26 — Sanggahan sesi + pindah peserta
- Portal: tombol "Ini bukan data saya" per sesi → `attribution_status='disputed'` + alasan wajib →
  sesi keluar dari roll-up → notifikasi CPM pemilik + uploader.
- Tim: **Pindahkan ke peserta lain** (jalankan ulang V1–V7 untuk peserta tujuan) atau
  **Tolak sanggahan** (kembali `verified`, alasan dicatat).
- Audit `m7.live_session_dispute`, `m7.live_session_reassign`.

**DoD:** sesi `disputed` hilang dari `result_summary`; setelah reassign, angka pindah ke peserta
tujuan tanpa dobel.

---

## Definition of done yang berlaku di SEMUA PR

Dari `CLAUDE.md`:

- Type-safe (`npm run typecheck`), test hijau (`npm run test`).
- RLS aktif untuk tabel baru; mutasi lewat service role + RBAC server action.
- `audit_logs` tertulis untuk tiap mutasi entity material, dengan `type` yang benar:
  `auto` (upload, recompute, purge) · `approval` (keputusan manusia atas peserta) ·
  `platform_alert` (rugi, over-cap).
- Threshold dari `app_config`, **tidak ada angka hardcode**.
- Tidak ada LLM di jalur deterministik. LLM hanya di PR-15 (insight report peserta) dan
  ringkasan report gabungan di PR-16 — keduanya lewat `src/lib/report/insight.ts`, `token_used` dicatat.
- Label UI Bahasa Indonesia, komentar kode Bahasa Inggris, DB snake_case, kode camelCase.
