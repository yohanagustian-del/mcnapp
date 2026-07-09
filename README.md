# MCN MEA AI Platform

Platform internal MCN MEA (agency creator TikTok/Shopee) — 8 module (M1–M8).
Sumber kebenaran operasional: [`CLAUDE.md`](./CLAUDE.md). Urutan eksekusi: [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md).

## Stack
Next.js 15 (App Router, TypeScript, Server Actions) · Supabase (Postgres + Auth + RLS) · Tailwind.

Supabase project: **MCN MEA** — `https://bqknstylbpwsnlgnzayw.supabase.co`

## Setup
```bash
cd mcn
npm install
cp .env.example .env.local   # isi SUPABASE_SERVICE_ROLE_KEY dari Dashboard > Settings > API
npm run dev
```

Migrations di `supabase/migrations/` sudah diterapkan ke project via MCP:
- `0001_init_schema.sql` — enum + tabel M1–M8 + RLS skeleton
- `0002_rls_rbac_policies.sql` — RBAC policies per role, proteksi `commission_share`, kolom `review_flags`
- `0003_security_hardening.sql` — fix advisor (search_path, revoke anon RPC)
- `0004_phase1_pipeline.sql` — `creator_link_status` (rollup M4), `platform_alerts`,
  unique metrik + sub_category, `bd_leads` unik per shop, config `m4.expiry_alert_days`
- `0005_phase2_tools.sql` — `matching_runs` (M5), `deal_projections` (M6), kolom
  `created_by`/`result_summary` + RLS tabel M7, alert `project_rugi`/`project_over_cap`,
  config proyeksi (`projection.*`, `segments.price_bounds`, `m5.rank_weights`,
  `m6.min_relevant_creators`, `m7.status_tolerance`)
- `0006_phase3_workspaces.sql` — kolom routing `campaign_requests`, approval ads
  `creator_requests` + `creators.ads_budget_cap`, kolom e-sign `creator_contracts`,
  handoff `acquisitions` + komisi `referrals`, `brand_deals.pipeline_stage`, tabel
  `external_approaches` & `brand_reports`, alert `perf_drop`, config
  `m8.upgrade_roas_min`/`m8.upgrade_gmv_min`/`m8.gmv_post_join_days`

## Status Fase 0 (fondasi) — selesai
- ✅ Init Next.js 15 + Supabase (env, auth via `@supabase/ssr`, middleware session)
- ✅ Migration `0001_init_schema.sql` dijalankan
- ✅ Util terpusat: `genId()` (`src/lib/utils/id.ts`), `parseRupiah()` (`rupiah.ts`),
  `writeAudit()` (`src/lib/audit.ts`), `getConfig()` (`src/lib/config.ts`)
  + `parseCommission()` & `parseFlexibleDate()` untuk data kotor
- ✅ RBAC middleware + RLS per role (`0002`, `src/lib/rbac.ts`, `src/middleware.ts`) —
  `agency_links` & `creators.commission_share` tanpa jalur tulis user (trigger + no policy)
- ✅ Team Portal shell role-aware (`src/app/(portal)/layout.tsx`)
- ✅ Bulk upload `team_members` + seed `creators` (CSV, `/tim` & `/creators`)
- ✅ Deal Registration Form tervalidasi (`/deals/baru`) → `brand_deals`, sync
  `exp_date` → `cooperating_shops.deal_end`
- ✅ Importer master deal internal lama (`/deals/import`) — parser toleran + `review_flags`

## Status Fase 1 (data pipeline) — selesai
- ✅ Ingestion `platform_metrics_raw` (`/metrics`) — CSV single/multi-creator, idempotent per
  batch (`pm:<source>:<period>`), creator_name baru → prospek + flag
- ✅ **M4 Link Leakage** (`/link-leakage`) — upload CSV-1/CSV-2/master shop + engine
  deterministik 0 token: join (product_id, shop_id), pair status → `agency_links`
  (service-role only), rollup creator → `creator_link_status`, lead BD → `bd_leads`,
  alert bocor & deal kadaluarsa → `platform_alerts` + `audit_logs`
- ✅ **M2 Report** (`/reports`) — aggregation engine deterministik → `data_json`, gate
  skip-LLM (`m2.delta_threshold`), `generateInsight()` (Anthropic SDK, token tercatat),
  finalize human-in-the-loop + export print→PDF, `cpm_report_activity`, ratchet
  `token_baseline` (regresi → alert)

