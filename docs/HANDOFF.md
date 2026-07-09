# HANDOFF — MCN MEA AI Platform

> Catatan serah-terima antar sesi. Baca ini + `CLAUDE.md` + `docs/BUILD_PLAN.md` sebelum lanjut.
> Update terakhir: 2026-07-03. Branch kerja: `claude/mcn-phase-3-kickoff-zjtfyo`.

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
