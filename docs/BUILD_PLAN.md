# BUILD_PLAN.md — Urutan eksekusi

Ikut urutan ini. Fase 0 blocking semua. Centang `[x]` saat selesai. Tiap task: type-safe, RLS aktif, audit_logs untuk mutasi, threshold dari app_config, 0 LLM di jalur deterministik.

## ⚠️ BLOCKER
- [x] **M4 join — RESOLVED.** Data = AGREGAT per (product_id, shop_id, period), BUKAN per-transaksi. Join CSV-all vs CSV-agency-link pakai **(product_id, shop_id)**. Bocor = selisih `affiliate_gmv`. Tidak ada txn_ref.
- [x] **CSV kolom — CONFIRMED.** Tersedia: Level 2 category (sub-kat), affiliate_live_gmv / affiliate_video_gmv (→ %live), shop_id, product_id, commission fields di CSV-2. Sample kolom lengkap ada di `docs/data-samples/`.
- [x] **Creator di file — RESOLVED.** File 1 creator = tanpa kolom creator. File multi-creator = ada kolom creator_name → resolve ke creator_id saat ingest.
- [x] **deal_end — RESOLVED.** Dari Master Deal Internal kolom Exp Date → brand_deals.exp_date → sync cooperating_shops.deal_end. Alert kadaluarsa M4 pakai ini.
- [ ] **M5/M6:** taksonomi sub-kategori level-2 (pakai `Level 2 category` platform — sudah konsisten karena sama-sama dari TikTok).
- [ ] **M8 e-sign:** pilih provider (Privy / Mekari Sign), dapatkan API key.
- [x] **Rate komisi — RESOLVED.** Master Deal Internal punya kolom Komisi Mea & Komisi Kreator per brand. Pakai Komisi Mea untuk M5. (Sebagian kotor: '5-7%'/'not found' → parse + flag.)

## Fase 0 — Fondasi (blocking, kerjakan penuh dulu)
- [x] Init Next.js 15 + Supabase, env, auth.
- [x] Jalankan migration `0001_init_schema.sql`.
- [x] Util terpusat: `genId()` (CRT/DEAL/LNK), `parseRupiah()`, `writeAudit()`, `getConfig(key)`.
- [x] RBAC middleware + RLS policy per role (lihat matrix di CLAUDE.md). agency_links & commission_share: NO user write.
- [x] Team Portal shell: role-aware nav/sidebar.
- [x] Bulk upload team_members + seed creators (CSV).
- [x] **Deal Registration Form** (validasi ketat, cegah data kotor) → brand_deals; sync exp_date→cooperating_shops.deal_end. Lihat CLAUDE.md #6.
- [x] Importer master deal internal lama (parser toleran, flag baris kotor untuk review). Lihat CLAUDE.md #7.

## Fase 1 — Data pipeline (paralel setelah Fase 0)
- [x] Ingestion `platform_metrics_raw` (upload CSV, idempotent per upload_batch). → `/metrics`
- [x] **M4 Link Leakage** (0 token, nilai cepat → dahulukan). Data AGREGAT per produk: → `/link-leakage`
  - [x] ingest CSV-1 (all) & CSV-2 (agency link); parseRupiah; skip baris "Summary"; map creator (1-creator: konteks upload; multi: kolom creator_name → prospek bila belum ada)
  - [x] refresh cooperating_shops (shop_id, kategori); active_flag hanya bila deal_end tersedia
  - [x] per (product_id, shop_id): gmv_bocor = affiliate_gmv[all] − affiliate_gmv[agency]; shop ber-deal? join cooperating_shops
  - [x] classify: ber-deal & bocor>0 → Bocor; ber-deal & bocor≈0 → Aman; non-deal → Lead (pair status → agency_links, engine-only write)
  - [x] rollup creator: sum(gmv_bocor shop ber-deal) / sum(gmv shop ber-deal) → 4 status (threshold app_config) → creator_link_status
  - [x] bd_leads dari shop non-deal (freq×gmv); alert bocor; alert deal kadaluarsa (hanya shop dgn deal_end) → platform_alerts + audit_logs
- [x] **M2 Report** (0 token kecuali insight): → `/reports`
  - [x] aggregation engine → data_json (metrik inti + tren live, funnel view→order, sumber GMV, top sub-kategori, posisi level, alert kontrak, benchmark peer, surface status M4)
  - [x] gate: skip insight bila |delta| ≤ config m2.delta_threshold (weekly; monthly selalu ber-insight)
  - [x] `generateInsight()` LLM (input ringkas, log token; model claude-haiku-4-5 via env M2_INSIGHT_MODEL) → draft
  - [x] finalize + export (print→PDF); cpm_report_activity; token_baseline ratchet (regresi → platform_alert)