## Status Fase 2 (tools rule-based) — selesai
- ✅ **`projectGmv()` shared** (`src/lib/projection/`) — SATU rumus proyeksi untuk M5 & M6:
  basis GMV window 28 hari per (sub-kategori Level 2, segmen harga) dari `transactions_all`
  (harga satuan = gmv/items_sold) × faktor level ± spread → selalu range + disclaimer
- ✅ **M5 Matching** (`/matching`) — filter subkat + segmen kuat creator → ranking bobot
  seimbang (tunable `m5.rank_weights`) → potensi komisi kreator (range) + badge link
  agency & daftar SKU di luar link (join M4); run tercatat di `matching_runs`
- ✅ **M6 Predictor** (`/predictor`) — creator relevan 28 hari (subkat+segmen; fallback
  segmen lain bila < `m6.min_relevant_creators`, tidak ikut agregasi) → potensi GMV brand
  (range) + GMV total & %live per creator; TANPA komisi MEA; log `deal_projections`
- ✅ **M7 Special Project** (`/projects`) — kurva target ramp-up + trackDaily (gap,
  run-rate, on-track/behind/ahead), checkProfitability (alert anti-rugi bila ads > revenue
  MEA + over-cap → `platform_alerts`), peserta (external wajib binding TikTok, flag
  solo/co-host, filter live-active ≥ `m7.live_active_min`), man power, penutupan →
  `result_summary`

## Status Fase 3 (M8 Team Workspaces) — selesai
- ✅ **Routing req campaign lintas-workspace** (`src/lib/m8/routing.ts` + `/workspace/campaign-actions.ts`) —
  state machine murni: BizDev route (owner_cpm_id AUTO dari creator) → CM konfirmasi
  mau/tidak → [acc brand bila `needs_brand_acc`] → fix/batal → handover Campaign Ops;
  semua transisi ter-audit (§2E)
- ✅ **CM Workspace** (`/workspace/cm`) — growth mingguan per creator + scan alert
  `perf_drop` (> `m8.perf_drop` w-o-w, auto-resolve), re-assign creator (CM Lead),
  req sample/ads/HSL (ads melewati `creators.ads_budget_cap` → approval Director),
  shop potensial → `bd_leads` (manual_cm), surface report M2, kontrak e-sign TC/Celeb
  (draft→sent→signed/expired; API provider menyusul — blocker Privy vs Mekari Sign)
- ✅ **BizDev Workspace** (`/workspace/bizdev`) — tracker req semua CM, pipeline deal
  per tahap, routing campaign, report brand (`brand_reports`): agregasi `transactions_all`
  per shop deal + ROAS (bila ads spend diisi) + saran upgrade service
  (`m8.upgrade_roas_min` + `m8.upgrade_gmv_min`); ringkasan naratif = 1 LLM call
  OPSIONAL (satu-satunya titik LLM M8, token di-log)
- ✅ **Acquisition Workspace** (`/workspace/acquisition`) — closing binding per
  specialist & sumber (inbound/outbound/platform), GMV post-join (window
  `m8.gmv_post_join_days` dari `platform_metrics_raw`), referral antar_creator/platform
  + status komisi, handoff ke CM (creator → aktif)
- ✅ **External Workspace** (`/workspace/external`) — log approach (`external_approaches`),
  success rate (deal pakai link TAP), GMV creator ter-link + surface `agency_links` M4

## Langkah manual yang tersisa
1. Isi `SUPABASE_SERVICE_ROLE_KEY` di `.env.local` (untuk bulk upload tim & audit log).
   Tambahkan `ANTHROPIC_API_KEY` bila insight LLM M2 ingin aktif (tanpa key, report data-only).
2. Buat user pertama (Director) di Supabase Dashboard → Authentication, lalu insert baris
   `team_members` dengan id user tsb (role `director`, team_group `management`) — setelah itu
   semua onboarding lewat halaman `/tim`.
3. Set password user via email invite/reset Supabase.

## Test & typecheck
```bash
npm run test        # parser + M4 + M2 + proyeksi + M5 + M7 + M8 routing (82 test)
npm run typecheck
```
