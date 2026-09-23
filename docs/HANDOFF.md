# HANDOFF — MCN MEA AI Platform

> Catatan serah-terima antar sesi. Baca ini + `CLAUDE.md` + `docs/BUILD_PLAN.md` sebelum lanjut.
> Update terakhir: 2026-09-23 (Creator Product Match/BD Value Predictor v2/Brand Lead Bank/PX
> catalog, migrasi 0067-0068). Isi di bawah sampai baris "Update terakhir: 2026-07-03" adalah
> historis — dokumen ini tidak diperbarui SETIAP sesi (lihat juga root `HANDOFF.md`, yang sampai
> 2026-09-21 sempat lebih baru dari file ini); jangan asumsikan "Sisa pekerjaan" di bawah masih
> akurat tanpa cek kode maupun root `HANDOFF.md`.

## 2026-09-23 — Creator Product Match, BD Value Predictor v2, Brand Lead Bank, PX catalog

Ringkasan penuh (14 PR #56-#68, migrasi 0067/0068, apa yang belum dikerjakan) ada di root
`HANDOFF.md` — entri di sana JAUH lebih detail, jangan diduplikasi di sini. Poin yang paling
relevan buat siapa pun yang mulai dari FILE INI (bukan root):
- Engine rekomendasi produk sekarang SATU (`lib/product-match/`), dipakai `/matching`,
  `/creators/[id]`, CM Workspace, `/portal/produk`. M5 lama (`lib/m5/match.ts`) & skor M10
  (`matchProductsForCreator`/`matchCreatorsForProduct`) SUDAH TIDAK ADA.
- `/predictor` (M6, model pool `lib/m6/predictor.ts`) sudah di-un-hide dari nav.
- `/leads` (Brand Lead Bank) baru — beda dari `bd_leads` (lead shop M4).
- Bridge PX Exchange sekarang DUA ARAH: MCN→CDPS (Flow C, PX-M3-A, sudah lama ada) DAN CDPS→MCN
  (`POST /api/bridge/px-catalog`, baru sesi ini, `docs/BRIDGE_PX_CATALOG_CONTRACT.md`). Sisi CDPS
  untuk arah baru ini BELUM dibangun.
- CLAUDE.md #4/#8/#9 ditulis ulang mengikuti keadaan baru ini — baca itu, bukan bagian PX-M1 di
  bawah, untuk aturan Product Match/proyeksi GMV yang berlaku sekarang.

## 2026-09-16 — PX-M3-A: coverage push ke CDPS (Flow C)

Sesi ini menutup tiket M3-A dari `MEAgrup/AgencyAPP` (`docs/backlog/PX_M3_BACKLOG.md`
sisi CDPS) — PX-M1 (`bridge.px_creator_capability`, migrasi 0051) sudah ADA dari sesi
sebelumnya; yang belum ada adalah pengirimannya ke CDPS.

- **Kontrak**: `docs/BRIDGE_PRODUCT_EXCHANGE_CONTRACT.md` + `docs/fixtures/px_coverage_v1.json`
  disalin **byte-identik** dari `MEAgrup/AgencyAPP`. Dokumen itu (bukan repo mana pun) adalah
  sumber kebenaran bentuk payload — jangan menebak bentuknya dari kode CDPS atau sebaliknya.
- **Eksporter**: `src/lib/px/coverage-push.ts` (`pushCoverageSnapshot`/`pushCoverageForBatch`).
  **Deviasi dari tiket asli**: tiket membayangkan fungsi SQL baru `bridge.px_coverage_export()`
  yang menambah `snapshot_at` di atas `bridge.px_coverage_map()`. Itu tidak dibangun — `public.px_coverage()`
  (sudah ada, migrasi 0051) sudah persis passthrough yang dibutuhkan, dan `listCoverage()` sudah
  jadi satu-satunya jalur baca (CLAUDE.md #4). `snapshot_at` ditambahkan di TypeScript, saat
  payload benar-benar dibangun — nol migrasi baru untuk M3-A.
- **Trigger**: dipicu dari **akhir pipeline ingest yang sudah ada** (`src/lib/ingest/run.ts`,
  step 10, setelah step 7 recompute kapabilitas) — nol scheduler baru, sama kebijakan PX-M1.
  Own try/catch: gagal push (jaringan/CDPS down/secret salah) dilaporkan di
  `coveragePush`/`coveragePushSkipped`/`coveragePushError`, TIDAK PERNAH menggagalkan ingest yang
  sudah commit.
- **Secret**: `BRIDGE_PX_SECRET` (env baru, lihat `.env.example`) — TERPISAH dari
  `SUPABASE_SERVICE_ROLE_KEY`/`ANTHROPIC_API_KEY`, disepakati out-of-band dengan sisi CDPS,
  JANGAN commit nilai asli. Tanpa `BRIDGE_PX_SECRET`/`CDPS_BRIDGE_URL`, push dilewati (dilaporkan,
  bukan dianggap gagal) — aman untuk dev lokal yang belum diberi secretnya.
- **Idempotensi**: `Idempotency-Key: px-coverage-<YYYYMMDD>-<sha256(payload)[0:12]>` dihitung dari
  body PERSIS yang dikirim (urutan key JSON stabil — object literal ditulis urutan tetap) supaya
  retry mengirim key yang sama.
- **K-2 (nol identitas kreator)**: strukural, bukan filter yang bisa lupa — `bridge.px_coverage_map()`
  adalah agregat `GROUP BY (level2_category, price_segment)`, jadi tidak ada kolom `creator_id` untuk
  diteruskan sejak awal. Diuji eksplisit di `coverage-push.test.ts` (assert body tidak mengandung
  string `creator_id`/`creator_ids`/`creatorId`).
- **Tes**: `src/lib/px/__tests__/coverage-push.test.ts` (11 kasus unit, mock `fetch`+`listCoverage`+
  `writeAudit`: skip saat env kosong, skip saat nol baris, tolak >5.000 baris, bentuk payload persis
  6 kolom+3 top-level, koersi numeric/bigint string→number, non-2xx→throw, duplicate:true bukan error,
  wrapper `pushCoverageForBatch` never-throws+audit). `src/lib/px/__tests__/bridge-push.qa-manual.test.ts`
  (skip — dokumentasi langkah manual push ke CDPS staging, pola sama `overcommit.qa-manual.test.ts`;
  tidak ada CDPS_BRIDGE_URL/BRIDGE_PX_SECRET nyata di sandbox ini untuk push sungguhan).
- **Diverifikasi**: `npx tsc --noEmit` bersih, `npx vitest run` — 840 lulus + 5 skip (0 gagal), termasuk
  67 file test lain yang TIDAK disentuh sesi ini (nol regresi).
- **Belum dikerjakan** (bukan lupa, di luar tiket M3-A): OQ-8-setara di sisi MCN (token pass-through)
  tidak relevan — payload ini tidak membawa token; wiring `CDPS_BRIDGE_URL`/`BRIDGE_PX_SECRET` yang
  SUNGGUHAN di Vercel env vars (prasyarat go-live, bukan blocker kode); QA manual real push ke
  staging CDPS (langkah ada di `bridge-push.qa-manual.test.ts`, belum dijalankan — perlu koordinasi
  kredensial dengan sesi CDPS).

---

## Status besar
**Semua fase pembangunan (0–4) SELESAI** — mencakup M1–M8. Tidak ada Fase 5.
Platform lengkap fungsional. Sisa pekerjaan = penyelesaian blocker + QA + persiapan produksi (lihat "Sisa pekerjaan").

| Fase | Modul | Status |
|---|---|---|
| 0 Fondasi | M1 auth/RBAC/portal/deal-form/importer | ✅ |
| 1 Data pipeline | M4 Link Leakage, M2 Report | ✅ |
| 2 Tools rule-based | M5 Matching, M6 Predictor, M7 Special Project | ✅ |
| 3 Workspaces | M8 CM/BizDev/Acquisition/External + e-sign flow | ✅ |
| 4 OKR | M3 scoring/adapters/dashboard | ✅ |

## Migrasi Supabase (project `bqknstylbpwsnlgnzayw`)
`0001_init_schema` → `0005` (M7) → `0006_phase3_workspaces` (M8) → `0007_phase4_okr` (M3). Semua sudah APPLIED.

## Yang dikerjakan di sesi ini (Fase 4 M3 + testing + seed)
- **M3 OKR selesai**: `src/lib/m3/scoring.ts` (10 fungsi pure, 0 LLM), `adapters.ts` (9 adapter read-only M2/M7/M8), server actions `okr/director/actions.ts` (saveKrTarget/saveRewardTier/decidGating/snapshotQuarter/scoreWeekly), halaman `/okr` (role-aware) + `/okr/director` (config). RBAC `m3.*` di `rbac.ts`.
- **Tests**: 133 passing total. M3 = 51 (scoring 32 + adapters 19). Adapter test pakai mock Supabase chainable+thenable di `src/lib/m3/__tests__/adapters.test.ts`.
- **Seed data test** dimasukkan ke Supabase remote (via MCP execute_sql) untuk demo browser — lihat "Seed data" di bawah.
- **`.env.local`** dibuat di container (gitignored). URL+anon key publik terisi; service key placeholder.

## Cara jalankan lokal (untuk user)
Project ini dibuat di Claude Code **web/cloud** — TIDAK ada di laptop user sampai di-clone.
```
git clone https://github.com/yohanagustian-del/claudecode.git
cd claudecode && git checkout claude/mcn-phase-3-kickoff-zjtfyo && cd mcn
# buat .env.local (URL+anon key publik di bawah; service key dari Dashboard>Settings>API)
npm install && npm run dev   # http://localhost:3000
```
`.env.local` minimum:
```
NEXT_PUBLIC_SUPABASE_URL=https://bqknstylbpwsnlgnzayw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_3XMggPBsF3l5OOyu44MqLg_if-eBwWq
SUPABASE_SERVICE_ROLE_KEY=<dari Dashboard; wajib utk tombol aksi: scoring/gating/snapshot/M5/M6/upload>
```
Catatan: anon key cukup utk login + lihat halaman (read RLS). Service key hanya utk mutasi.
Container cloud TIDAK bisa akses supabase.co (proxy 403) → app harus dijalankan di mesin user.

## Seed data test (ADA di Supabase remote sekarang — HAPUS sebelum produksi)
Login semua akun password: **`Password123!`**
- director@mcn.test (director) · cpm@mcn.test (cpm) · cmlead@mcn.test (cm_lead) · acq@mcn.test (acquisition_spec) · bizdev@mcn.test (bizdev)
- 6 creators (CRT-001..006, owner = cpm), 12 platform_metrics_raw (gmv Jun+Jul), 6 transactions_all
- M3: 7 KR (id 1–7), 7 okr_actuals, 6 reward_tiers (bizdev tier-2 = TBD), 1 okr_gating_events pending (kr_id=1), 1 okr_snapshots baseline
- M7: 3 special_projects (selesai/aktif/planning)
- Halaman terisi: /okr, /okr/director, /creators, /projects, /tim, /metrics, /matching, /predictor
- Halaman masih kosong (belum di-seed): /deals, /link-leakage, /reports, /workspace/*

## Sisa pekerjaan (BUKAN fase baru)
1. **BLOCKER M8 e-sign**: alur status draft→sent→signed/expired sudah jadi di `/workspace/cm` (actions.ts pakai `process.env.ESIGN_PROVIDER`). Tinggal implementasi pemanggilan API provider setelah user pilih Privy vs Mekari Sign + dapat API key.
2. **BLOCKER M5/M6 taksonomi**: pakai "Level 2 category" TikTok — konfirmasi resmi saja.
3. **QA browser**: user akan uji manual. Alur demo: login Director → /okr (cross-team + gating) → /okr/director (putuskan gating) → login CPM → /okr (hands-on ratio + reward Rp2jt dari 2 KR).
4. **Produksi**: (a) jadwal batch otomatis — Edge Function cron utk scoreWeekly OKR + ingest mingguan M4; (b) review `get_advisors` security Supabase; (c) **hapus seed data test** + akun *.mcn.test; (d) deploy (Vercel + env vars).

## Aturan kunci (dari CLAUDE.md — jangan langgar)
- 0 LLM di jalur deterministik (scoring/matching/agregasi/prediksi). LLM hanya reasoning naratif (M2 insight, ringkasan M3/M7/M8), selalu log token.
- Semua threshold dari `app_config` (jangan hardcode). Semua mutasi → `audit_logs`.
- RBAC enforce di server (RLS + requirePermission), bukan cuma UI.
- OKR: %progres = actual/target (boleh >100%); reward hanya dari KR ≥100% (biner); gating = TANDAI "berisiko gugur" + log, TIDAK auto-gugur (Director yang putuskan). LOCKED.
- projectGmv() = SATU implementasi shared M5+M6.