## Fase 2 — Tools rule-based (paralel)
- [x] **`projectGmv(creatorId, subCategory, priceSegment, window=28d)→{min,max}`** — SHARED, satu implementasi. → `src/lib/projection/` (rumus tunggal `projectGmvRange`; basis = transactions_all per (subkat L2, segmen harga dari gmv/items_sold); config `projection.*` + `segments.price_bounds`)
- [x] **M5 Matching (CPM):** filter subkat+segmen → rank (bobot seimbang, tunable `m5.rank_weights`) → potensi komisi (projectGmv × rate kreator, range) → tandai SKU agency-link + flag SKU luar saran (join M4). → `/matching`, log ke `matching_runs`
- [x] **M6 Predictor (BizDev):** filter creator transaksi 28hr subkat (fallback segmen beda bila list < `m6.min_relevant_creators`, tidak ikut agregasi) → projectGmv per creator → agregasi potensi GMV brand + per-creator GMV total & %live. TANPA komisi MEA. → `/predictor`, log ke `deal_projections`
- [x] **M7 Special Project:** trackDaily (vs curve ramp-up + run-rate, tolerance `m7.status_tolerance`); checkProfitability (alert `project_rugi` bila ads_spend > mea_revenue; `project_over_cap`); filterLiveActive (GMV live ≥ `m7.live_active_min`, flag solo/cohost). → `/projects`, migration 0005

## Fase 3 — Workspaces (butuh M2/M4/M5/M6)
- [x] **M8** meng-surface, TIDAK menghitung ulang:
  - [x] routing: `routeCampaignRequest` (owner_cpm_id auto) → `confirmCampaign` → bila needs_brand_acc: `brandAcc` → fix → handover — state machine murni `src/lib/m8/routing.ts` + actions `/workspace/campaign-actions.ts`, semua transisi ter-audit
  - [x] CM: assignment creator (CM Lead), growth+alert (`m8.perf_drop` config, auto-resolve), surface report M2, creator_requests (sample/ads/HSL; ads > `creators.ads_budget_cap` → approval Director), shop lead manual → bd_leads. → `/workspace/cm`
  - [x] BizDev: tracker req semua CM, pipeline deal (`brand_deals.pipeline_stage`), brand report (agregasi transactions_all per shop deal + saran upgrade `m8.upgrade_roas_min`/`m8.upgrade_gmv_min`; +summarize LLM opsional — satu-satunya titik LLM M8, token di-log). → `/workspace/bizdev`, log ke `brand_reports`
  - [x] Acquisition: acquisitions (inbound/outbound/platform, GMV post-join window `m8.gmv_post_join_days`), referrals (antar_creator/platform), handoff ke CM. → `/workspace/acquisition`
  - [x] External: view approach/success/GMV (log `external_approaches`, surface agency_links M4). → `/workspace/external`
  - [x] e-sign kontrak TC/Celeb — alur status draft→sent→signed/expired penuh + audit di `/workspace/cm`; pemanggilan API provider MENYUSUL saat provider dipilih (BLOCKER provider masih terbuka)

## Fase 4 — OKR (paling akhir, butuh semua sumber)
- [x] **M3:** Dashboard Director (set target+reward, owner) → `/okr/director`
- [x] source adapters → M2/M4/M7/M8 (read-only) → `src/lib/m3/adapters.ts`
- [x] `scoreOkrWeekly`: pct_progress + achieved(≥100%) + gating flag+log → `scoreWeekly` server action
- [x] `snapshotQuarterEnd`: kunci → Director review gating → map reward (KR≥100%) → `snapshotQuarter` + `decidGating`
- [x] `handsOnRatio(cpm)`: kenaikan GMV × aktivitas CPM (M8 req + M2 log + assignment) → `getHandsOnRatio` adapter
- [x] Pure scoring lib + 32 unit tests → `src/lib/m3/scoring.ts`
- [x] Role-aware OKR dashboard (personal + management cross-team) → `/okr`
- [x] Migration 0007 (RLS, indexes, config Q3) applied to Supabase

## Bisa paralel
Fase 1 (M4 ∥ M2 setelah ingestion) · Fase 2 (M5/M6 ∥ M7).
Blocking keras: Fase 0→semua; projectGmv→M5+M6; M3 terakhir.

## Fase 5 — Special Project v2 (M7/M9, PRD v2.1)
Rencana lengkap: **`docs/BUILD_PLAN_M7_V2.md`** (PRD: `docs/prd/MCN_MEA_AI_Platform_Module07_Special_Project_v2.md`).
Urutan: Fase 0 hardening → 1A upload sesi live → 1B upload export harian → 1C report (halaman) → 1D portal peserta + undang akun → 2 kurasi → 3 info acara & feedback.

Status 16 Sep 2026 — migrasi 0052–0059 sudah jalan:
- [x] Fase 0 (#25) · Fase 1A (#26, #30) · Fase 1C+1D (#27, #31) · Fase 2 (#28) · Fase 3 (#29)
- [ ] **Fase 1B** (upload export harian product/shopee) — skema siap, parser + UI belum ada; menunggu sampel file

Keputusan Yohan 16 Sep 2026 (sudah dikunci, jangan dibuka ulang):
- [x] **B1/B2 — tolak.** Export product tanpa kolom tanggal DITOLAK, minta export harian. Tidak ada opsi bagi rata.
- [x] **B3 — report cukup di dashboard creator.** Template unduhan PNG/PDF (R30, §6.13) dicoret; 0 dependensi render baru. Konsekuensi: portal peserta naik jadi Fase 1D.
- [x] **B4 — sentimen feedback rule-based** (rating + NPS + leksikon `app_config`), nol LLM.
- [x] **B5 — tidak ada input GMV manual**, semua lewat upload; `upsertCreatorMetric` dicabut, `upsertDailyMetric` tinggal kolom biaya.
- [ ] Sisa dependensi (data, bukan keputusan): sampel export harian product MCN/TAP + Shopee — memblokir Fase 1B saja.
