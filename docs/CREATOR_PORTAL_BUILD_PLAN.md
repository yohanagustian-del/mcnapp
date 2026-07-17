# CREATOR PORTAL — Build Plan & Logic (Module 9 / M9)

> Dokumen mandiri untuk mem-porting **Creator Portal** ke platform lain.
> Diambil dari implementasi nyata di repo ini (`supabase/migrations/0010–0011`, `src/lib/m9/`, `src/app/portal/`).
> Ditulis stack-agnostic: konsep + rule + kontrak, lalu contoh SQL/logic konkret.

---

## 0. Apa itu Creator Portal & prinsip non-negotiable

Portal eksternal untuk **kreator** (bukan tim internal). Satu kreator = satu login. Fungsinya
**presentasi + intake**, BUKAN mesin hitung.

Prinsip yang WAJIB dipegang (ini yang bikin portal aman):

1. **0 token AI** di seluruh portal, kecuali **1 titik**: report self-service (1×/minggu) yang
   memakai ulang pipeline report (M2). Semua sisanya deterministik (SQL + rule).
2. **Portal tidak pernah menghitung ulang.** GMV/performa dibaca dari sumber report (M2);
   komisi dari sumber deal (BizDev/M8); status link dari engine leakage (M4). Portal hanya
   membaca view yang sudah jadi.
3. **Self-only isolation, berlapis dua.** (a) Server selalu memfilter dengan `creator_id` dari
   sesi — TIDAK PERNAH percaya `creator_id` dari client. (b) RLS di DB sebagai defense-in-depth.
4. **Intake ≠ write langsung.** Semua aksi kreator = *request/intake* ke tabel terpisah, tidak
   pernah menulis ke tabel operasional (deals, metrics, link status).
5. **Strip data sensitif.** Kreator TIDAK BOLEH lihat `komisi_mea`, margin, service_fee, ads_budget,
   data kreator lain, atau data internal apa pun.
6. **Audit semua mutasi** dengan actor label `creator_user:<creator_id>`.
7. **Immutability komplain.** Kreator submit, tim boleh *close* & *reply* — tapi body/creator/
   severity/category tidak pernah bisa diubah siapa pun. Reply append-only.

---

## 1. Halaman portal (surface)

Navigasi kreator (label Bahasa Indonesia):

| Path | Label | Isi | Sumber |
|---|---|---|---|
| `/portal` | Performa Saya | Metrik inti + tren live (read-only) | view metrics (M2) |
| `/portal/agency-plan` | Agency Plan | Daftar produk deal aktif + komisi **kreator** saja | view plan (deal, di-strip) |
| `/portal/reports` | Report Saya | Report final + tombol "improve" (1×/minggu) | reports (status=final) + credit |
| `/portal/requests` | Request Brand/Ads | Ajukan sample/ads/HSL → owner CPM | intake `creator_requests` |
| `/portal/projects` | Special Project | Project open-for-signup + join request | projects + join_requests |
| `/portal/complaints` | Komplain & Feedback | Ajukan komplain (immutable) / feedback | intake complaints/feedback |

Aturan surface:
- Report hanya yang `status = 'final'` (draft internal tak terlihat).
- Project hanya yang `open_for_signup = true` ATAU yang kreator ikut serta.
- Agency plan hanya deal `status = 'running'` dan belum kadaluarsa (`exp_date > now()`).

---

## 2. Data model

Semua tabel baru khusus portal. Tabel operasional lama (creators, reports, metrics, projects,
deals) hanya DIBACA lewat view + RLS.

### 2.1 Principal login kreator — `creator_users` (1 kreator = 1 login)

```sql
create table creator_users (
  id            uuid primary key default gen_random_uuid(),
  creator_id    text not null references creators(id) on delete cascade,
  email         text not null unique,
  auth_uid      uuid unique,                 -- id user di auth provider; null saat masih diundang
  status        text not null default 'invited'
                  check (status in ('invited','active','suspended')),
  invite_token  text unique,                 -- link manual sampai email provider disambung
  invited_by    uuid,                         -- team_members.id
  invited_at    timestamptz not null default now(),
  activated_at  timestamptz,
  unique (creator_id)                         -- 1 kreator TIDAK boleh punya 2 login
);
```

### 2.2 Kredit report self-service — `creator_report_credits` (1/minggu, hangus)

