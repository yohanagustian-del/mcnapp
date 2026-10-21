# MCN MEA AI Platform

Platform internal **MCN MEA** — agency creator TikTok & Shopee. Menggabungkan tools operasional yang tersebar (Google Sheets, tracker manual) menjadi satu sistem terpusat dengan 13 modul (M1–M13).

> **Sumber kebenaran operasional:** [`CLAUDE.md`](./CLAUDE.md) · **Urutan build:** [`docs/BUILD_PLAN.md`](./docs/BUILD_PLAN.md) · **PRD per modul:** [`docs/prd/`](./docs/prd/)

---

## Daftar Isi

1. [Ringkasan & Fitur Utama](#1-ringkasan--fitur-utama)
2. [Tech Stack](#2-tech-stack)
3. [Struktur Folder](#3-struktur-folder)
4. [Setup Lokal](#4-setup-lokal)
5. [Skema Database](#5-skema-database)
6. [Dokumentasi Rute & Server Actions](#6-dokumentasi-rute--server-actions)
7. [Deployment ke Production](#7-deployment-ke-production)

---

## 1. Ringkasan & Fitur Utama

MCN MEA AI Platform adalah sistem manajemen creator agency berbasis web yang menggantikan alur kerja di Google Sheets. Dibangun dengan prinsip **deterministik-first** — semua agregasi, scoring, dan klasifikasi dilakukan via SQL/rule-based; LLM hanya dipanggil untuk narrative insight (M2) dengan token tercatat.

### Modul

| Kode | Nama | Halaman | Deskripsi Singkat |
|------|------|---------|-------------------|
| **M1** | Foundation & Team Portal | `/dashboard`, `/tim`, `/creators`, `/deals` | Auth, RBAC 14 role, manajemen tim & kreator, Deal Registration Form tervalidasi |
| **M2** | Creator Report Generator | `/reports` | Aggregation engine deterministik → data_json + gate insight LLM (Anthropic) → draft + finalize + export PDF |
| **M4** | Link Leakage Detection | `/link-leakage`, `/ingest` | Upload artifak mingguan CM → rollup bocor per kreator (via_agency / bocor_sebagian / bocor_total) + lead BD dari shop non-deal |
| **M5** | Creator–Campaign Matching | `/matching`, `/products` | Filter subkat + segmen kuat creator → ranking bobot tunable → proyeksi komisi kreator (range) + badge link agency |
| **M6** | BD Deal Value Predictor | `/predictor` | Creator relevan 28 hari + projectGmv → potensi GMV brand (range) per creator + %live (menu disembunyikan, kode utuh) |
| **M7** | Special Project Tracker | `/projects` | Kurva target ramp-up + trackDaily + profitability check (alert anti-rugi) + manajemen peserta & man power |
| **M8** | Team Workspaces | `/workspace/cm`, `/workspace/bizdev`, `/workspace/acquisition`, `/workspace/external` | State machine routing campaign, CM growth + alert, BizDev pipeline + brand report, Acquisition binding, External approach |
| **M9** | Creator Portal (External) | `/portal` | Login mandiri creator → lihat data performa sendiri, agency plan (tanpa komisi MEA), ajukan komplain, request report 1×/minggu |
| **M10** | Campaign & Ads Support | `/workspace/ads` | Brief ads → approval budget → input hasil manual (GMV/ROAS/CPM/CTR/CVR) + cross-check toleransi dari app_config |
| **M11** | OD Oversight | `/od` | Read-only portal cross-team untuk OD viewer, deny semua mutasi via RLS restrictive |
| **M12** | Data Retention | `/admin/retention` | Agregasi bulanan permanen, konfigurasi purge window (raw_window, audit_window), run_retention_purge() |
| **M13** | Live Schedule | `/schedule` | Matriks creator × 7 hari, manajemen slot jadwal live (PK/TAP/ads/verifikasi CM+CS), salin minggu, roster |
| **M3** | OKR & Kinerja | `/okr`, `/okr/director` | Dashboard Director set target + reward → score weekly → snapshot quartal → gating review → peta reward |

### Prinsip Arsitektur

- **0 LLM di jalur deterministik** — klasifikasi, agregasi, scoring, matching = SQL/rule-based
- **LLM hanya untuk** insight naratif M2 (1 call/report) dan brand report summary M8 BizDev (opsional) — keduanya log `token_used`
- **Semua mutasi entity** → `audit_logs` (type: auto | approval | platform_alert)
- **Semua threshold** dari tabel `app_config` — tidak ada angka hardcode di kode
- **agency_links** dan `creators.commission_share` = read-only via engine; tidak ada endpoint edit manual
- **Approval gate**: aksi berpotensi merugikan (ads > budget cap) → approval Director; perubahan platform (komisi turun, link bocor) → alert otomatis

---

## 2. Tech Stack

### Frontend

| Layer | Teknologi | Versi |
|-------|-----------|-------|
| Framework | Next.js (App Router) | `^15.5.0` |
| Language | TypeScript | `^5.7.0` |
| Runtime | React | `^19.0.0` |
| Styling | Tailwind CSS | `^4.0.0` |
| Charts | Recharts | `^3.9.2` |
| Validation | Zod | `^3.24.0` |

### Backend

| Layer | Teknologi | Versi |
|-------|-----------|-------|
| API Pattern | Next.js Server Actions (tidak ada REST API layer terpisah) | — |
| Auth | `@supabase/ssr` | `^0.7.0` |
| AI/LLM | Anthropic SDK (`@anthropic-ai/sdk`) | `^0.110.0` |
| CSV Parsing | PapaParse | `^5.5.0` |
| Excel (`.xlsx`) | SheetJS (`xlsx`) | `^0.18.5` |

### Database & Infrastructure

| Layer | Teknologi | Versi |
|-------|-----------|-------|
| Database | Supabase (PostgreSQL) | — |
| Client SDK | `@supabase/supabase-js` | `^2.49.0` |
| Auth Provider | Supabase Auth | — |
| Row-Level Security | PostgreSQL RLS | — |
| Migrations | Plain SQL (`supabase/migrations/`) | 0001–0023 |

### Tooling

| Tool | Versi |
|------|-------|
| Node.js | ≥ 18 |
| npm | ≥ 9 |
| Vitest (testing) | `^3.0.0` |
| PostCSS | `^4.0.0` |

---

## 3. Struktur Folder

```
mcnapp/
├── docs/
│   ├── BUILD_PLAN.md              # Urutan eksekusi fase 0–4 (centang progres)
│   ├── HANDOFF.md                 # Ringkasan setiap sesi development
│   ├── artifact-generator-spec.md # Spesifikasi format artifak Agency Leaked Generator
│   ├── data-samples/              # Contoh file CSV/Excel untuk QA & smoke test
│   └── prd/                       # PRD per modul (M1, M2, M4–M8)
│
├── scripts/                       # Utilitas satu-kali (backfill, verifikasi)
│   └── backfill-avg-gmv.ts        # Backfill rata-rata GMV bulanan ke creators table
│
├── src/
│   ├── app/
│   │   ├── (portal)/              # Route group — semua halaman internal (auth-gated)
│   │   │   ├── layout.tsx         # Shell portal: sidebar role-aware, nav items
│   │   │   ├── dashboard/         # M1: Dasbor utama
│   │   │   ├── creators/          # M1: Daftar kreator + detail + chart GMV mingguan
│   │   │   ├── deals/             # M1: Daftar deal, registrasi baru, import master lama
│   │   │   ├── ingest/            # Lane 1 (TikTok/Shopee CSV) + Lane 2 (artifak leak Excel)
│   │   │   ├── link-leakage/      # M4: Tampilan status bocor + download CSV
│   │   │   ├── reports/           # M2: Generate, finalize, export report kreator
│   │   │   ├── matching/          # M5: Form matching creator–kampanye
│   │   │   ├── products/          # Katalog produk TAP (master upload dari ingest)
│   │   │   ├── predictor/         # M6: Prediksi deal BizDev (menu hidden, kode aktif)
│   │   │   ├── projects/          # M7: Manajemen special project + daily metrics
│   │   │   ├── schedule/          # M13: Board jadwal live streaming + roster + verifikasi
│   │   │   ├── workspace/
│   │   │   │   ├── cm/            # M8: CM Workspace (growth, alert, kontrak, requests)
│   │   │   │   ├── bizdev/        # M8: BizDev Workspace (pipeline, brand report, routing)
│   │   │   │   ├── acquisition/   # M8: Acquisition (binding, GMV post-join, referral)
│   │   │   │   ├── external/      # M8: External approaches + link leakage surface
│   │   │   │   └── ads/           # M10: Brief ads + hasil kampanye
│   │   │   ├── okr/               # M3: OKR personal + cross-team
│   │   │   │   └── director/      # M3: Config target + reward (Director only)
│   │   │   ├── od/                # M11: OD oversight (read-only)
│   │   │   ├── admin/retention/   # M12: Data retention dashboard
│   │   │   ├── tim/               # M1: Manajemen anggota tim
│   │   │   └── metrics/           # (Redirect → /ingest; halaman dihapus)
│   │   │
│   │   ├── portal/                # Route group — Creator Portal M9 (external, JWT creator_user)
│   │   │   ├── layout.tsx         # Shell portal kreator (stripped navbar)
│   │   │   ├── page.tsx           # Dasbor kreator (performa sendiri)
│   │   │   ├── agency-plan/       # Agency plan (tanpa kolom komisi MEA)
│   │   │   ├── complaints/        # Tiered complaint submission
│   │   │   ├── projects/          # Special projects yang diikuti
│   │   │   ├── reports/           # Report kreator self-service (1 credit/minggu)
│   │   │   └── requests/          # Status requests (sample/ads/HSL)
│   │   │
│   │   ├── login/                 # Halaman login (Supabase Auth)
│   │   ├── layout.tsx             # Root layout
│   │   ├── page.tsx               # Redirect → /dashboard atau /login
│   │   └── globals.css            # Global styles + Tailwind base
│   │
│   ├── components/
│   │   ├── csv-upload-form.tsx    # Shared CSV upload widget
│   │   └── project-requirements-panel.tsx
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts          # Browser-side Supabase client
│   │   │   ├── server.ts          # Server-side client (anon key + RLS)
│   │   │   ├── admin.ts           # Service-role client (bypass RLS, audit only)
│   │   │   └── fetch-all.ts       # Paginated fetch helper
│   │   │
│   │   ├── ingest/                # M4 data pipeline (TikTok + Shopee + artifak leak)
│   │   │   ├── parse.ts           # CSV parser TikTok (detectFormat, parseRupiah)
│   │   │   ├── aggregate.ts       # Aggregation engine: creator_period_summary + products_tap
│   │   │   ├── run.ts             # Orchestrator Lane 1 TikTok (idempotent per creator×minggu)
│   │   │   ├── creator-autofill.ts# Auto-fill creators.gmv (avg bulanan) pasca ingest
│   │   │   ├── schema.ts          # Zod schemas untuk CSV columns
│   │   │   ├── leak-artifact.ts   # Parser Excel artifak (v1 3-tab + v2 2-tab dual format)
│   │   │   ├── leak-rollup.ts     # Rollup status bocor per kreator (threshold dari app_config)
│   │   │   ├── leak-run.ts        # Orchestrator Lane 2 artifak leak
│   │   │   ├── shopee-csv.ts      # Parser CSV Shopee (Conversion Report per-transaksi)
│   │   │   ├── shopee-aggregate.ts# Agregasi Shopee → creator_period_summary
│   │   │   └── shopee-run.ts      # Orchestrator Lane 1 Shopee
│   │   │
│   │   ├── projection/            # Shared projectGmv() — SATU implementasi (M5 + M6)
│   │   │   ├── gmv.ts             # projectGmvRange(creatorId, subCat, segment, window)
│   │   │   └── project-gmv.ts     # Wrapper + disclaimer
│   │   │
│   │   ├── m3/                    # OKR engine
│   │   │   ├── scoring.ts         # scoreOkrWeekly, snapshotQuarterEnd, handsOnRatio
│   │   │   ├── adapters.ts        # Source adapters: M2/M4/M7/M8 → OKR actuals
│   │   │   └── usage.ts           # tool_usage_logs adapter
│   │   │
│   │   ├── m4/                    # Link leakage classification
│   │   │   ├── classify.ts        # Classify shop per (product_id, shop_id)
│   │   │   ├── engine.ts          # M4 engine (era pre-artifak, referensi)
│   │   │   └── leakage-detail.ts  # Detail bocor per produk
│   │   │
│   │   ├── m5/                    # Matching engine
│   │   │   └── match.ts           # filterAndRank, computeCommissionRange
│   │   │
│   │   ├── m7/                    # Special project tracking
│   │   │   ├── tracking.ts        # trackDaily, checkProfitability
│   │   │   └── requirements.ts    # filterLiveActive, project requirements
│   │   │
│   │   ├── m8/                    # Workspace logics
│   │   │   ├── routing.ts         # State machine routeCampaignRequest → handover
│   │   │   ├── brand-summary.ts   # Agregasi brand report (M8 BizDev)
│   │   │   └── weekly-growth.ts   # buildMonthlyGrowth, groupWeeksByMonth
│   │   │
│   │   ├── m9/                    # Creator portal
│   │   │   ├── creator-auth.ts    # JWT claim helper, auth_creator_id()
│   │   │   └── portal.ts          # Query performa, agency plan (strip komisi_mea)
│   │   │
│   │   ├── m10/                   # Ads support
│   │   │   ├── ads.ts             # Brief lifecycle, ROAS cross-check
│   │   │   ├── match.ts           # Matching creator–ads brief
│   │   │   └── products.ts        # Katalog produk untuk ads brief
│   │   │
│   │   ├── m12/                   # Data retention
│   │   │   └── retention.ts       # run_retention_purge() wrapper, window validation
│   │   │
│   │   ├── report/                # M2 report engine
│   │   │   ├── aggregate.ts       # Data aggregation deterministik → data_json
│   │   │   └── insight.ts         # generateInsight() — satu-satunya LLM call M2
│   │   │
│   │   ├── schedule/              # M13 live schedule
│   │   │   ├── types.ts           # Type definitions (slot, roster, indicator)
│   │   │   ├── week.ts            # weekOf(), isoWeekStart(), dateRange helpers
│   │   │   ├── matrix.ts          # buildScheduleMatrix (creator × 7 hari)
│   │   │   ├── indicators.ts      # Badge logic: PK/TAP/status/warning
│   │   │   └── copy-week.ts       # copyWeekAction, reset status/PK/verifikasi
│   │   │
│   │   ├── utils/
│   │   │   ├── rupiah.ts          # parseRupiah() — format "Rp1,xxx" & "Rp1.xxx"
│   │   │   ├── id.ts              # genId() — prefix CRT-/DEAL-/LNK-
│   │   │   ├── date.ts            # parseFlexibleDate(), formatDate()
│   │   │   ├── commission.ts      # parseCommission() — toleran "5-7%"/"not found"
│   │   │   ├── csv.ts             # CSV export helper
│   │   │   └── sheet.ts           # SheetJS helper untuk Excel read/write
│   │   │
│   │   ├── platform-csv.ts        # Shared platform CSV column detection
│   │   ├── audit.ts               # writeAudit() — semua mutasi material
│   │   ├── config.ts              # getConfig(key) → dari tabel app_config
│   │   └── rbac.ts                # requireMember(), requirePermission(), ROLES, NAV_ITEMS
│   │
│   └── middleware.ts              # Session refresh + auth gate (unauthenticated → /login)
│
├── supabase/
│   └── migrations/                # 23 file SQL (0001–0023), semua applied ke remote
│
├── CLAUDE.md                      # Aturan non-negotiable + konvensi kode (baca sebelum coding)
├── HANDOFF.md                     # Status lengkap per sesi development
├── next.config.ts                 # bodySizeLimit 10mb untuk upload CSV
├── tsconfig.json
├── tailwind.config.ts
├── vitest.config.ts               # Test runner (unit + integrasi)
└── .env.example                   # Template environment variables
```

---

## 4. Setup Lokal

### Prasyarat

- Node.js ≥ 18
- npm ≥ 9
- Akses ke Supabase project MCN MEA (`bqknstylbpwsnlgnzayw`)

### Langkah Setup

```bash
# 1. Clone repository
git clone https://github.com/yohanagustian-del/mcnapp.git
cd mcnapp

# 2. Install dependencies
npm install

# 3. Buat file environment lokal
cp .env.example .env.local
```

Edit `.env.local` dan isi semua nilai:

```env
# Supabase — salin dari Dashboard > Settings > API
NEXT_PUBLIC_SUPABASE_URL=https://bqknstylbpwsnlgnzayw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key-dari-supabase-dashboard>

# Service role key — WAJIB untuk bulk upload & audit log. JANGAN commit nilai nyata.
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-dari-supabase-dashboard>

# Opsional: aktifkan insight LLM M2 (tanpa key, report tetap tersimpan data-only)
ANTHROPIC_API_KEY=<anthropic-api-key>
M2_INSIGHT_MODEL=claude-haiku-4-5
```

```bash
# 4. Jalankan dev server
npm run dev
# Buka http://localhost:3000
```

> **Catatan:** Semua 23 migrations (`0001`–`0023`) sudah diterapkan ke Supabase remote. Tidak perlu jalankan migration ulang untuk development.

### Setup User Pertama (Director)

1. Buka Supabase Dashboard → **Authentication** → **Users** → **Invite user** (email Director)
2. Setelah user dibuat, insert baris ke tabel `team_members`:
   ```sql
   insert into team_members (id, name, email, role, team_group)
   values ('<auth-user-id>', 'Nama Director', 'email@meagency.co.id', 'director', 'management');
   ```
3. Setelah itu, semua onboarding anggota tim lewat halaman `/tim`.

### Test & Typecheck

```bash
npm run test        # 492 unit test (parser, M2–M13, proyeksi, RBAC, schedule)
npm run typecheck   # tsc --noEmit (0 error)
npm run build       # Production build check
```

### Smoke Test Manual (opsional, butuh file data nyata)

```bash
# Smoke test ingest TikTok (butuh file CSV MCN nyata)
SMOKE_DIR=/path/to/data RUN_INGEST_SMOKE=1 npm run test

# Smoke test artifak leak (butuh file Excel artifak nyata)
SMOKE_DIR=/path/to/data RUN_LEAK_SMOKE=1 npm run test
```

---

## 5. Skema Database

Database dikelola via plain SQL migrations di `supabase/migrations/`. Seluruh tabel menggunakan RLS (Row-Level Security). Semua operasi tulis sensitif dilakukan via `service-role` client (bypass RLS, dikontrol di server action).

### Tabel Utama & Relasinya

```
auth.users (Supabase managed)
    │
    ├── team_members (M1: anggota tim internal)
    │       id: uuid (FK → auth.users)
    │       role: role_t (14 role + ads_support + od_viewer)
    │       team_group: team_group_t
    │
    └── creator_users (M9: akun eksternal kreator)
            creator_id: text (FK → creators)
            auth_uid: uuid (FK → auth.users)

creators (master kreator)
    id: text (prefix CRT-)
    status: creator_status_t (prospek|binding|aktif|nonaktif)
    segment: creator_segment_t (tc|incubation|celeb)
    gmv: numeric (rata-rata GMV bulanan, di-update tiap ingest)
    commission_share: numeric (READ-ONLY, sync dari platform)
    owner_cpm_id: uuid (FK → team_members)

brand_deals (master deal)
    id: text (prefix DEAL-)
    shop_id: text (FK lookup ke cooperating_shops)
    exp_date: date (→ sync ke cooperating_shops.deal_end)
    komisi_kreator_pct, komisi_mea_pct: numeric
    deal_start, deal_end: date

cooperating_shops (master shop partner)
    shop_id: text (PK)
    deal_id: text (FK → brand_deals)
    deal_end: date (dari brand_deals.exp_date)
    active_flag: bool (computed: deal_end >= now)

agency_links (READ-ONLY — diisi engine M4)
    id: text (prefix LNK-)
    creator_id → creators
    shop_id, product_ref, platform
    link_status: link_status_t (via_agency|bocor_sebagian|bocor_total|belum_ada_link)

creator_link_status (rollup bocor per kreator, hasil artifak Lane 2)
    creator_id → creators
    week_start: date
    status: link_status_t
    gmv_affiliate_total, gmv_bocor, leak_ratio: numeric

transactions_all (agregat per product×shop×period — TikTok MCN)
    creator_id, period_start, period_end
    product_id, shop_id, affiliate_gmv, affiliate_live_gmv
    upload_batch: text (idempotent: ingest:<period>:<hash8>)

transactions_agency_link (agregat via link TAP — subset transactions_all)
    creator_id, product_id, shop_id
    affiliate_gmv, est_partner_commission, est_creator_commission

creator_period_summary (agregat mingguan per kreator — diisi ingest)
    creator_id, platform, period_start, window_end
    gmv_total, gmv_live, gmv_video, orders, views_total
    top_sub_categories: jsonb

products_tap (katalog produk dari TAP, master upload)
    product_id, shop_id, product_name, level2_category
    price: numeric, price_segment: price_segment_t

platform_metrics_raw (metrik mentah per kreator per periode)
    creator_id, period, metric, value, source

creator_reports (M2 — laporan kreator)
    creator_id, period_type, period_start
    data_json: jsonb, insight_draft, insight_final
    status: draft|final, token_used: int

audit_logs (immutable — semua mutasi material)
    actor_id → team_members
    action, entity_type, entity_id
    before, after: jsonb
    type: auto|approval|platform_alert

platform_alerts (notifikasi sistem)
    alert_type: link_bocor|deal_expiring|deal_expired|commission_drop|
                token_regression|project_rugi|project_over_cap|perf_drop
    creator_id, shop_id, resolved: bool

app_config (semua threshold — TIDAK hardcode di kode)
    key: text (PK), value: jsonb
    Contoh: m4.bocor_sebagian=0.10, m4.bocor_total=0.50,
            m7.live_active_min=65000000, m8.perf_drop=0.15

special_projects (M7)
    id: bigserial, target_gmv, daily_target_curve: jsonb
    status: planning|aktif|selesai

project_participants → special_projects × creators
project_manpower → special_projects × team_members
project_daily_metrics → special_projects × date (gmv_actual, ads_spend)

okr_key_results (M3 — KR per role/segment/periode)
    metric, target, period_type: quartal|bulan
    gating_rule: jsonb, reward_tier_ref → reward_tiers

okr_actuals → okr_key_results (pct_progress, achieved, computed_at)
okr_gating_events → okr_key_results (gating decision by Director)

live_schedule_slots (M13 — jadwal live)
    creator_id → creators, date, slot_index
    status: scheduled|tentative|off|done
    deal_id → brand_deals (opsional), ads_payer
    pk_ready, product_connected_tap: bool
    verified_by → team_members, verified_at

matching_runs (M5 — log run matching)
    creator_id, run_by, params, results: jsonb

deal_projections (M6 — log proyeksi deal)
    input, result: jsonb (total_min, total_max, relevant, fallback)

creator_users (M9 — external creator login)
    creator_id → creators, auth_uid → auth.users
    status: invited|active|suspended

creator_complaints (M9 — tiered complaint)
    creator_id, category, severity, body, status

creator_report_credits (M9 — 1 report/kreator/minggu)
    creator_id, week_start (UNIQUE per kreator per minggu)

ads_briefs (M10 — brief kampanye ads)
    source: cm|bizdev, creator_id, deal_id, project_id
    budget_requested, budget_approved, status

ads_campaign_results (M10 — hasil manual kampanye)
    brief_id → ads_briefs
    ads_spent, gmv, cpm, ctr, cvr, roas: numeric

metrics_monthly_agg (M12 — agregat bulanan permanen, survive purge)
    creator_id, month, metric, source, value

acquisitions (M8 — data closing creator baru)
    creator_id, specialist_id → team_members
    lead_source: inbound|outbound|platform
    gmv_post_join, binding_date

referrals (M8 — referral kreator)
    new_creator_id, referrer_creator_id → creators
    referral_source: antar_creator|platform
    commission_status: pending|dibayar

external_approaches (M8 — log approach creator external)
brand_reports (M8 — brand report BizDev, +1 LLM call opsional)
bd_leads (M4 — lead shop non-deal, source: auto_m4|artifact|manual_cm)
leak_week_summary (Lane 2 — total bocor mingguan per CM)
```

### Enums Penting

```sql
role_t: director | head | spv | cm_lead | cpm | bizdev_lead | bizdev |
        campaign_ops | bd_admin | acquisition_lead | acquisition_spec |
        campaign_external | creator_support | finance
        -- tambahan: ads_support | od_viewer (migration 0010)

link_status_t: via_agency | bocor_sebagian | bocor_total | belum_ada_link

price_segment_t: low (<180k) | entry (180k–800k) | sweet (800k–3.6jt) |
                 high (3.6jt–8jt) | premium (>8jt)

creator_status_t: prospek | binding | aktif | nonaktif

audit_type_t: auto | approval | platform_alert
```

---

## 6. Dokumentasi Rute & Server Actions

Platform ini **tidak memiliki REST API layer**. Semua operasi dilakukan via **Next.js Server Actions** — fungsi async yang berjalan di server, dipanggil langsung dari Client/Server Components.

### Pola Umum

Setiap modul memiliki file `actions.ts` di direktori page-nya:

```typescript
// Pola return — TIDAK pernah throw ke client (error disensored Next.js production)
type ActionResult<T> = { ok: true; result: T } | { ok: false; error: string }

// Setiap mutasi material memanggil writeAudit()
await writeAudit({ actorId, action: "deal.create", entityType: "brand_deal",
  entityId: deal.id, after: deal, type: "auto" });
```

### Halaman & Actions per Modul

#### M1 — Foundation

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/dashboard` | — | SSR: summary stats creator aktif, alert bocor, deal expiring |
| `/creators` | `creators/actions.ts` | `upsertCreators()` (bulk CSV), `getCreators()` |
| `/creators/[id]` | — | SSR: detail kreator + chart GMV mingguan dari `creator_period_summary` |
| `/deals` | `deals/actions.ts` | `listDeals()`, `getDealWithShops()` |
| `/deals/baru` | `deals/actions.ts` | `createDeal()` — validasi ketat (shop_id numeric, exp_date, komisi numeric) |
| `/deals/import` | `deals/actions.ts` | `importLegacyDeals()` — parser toleran, flag baris kotor ke `review_flags` |
| `/tim` | `tim/actions.ts` | `upsertTeamMembers()` (bulk CSV), `listTeamMembers()` |

#### M4 — Link Leakage & Ingest

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/ingest` | `ingest/actions.ts` | `runIngest(formData)` — Lane 1 TikTok: parse MCN CSV + TAP opsional → agregat → products_tap → auto-fill creators.gmv |
| `/ingest` | `ingest/shopee-actions.ts` | `runShopeeIngest(formData)` — Lane 1 Shopee: parse Conversion Report → creator_period_summary |
| `/ingest` | `ingest/leak-actions.ts` | `runLeakArtifact(formData)` — Lane 2: parse Excel artifak (v1/v2 dual format) → creator_link_status + bd_leads + leak_week_summary |
| `/link-leakage` | `link-leakage/actions.ts` | `getLinkLeakageSummary()`, `getLeakageByCreator()`, `exportLeakageCSV()` |

**Aturan ingest:**
- Batch ID Lane 1: `ingest:<periodStart>:<hash8>` (idempotent per kreator × minggu)
- File MCN wajib rentang W1–W5; lintas window → ditolak dengan pesan jelas
- Creator name baru dari file multi-creator → dibuat otomatis sebagai `prospek`

#### M2 — Report Generator

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/reports` | `reports/actions.ts` | `generateReport(creatorId, periodType)` — aggregation engine → data_json, gate delta, LLM call jika `|delta| > m2.delta_threshold` |
| `/reports/[id]` | `reports/[id]/finalize-form.tsx` | `finalizeReport(id, insightFinal)` — human-in-the-loop finalisasi + print PDF |

**LLM call:**
- Model: `claude-haiku-4-5` (override via `M2_INSIGHT_MODEL`)
- Input: ringkasan angka pre-computed (bukan raw rows)
- Output: insight naratif + `token_used` dicatat ke `creator_reports.token_used`
- Ratchet: token_used > baseline → `platform_alert` type `token_regression`

#### M5 — Creator–Campaign Matching

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/matching` | `matching/actions.ts` | `runMatching(dealId, subCategory, priceSegment)` — filter creator relevan → rank bobot → proyeksi komisi (range via `projectGmv`) → simpan ke `matching_runs` |
| `/products` | `products/actions.ts` | `listProducts()`, `uploadProductsCatalog()` |

#### M6 — Deal Value Predictor

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/predictor` | `predictor/actions.ts` | `runPredictor(subCategory, priceSegment, durationDays)` → potensi GMV brand + per creator (range) + %live; log ke `deal_projections` |

#### M7 — Special Project

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/projects` | `projects/actions.ts` | `createProject()`, `addParticipant()`, `inputDailyMetrics()`, `closeProject()` |
| `/projects/[id]` | — | SSR: progress vs kurva target, profitability, peserta aktif |

#### M8 — Team Workspaces

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/workspace/cm` | `workspace/cm/actions.ts` | `assignCreator()`, `submitRequest(type: sample|ads|hsl)`, `confirmCampaign()`, `updateEsign()` |
| `/workspace/bizdev` | `workspace/bizdev/actions.ts` | `routeCampaign(dealId, creatorId)`, `generateBrandReport(dealId)` (+LLM opsional) |
| `/workspace/acquisition` | `workspace/acquisition/actions.ts` | `recordBinding()`, `computeGmvPostJoin()`, `addReferral()` |
| `/workspace/external` | `workspace/external/actions.ts` | `logApproach()`, `getExternalMetrics()` |
| (shared) | `workspace/campaign-actions.ts` | `routeCampaignRequest()`, `confirmCampaign()`, `approveBrandAcc()`, `handoverCampaign()` — state machine murni |

**State machine campaign routing:**
```
routeCampaign (BizDev) 
  → confirmCampaign (CM: mau/tidak)
  → [brandAcc approval jika needs_brand_acc]
  → fix / batal
  → handover (Campaign Ops)
```

#### M9 — Creator Portal

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/portal` | `portal/actions.ts` | SSR (service-role, filtered by creator JWT) |
| `/portal/complaints` | — | `submitComplaint()`, tiered resolution CPM → SPV |
| `/portal/reports` | — | `requestReport()` — 1 credit/minggu (guard via `creator_report_credits`) |

#### M10 — Ads Support

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/workspace/ads` | `workspace/ads/actions.ts` | `createBrief()`, `approveAdsBudget()`, `inputResults()`, ROAS cross-check (tolerance dari `m10.roas_crosscheck_tol`) |

#### M13 — Live Schedule

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/schedule` | `schedule/actions.ts` | `createSlot()`, `updateSlot()`, `verifySlot()`, `toggleRoster()`, `copyWeekAction()` |

**Permission schedule:**
- View: management, CM, BizDev, CS (CPM hanya lihat creator sendiri)
- Edit: CM, BizDev, CS (CPM scope owner_cpm_id)
- Verify: CM, CS, management
- Roster: CM Lead, CPM, management

#### M3 — OKR

| Route | File Actions | Operasi Utama |
|-------|-------------|---------------|
| `/okr` | — | SSR: KR personal + cross-team (scope by role) |
| `/okr/director` | `okr/director/actions.ts` | `setTarget()`, `setReward()`, `scoreWeekly()`, `snapshotQuarter()`, `decidGating()` |

#### M11 & M12

| Route | Operasi |
|-------|---------|
| `/od` | SSR: `od_oversight_v` view (cpm_health, complaint metrics) — read-only |
| `/admin/retention` | `runRetentionPurge(windowDays)` — purge `transactions_all`, `platform_metrics_raw` (bukan identity/audit) |

---

## 7. Deployment ke Production

### Platform

Direkomendasikan: **Vercel** (zero-config dengan Next.js, support Server Actions, bodySizeLimit via `next.config.ts`).

### Checklist Pre-Deploy

- [ ] `npm run typecheck` → 0 error
- [ ] `npm run test` → semua pass
- [ ] `npm run build` → sukses (0 route error)
- [ ] Tidak ada nilai nyata di `.env.example` atau file yang di-commit

### Langkah Deploy ke Vercel

```bash
# 1. Pastikan semua perubahan sudah di-commit dan di-push
git add .
git commit -m "feat: production ready"
git push origin main
```

**Di Vercel Dashboard:**

1. **Import repository** dari GitHub (`yohanagustian-del/mcnapp`)
2. **Framework preset**: Next.js (auto-detected)
3. **Set Environment Variables** (Settings → Environment Variables):

   | Variable | Nilai | Keterangan |
   |----------|-------|------------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://bqknstylbpwsnlgnzayw.supabase.co` | Public — aman di client |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<anon-key>` | Public — aman di client |
   | `SUPABASE_SERVICE_ROLE_KEY` | `<service-role-key>` | **Rahasia** — server-only |
   | `ANTHROPIC_API_KEY` | `<api-key>` | Opsional (insight LLM M2) |
   | `M2_INSIGHT_MODEL` | `claude-haiku-4-5` | Opsional, default sudah di kode |

4. **Deploy** → Vercel akan menjalankan `npm run build` otomatis

### Konfigurasi Supabase Pasca-Deploy

Di **Supabase Dashboard → Authentication → URL Configuration**:

```
Site URL:       https://your-app.vercel.app
Redirect URLs:  https://your-app.vercel.app/**
```

> Tanpa konfigurasi ini, email invite/reset Supabase Auth akan redirect ke `localhost`.

### Catatan Penting

- **Service role key** hanya diakses di server (Server Actions + middleware) — tidak pernah dikirim ke browser
- **Semua migrations** (`0001`–`0023`) sudah applied ke Supabase remote — tidak perlu re-run
- **Upload CSV besar** (kreator, master deal) menggunakan `bodySizeLimit: "10mb"` di `next.config.ts` — Vercel mendukung ini
- **Dev server lokal**: `npm run dev -- --port 3100` (atau port lain sesuai kebutuhan)
- **Tidak ada native dependencies** — build langsung sukses di Vercel tanpa konfigurasi tambahan

### Monitoring & Observability

- `audit_logs` — log semua mutasi material (actor, action, before/after) — query langsung via Supabase Dashboard
- `platform_alerts` — alert sistem (bocor, deal expired, token regression) — surface di `/dashboard`
- `tool_usage_logs` — page-view per user (best-effort, dicatat di middleware)
- `token_used` di `creator_reports` — tracking penggunaan LLM per report

---

*Untuk pertanyaan teknis dan keputusan arsitektur, baca [`CLAUDE.md`](./CLAUDE.md). Untuk status development terkini, baca [`HANDOFF.md`](./HANDOFF.md).*