```sql
create table creator_report_credits (
  id          bigserial primary key,
  creator_id  text not null references creators(id) on delete cascade,
  week_start  date not null,                 -- Senin (ISO week) — kunci window
  used_at     timestamptz not null default now(),
  report_id   bigint,                         -- creator_reports.id (hasil)
  unique (creator_id, week_start)             -- HARD GUARD: 1 kredit/kreator/minggu
);
```
> Kuota **tidak akumulatif**: minggu lalu tak dipakai ≠ dapat 2 minggu ini. `unique` = anti-race.

### 2.3 Komplain (tiered) + reply + feedback

```sql
create table creator_complaints (
  id            bigserial primary key,
  creator_id    text not null references creators(id) on delete cascade,
  category      text not null,               -- dari config m9.complaint_categories
  severity      text not null default 'sedang' check (severity in ('rendah','sedang','tinggi')),
  body          text not null,
  status        text not null default 'baru' check (status in ('baru','dalam-penyelesaian','selesai')),
  target_cpm_id uuid,                          -- owner CPM kreator (auto-resolve saat submit)
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid                           -- team_members.id yang menutup
);

-- Reply APPEND-ONLY (immutable). Role internal menambah; tak ada yang bisa edit/hapus.
create table complaint_replies (
  id           bigserial primary key,
  complaint_id bigint not null references creator_complaints(id) on delete cascade,
  author_id    uuid,
  author_role  text not null,                 -- cpm / cm_lead / director
  body         text not null,
  created_at   timestamptz not null default now()
);

-- Feedback non-komplain (saran/apresiasi) — TIDAK PERNAH dihitung negatif.
create table creator_feedback (
  id         bigserial primary key,
  creator_id text not null references creators(id) on delete cascade,
  body       text not null,
  sentiment  text default 'netral' check (sentiment in ('positif','netral','saran')),
  created_at timestamptz not null default now()
);
```

### 2.4 Join request special project

```sql
create table project_join_requests (
  id         bigserial primary key,
  project_id bigint not null references special_projects(id) on delete cascade,
  creator_id text not null references creators(id) on delete cascade,
  status     text not null default 'diajukan' check (status in ('diajukan','diterima','ditolak')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (project_id, creator_id)             -- tak bisa daftar 2×
);

-- kolom tambahan di tabel project:
alter table special_projects
  add column open_for_signup boolean not null default false,
  add column join_requirements text;          -- syarat yang ditampilkan di portal

-- intake source di request lama (bedakan request dari CPM vs dari portal):
alter table creator_requests
  add column source text not null default 'cpm' check (source in ('cpm','creator_portal'));
```

---

## 3. Auth & model isolasi (paling penting saat porting)

### 3.1 Alur autentikasi
1. Tim internal **mengundang** kreator → buat baris `creator_users` (status `invited`, `invite_token`).
2. Kreator klik link, set password → auth provider buat user → isi `auth_uid`, `status='active'`,
   `activated_at`.
3. Setiap load halaman portal, resolusi sesi → `creator_id`:
   - Ambil user dari sesi auth.
   - Lookup `creator_users` by `auth_uid` (pakai koneksi service-role, karena RLS-nya self-only).
   - Kalau bukan kreator aktif: cek apakah dia team member → lempar ke dashboard internal;
     kalau bukan → tolak ke login.
   - Return `{ creatorUserId, creatorId, email, status }`. **`creatorId` ini dipakai memfilter SEMUA query.**

### 3.2 Dua lapis isolasi

**Lapis 1 (utama) — server:** portal membaca via client **service-role** yang selalu dipin dengan
`creator_id` dari sesi. Ini isolasi sebenarnya. Client TIDAK PERNAH mengirim `creator_id`.

**Lapis 2 (defense-in-depth) — RLS:** kalau nanti pakai JWT kreator langsung, klaim `role=creator_user`
+ `creator_id` di-inject ke token (via auth hook). Helper DB:

```sql
create function auth_creator_id() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'creator_id', '')
$$;
create function is_creator_user() returns boolean language sql stable as $$
  select coalesce((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'creator_user', false)
$$;
```

> **Kalau platform lain tidak pakai Postgres RLS:** wajib replikasi *lapis 1* dengan disiplin —
> setiap query berbatas `WHERE creator_id = <sesi>`, dan endpoint intake mengabaikan `creator_id`
> dari body. Itu titik keamanan yang tidak boleh dilewat.

### 3.3 RLS pattern (kalau pakai Postgres)

Tabel M9 baru: `enable row level security`, lalu policy self-only:
```sql
create policy comp_self_read on creator_complaints
  for select using (is_creator_user() and creator_id = auth_creator_id());
create policy comp_self_insert on creator_complaints
  for insert with check (is_creator_user() and creator_id = auth_creator_id());
```
Reply append-only:
```sql
create policy reply_no_update on complaint_replies as restrictive for update using (false);
create policy reply_no_delete on complaint_replies as restrictive for delete using (false);
```
Isolasi pada tabel *shared* pakai policy **RESTRICTIVE** yang nempel di atas policy internal
(untuk role internal `is_creator_user()=false` → klausul TRUE → tak berubah):
```sql
create policy creators_creator_selfonly on creators as restrictive for select
  using (not is_creator_user() or id = auth_creator_id());
create policy reports_creator_selfonly on creator_reports as restrictive for select
  using (not is_creator_user() or (creator_id = auth_creator_id() and status = 'final'));
```
Hard-deny total untuk principal kreator pada tabel internal/margin/kreator-lain:
```sql
-- untuk tiap tabel: team_members, brand_deals, deal_products, transactions_*, cooperating_shops, dst.
create policy <t>_deny_creator on <t> as restrictive for select using (not is_creator_user());
```

---

## 4. Views (surface data, strip yang sensitif)

**4a. Agency plan** — semua plan aktif, HANYA komisi kreator (komisi_mea/margin di-strip):
```sql
create view creator_agency_plan_v as
select dp.deal_id, dp.product_id, dp.product_name, dp.product_link as link, dp.niche,
       dp.komisi_kreator_pct as komisi_kreator,   -- sudah net dari potongan MEA
       dp.exp_date, dp.status
from deal_products dp
where dp.status = 'running' and (dp.exp_date is null or dp.exp_date > now());
-- komisi_mea_pct / ads_budget / service_fee TIDAK PERNAH di-select.
```

**4b. Performa sendiri** — baca agregat metrik (self-filtered oleh RLS metrik):
```sql
create view creator_metrics_v as
select creator_id, period, metric, value, source from platform_metrics_raw;
```

**4c. Kontribusi project sendiri** (tanpa margin):
```sql
create view creator_project_progress_v as
select pcm.project_id, pcm.creator_id, pcm.date, pcm.gmv_actual, pcm.items_sold,
       sp.name as project_name, sp.target_gmv
from project_creator_metrics pcm join special_projects sp on sp.id = pcm.project_id;
```

**4d. CPM health (dual-signal)** — untuk CM Lead/Director, BUKAN kreator. Gabung coverage report
(M2) + sinyal komplain (termasuk yang `selesai`, supaya tak bisa "dikubur" dengan cepat-cepat close).

---

## 5. Core deterministic logic (port apa adanya)

### 5.1 Window kredit report (kunci = Senin ISO week)
```
weekStart(date):
  d = UTC(date)                       # buang jam
  day = d.getUTCDay()                 # 0=Min..6=Sab
  diff = (day == 0) ? 6 : day - 1     # jarak ke Senin
  d -= diff hari
  return d as 'YYYY-MM-DD'

hasReportCredit(now, usedWeekStarts):
  return weekStart(now) NOT IN usedWeekStarts    # tak akumulatif

nextCreditDate(now): weekStart(now) + 7 hari     # untuk hint "tersedia lagi ..."
```
Guard sebenarnya = `unique(creator_id, week_start)` di DB (anti-race). Kode hanya pre-check
untuk pesan ramah.

### 5.2 Immutability komplain (mirror trigger DB)
```
IMMUTABLE = [body, creator_id, severity, category]
assertComplaintMutationAllowed(prev, next):
  changed = IMMUTABLE.filter(f => prev[f] != next[f])
  if changed not empty: throw "komplain immutable: tidak boleh ubah ..."
```
Di DB, trigger `before update` menolak perubahan 4 field itu. Yang boleh berubah hanya
`status` + `closed_at/closed_by`.

### 5.3 Agregasi CPM health (dual-signal)
```
aggregateComplaints(rows, weights={rendah:1,sedang:2,tinggi:3}):
  weightedSeverity = sum(weights[r.severity])          # SEMUA komplain, termasuk 'selesai'
  perCreator = count komplain per creator_id
  repeatCreators = jumlah creator dengan count > 1
  return { complaintCount, weightedSeverity, repeatCreators }
```
Kunci: **close tidak mengurangi bobot** — pola kelalaian CPM tetap terlihat.

### 5.4 Strip agency plan
```
CREATOR_PLAN_FIELDS = [deal_id, product_id, product_name, link, niche, komisi_kreator, exp_date, status]
FORBIDDEN = [komisi_mea, komisi_mea_pct, margin, service_fee, ads_budget, notes]
stripPlanForCreator(row): drop semua key yang ada di FORBIDDEN
```
Defensive strip di layer server, walaupun view sudah tak select field terlarang (double guard).

---

## 6. Kontrak server action / API (intake)

Semua endpoint: resolve `creatorId` dari sesi → tulis via service-role dengan `creator_id` dipin →
tulis audit. Balikan error Bahasa Indonesia yang ramah.

| Action | Input | Logic inti | Audit action |
|---|---|---|---|
| `submitComplaint` | category, severity, body | auto-resolve `target_cpm_id` = owner CPM kreator; insert status `baru` | `m9.complaint_submit` |
| `submitFeedback` | body, sentiment | insert; tak pernah negatif | `m9.feedback_submit` |
| `submitRequest` | type(sample/ads/hsl), target_brand, amount | insert `creator_requests` source=`creator_portal` → owner CPM | `m9.request_submit` |
| `requestJoinProject` | project_id | project harus `planning` (selalu boleh) atau `aktif`+`open_for_signup`; anti-duplikat | `m9.project_join` |
| `useReportCredit` | — | pre-check `hasReportCredit`; insert credit (unique = guard); return week | `m9.report_credit_use` |
| `generateSelfReport` | — | `useReportCredit()` lalu panggil pipeline report M2 (satu-satunya LLM) | (via M2) |

Sisi internal (tim) untuk komplain:
| Action | Guard | Logic | Audit |
|---|---|---|---|
| `replyToComplaint` | permission `m9.complaint_manage` + scope owner CPM | insert `complaint_replies` (append-only) | `m9.complaint_reply` |
| `updateComplaintStatus` | permission + scope | set status; `selesai` → set `closed_at/closed_by`; assert immutable | `m9.complaint_status` |

---

## 7. Config (jangan hardcode — taruh di tabel config)
```json
"m9.complaint_categories": ["cm_tidak_responsif","pembayaran_komisi","masalah_campaign","teknis_platform","lainnya"],
"m9.severity_weights":     {"rendah":1,"sedang":2,"tinggi":3},
"m9.complaint_weight":     1.0,
"m9.report_credit_window": "weekly"
```

## 8. Audit log
- Kolom `actor_label` (text) untuk principal non-team-member: `creator_user:CRT-xxxxx`.
- Tiap mutasi material kreator → 1 baris audit, `type: auto` (aksi kreator = intake, tak merugikan).

---

## 9. Urutan build di platform lain (checklist)

**Fase A — Fondasi & auth**
- [ ] Tabel `creator_users` + alur undang/aktivasi (1 kreator = 1 login).
- [ ] Resolusi sesi → `creatorId`; middleware: bounce team-member ke dashboard internal.
- [ ] Kolom `actor_label` di audit + util `creatorActor()`.

**Fase B — Isolasi (kritikal)**
- [ ] Lapis 1: semua query portal via koneksi privileged, `creator_id` dipin dari sesi; endpoint
      intake abaikan `creator_id` client.
- [ ] Lapis 2 (kalau Postgres): helper `is_creator_user()`/`auth_creator_id()` + RLS self-only +
      restrictive isolation + hard-deny tabel internal.

**Fase C — Views (strip sensitif)**
- [ ] `creator_agency_plan_v` (strip komisi_mea/margin), `creator_metrics_v`,
      `creator_project_progress_v`, `cpm_health_v` (internal only).

**Fase D — Intake + core logic**
- [ ] Tabel: complaints (+ trigger immutable), complaint_replies (append-only), feedback,
      report_credits (unique/minggu), project_join_requests.
- [ ] Port fungsi §5 (weekStart/hasReportCredit, immutability, aggregateComplaints, stripPlan).
- [ ] Server actions §6 + audit tiap mutasi.

**Fase E — UI**
- [ ] Shell portal terpisah (nav kreator), 6 halaman §1, label Bahasa Indonesia.
- [ ] Surface rules: report `final` only, project open-for-signup only, plan running & belum exp.

**Fase F — Report self-service (satu-satunya LLM)**
- [ ] Tombol improve report 1×/minggu → `useReportCredit()` → pipeline report (input = angka
      jadi, log token). Hormati kuota (no bypass).

---

## 10. Definition of done
- Type-safe; isolasi berlapis aktif; audit tertulis tiap mutasi; threshold dari config; **0 LLM**
  di jalur deterministik (hanya report self-service yang boleh, via pipeline report); kreator tak
  pernah melihat komisi_mea/margin/data kreator lain; komplain immutable & reply append-only.
</content>
</invoke>
