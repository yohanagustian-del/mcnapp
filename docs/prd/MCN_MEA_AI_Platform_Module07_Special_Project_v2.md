# PRD — Special Project v2 (MCN App, ekstensi modul M7/M9)

**Versi:** 2.1 · **Tanggal:** 16 Sep 2026 · **Owner:** Yohan Agustian
**Basis audit:** skema production Supabase `MCN MEA` — tabel, RLS, view, enum, audit_logs. Source code repo private, belum diaudit → item yang bergantung pada UI/server action ditandai `[KONFIRMASI DEV]`.

**Keputusan yang sudah dikunci (interview 16 Sep 2026):**
1. Sumber performa peserta = **upload file per project oleh tim**.
2. Kreator eksternal boleh daftar → daftar tunggu → approve tim.
3. Report peserta = angka + insight naratif AI, reuse pola `creator_reports`.
4. **Fitur report (upload → report peserta → report gabungan) dibangun PALING AWAL** supaya tim langsung bisa pakai untuk project aktif sambil sisa fitur dikerjakan.
5. Granularitas data = **per kreator per hari**; tidak boleh ada angka dobel di report mana pun.
6. Periode project ditetapkan di awal; hanya transaksi dalam periode itu yang dihitung.
7. SAP **dicoret** dari v2 (belum ada).
8. Invite akun portal dilakukan **manual oleh CPM** (tanpa Sebari).
9. Setiap peserta punya target sendiri; project punya target gabungan; **yang utama adalah target project tercapai**.
10. Project test id 4, 5, 10 boleh dihapus.
11. Sentimen feedback memakai mesin LLM yang sama dengan insight report.
12. RLS `creator_reports` untuk `creator_user` belum ada → dibuat. Server action approve/reject join request belum ada → dibuat.

---

## 1. Background

Special Project dibuat untuk menjalankan program MCN berbasis acara: bootcamp, training, event, showcase, trip. Flow yang diinginkan:

> cari kreator sesuai kebutuhan divisi → kreator daftar lewat link di Creator Portal → tim (CM/CPM/BizDev) kurasi → peserta terpilih dapat info acara di portal → target hasil per acara → tim upload data performa → report per peserta otomatis, bisa dilihat peserta → peserta isi feedback → tim lihat report gabungan otomatis.

**Kondisi saat ini (audit DB):**

| Area | Status | Bukti |
|---|---|---|
| Project + target + manpower + tambah peserta manual | Ada | `special_projects` 10 baris, `project_manpower`, audit `m7.add_participant` |
| Kebutuhan kreator per project + shortlist | Tidak ada | `matching_runs` per kreator, tidak terhubung ke project |
| Pendaftaran via portal | Skema ada, 0 pemakaian | `project_join_requests` 0 baris; semua project `open_for_signup=false`; `creator_users` = 1 dari 693 kreator |
| Kurasi | Skema ada, server action belum ada | tidak ada audit approve/reject |
| Info acara di portal | Tidak ada | — |
| Upload performa → metrik peserta | **Tidak ada** | `project_creator_metrics` 0 baris; `metric_upload_batches` tanpa `project_id` |
| Report per peserta | View ada, kosong | `creator_project_progress_v`; `creator_reports` hanya weekly/monthly |
| Feedback acara | Salah bentuk | `creator_feedback` tanpa `project_id`, tanpa rating |
| Report gabungan | Ada tapi selalu 0 | `result_summary` dihitung dari `project_daily_metrics` manual |

Masalah inti: tidak ada data performa yang mengalir ke project, sehingga rantai report tidak pernah menghasilkan angka. Karena itu **Fase 1 = mesin report**, dan tim memakai fitur "tambah peserta manual" yang sudah ada sebagai jalan masuk peserta sampai pendaftaran portal jadi.

---

## 2. Rules (aturan bisnis)

### 2.1 Project
- R1. `type` wajib enum `project_type_t`: `bootcamp | training | event | showcase | campaign | trip | other`.
- R2. Status `planning → aktif → selesai`, tambah `dibatalkan`. `selesai → aktif` hanya role `director/head` (koreksi upload terlambat), tercatat audit.
- R3. Project punya `slug` unik (link pendaftaran publik) dan `signup_deadline`.
- R4. **Target dua lapis.** `special_projects.target_gmv` = target utama yang dilaporkan. `project_participants.target_gmv` = target pribadi, **wajib diisi** saat peserta ditambahkan/di-approve (sistem menyarankan `sisa target / sisa kuota`, tim boleh ubah). Jumlah target pribadi tidak harus sama dengan target project; report gabungan selalu mengukur terhadap target project.
- R5. `project_manpower.involvement_pct` integer 0–100.
- R6. Hanya transaksi bertanggal dalam `[start_date, end_date]` yang dihitung. Baris di luar itu dibuang saat upload (dihitung di `out_of_window_count`).

### 2.2 Kebutuhan kreator & pendaftaran
- R7. Satu project punya satu set `project_creator_requirements`. Shortlist dari 4 periode terakhir `creator_period_summary` + atribut `creators`.
- R8. Pendaftaran terbuka jika `open_for_signup=true` AND `now() < signup_deadline` AND status ∈ (`planning`,`aktif`).
- R9. Kreator internal daftar via portal → `project_join_requests.source='portal'`.
- R10. Kreator eksternal daftar via `/join/{slug}` → `project_external_applicants`; belum jadi `creators` sampai di-approve.
- R11. Tim bisa mengundang dari shortlist → `project_join_requests.status='diundang'`; kreator terima/tolak di portal.
- R12. Satu kreator satu pengajuan per project.

### 2.3 Kurasi
- R13. Berhak kurasi: `team_members.role` ∈ {`director`, `head`, `spv`, `cm_lead`, `cpm`, `bizdev_lead`, `bizdev`, `campaign_ops`, `acquisition_lead`, `acquisition_spec`} ATAU terdaftar di `project_manpower` project tersebut. `od_viewer`, `finance`, `creator_support`, `ads_support`, `campaign_external`, `bd_admin` tidak berhak. (Enum `role_t` aktual di DB.)
- R14. Approve wajib membuat `project_participants` (idempotent) dengan `target_gmv` terisi (R4). Reject wajib `reason`.
- R15. Approve applicant eksternal = satu transaksi: buat `creators` (`tim_akuisisi='special_project'`), buat `project_participants`. Akun portal **tidak** otomatis dibuat — CPM undang manual (R36).
- R16. Melebihi `target_creators` → warning, bukan blokir.

### 2.4 Info acara
- R17. `project_announcements` terlihat peserta setelah `published_at <= now()`. Maksimal 3 pinned.

### 2.5 Upload performa — sumber tunggal, per kreator per hari
- R18. **`project_creator_metrics` adalah sumber kebenaran**, granularitas `(project_id, creator_id, date)`. `project_daily_metrics` = roll-up otomatis + kolom input manual biaya.
- R19. Upload selalu terikat `project_id`; satu file = satu batch `metric_upload_batches` (`project_id`, `period_start`, `period_end`, `file_hash`).
- R20. Pencocokan baris → peserta lewat `creators.username` (case-insensitive, strip `@`) atau `creators.uid`. Baris bukan peserta **tidak disimpan**, dihitung `unmatched_count` + daftar username di preview.
- R21. **Anti double-count.** Export *Creator Product* TikTok sudah memuat seluruh GMV kreator (video + live). Export *Live* memuat GMV live yang merupakan bagian dari angka itu. Maka per (kreator, hari):
  - `gmv_actual` diambil dari baris `source_type` **product** (`mcn_tiktok_product` / `tap_tiktok_product`).
  - baris **live** (`mcn_tiktok_live` / `tap_tiktok_live`) hanya mengisi `live_gmv`, `live_orders`, `live_sessions`; **tidak** ditambahkan ke `gmv_actual`.
  - jika hari itu **hanya** ada baris live, `gmv_actual = live_gmv` (sementara); saat baris product hari itu masuk, otomatis menggantikan.
  - `shopee` platform berbeda → ditambahkan ke `gmv_actual` (`gmv_shopee` dicatat terpisah).
  - Roll-up project menjumlahkan `gmv_actual` per (kreator, hari) — sehingga tidak ada angka yang terhitung dua kali di report peserta maupun gabungan.
- R22. Re-upload sumber & periode sama = **replace**: baris dari batch lama dengan `source_type` dan rentang periode sama dihapus, batch lama `status='superseded'`.
- R23. File duplikat (`file_hash` sama, project sama) ditolak.
- R24. Setelah batch berhasil: `recompute_project_daily` → `recompute_project_summary`.
- R25. Produk per kreator dari export product disimpan di `project_creator_products` (untuk "produk terlaris" di report) — hanya dalam periode project.

### 2.6 Report per peserta
- R26. Memakai `creator_reports` dengan `period_type='project'` + `project_id`. Satu report `final` per (project, creator); generate ulang → draft baru, draft lama diarsip.
- R27. Insight AI dibuat hanya dari `data_json`; tidak boleh menyebut angka di luar itu. Mesin yang sama dengan insight mingguan/bulanan, prompt varian `project`.
- R28. Peserta hanya melihat report `final` miliknya. Sebelum final, portal menampilkan angka live (progress) tanpa narasi.
- R29. Peserta `gmv_actual=0` tetap dibuatkan report (insight menyebut belum ada transaksi tercatat).
- R30. Report bisa **diunduh sebagai gambar (PNG 1080×1350) dan PDF A4** dari template §6.13 — untuk peserta maupun gabungan.

### 2.7 Feedback acara
- R31. Form `project_feedback` terbuka saat `status='selesai'` atau `feedback_open_at <= now()`, tutup `feedback_close_at` (default +14 hari).
- R32. Satu feedback per (project, creator), boleh diedit sampai tutup. Tim melihat nama (tidak anonim; ditulis di form).
- R33. `creator_feedback` lama tidak dipakai untuk acara.
- R34. `sentiment` dihitung async oleh mesin LLM yang sama (batch malam).

### 2.8 Report gabungan
- R35. `result_summary` dihitung otomatis: setelah upload, saat perubahan status, cron 06:00 WIB untuk project `aktif`. `achievement_pct = gmv_actual / target_gmv (project)`.

### 2.9 Aktivasi portal
- R36. Invite akun portal **manual oleh CPM**: tombol "Undang ke portal" per peserta membuat `creator_users` status `invited` dan menampilkan link/token invite untuk dikirim CPM lewat WA sendiri. Kolom status akun tampil di daftar peserta.

---

## 3. Flow

### 3.1 [Fase 1] Upload performa (tim)
1. Tim → project → tab **Performa** → **Upload Data**.
2. Pilih `source_type` (mcn_tiktok_product / tap_tiktok_product / mcn_tiktok_live / tap_tiktok_live / shopee) → pilih .xlsx/.csv.
3. Server parse → **Preview**: total baris, matched peserta (N) , unmatched (M + username), out-of-window (K), duplikat file (tolak), estimasi GMV masuk, peringatan kolom yang tidak ditemukan.
4. Konfirmasi → tulis batch → upsert `project_creator_metrics` + `project_creator_products` → replace batch lama (R22) → recompute.
5. Riwayat batch: file, sumber, periode, baris masuk, GMV, uploader, status, **Hapus batch** (rollback + recompute).

### 3.2 [Fase 1] Dashboard project (tim)
- Header: target project vs aktual (GMV, %), hari tersisa, peserta aktif (gmv>0)/total, live contribution.
- Chart harian kumulatif vs `daily_target_curve`.
- Leaderboard peserta: rank, nama, GMV, % target pribadi, live share, items, hari aktif.
- Panel biaya: ads spend (`project_ads_spend_v` + manual), commission, MEA revenue, margin.
- Panel feedback (Fase 3).
- **Generate Report Peserta (semua / terpilih)**, **Unduh Report Gabungan** (PNG/PDF), **Export xlsx**.

### 3.3 [Fase 1] Report per peserta
1. Generate → bangun `data_json` (§6.8) → insight AI → `creator_reports` draft (`token_used`).
2. Tim edit `insight_final` → **Finalkan**.
3. Tim bisa **unduh PNG/PDF** report peserta dan mengirimnya manual (WA) — ini jalur sementara sebelum portal peserta jadi (Fase 3).

### 3.4 [Fase 2] Kebutuhan kreator → shortlist → undang / buka pendaftaran
1. Tab **Kebutuhan Kreator**: niche (multi), platform, min level, follower tier, min GMV 30 hari, wajib live roster, catatan.
2. **Cari Kreator** → shortlist berskor → pilih → **Undang** (bulk).
3. Toggle **Buka Pendaftaran** → link publik `/join/{slug}` + copy.

### 3.5 [Fase 2] Pendaftaran internal (portal) & eksternal (link publik)
- Portal → **Project Terbuka** → Daftar → `project_join_requests` (`diajukan`). Undangan → Terima/Tolak.
- `/join/{slug}` tanpa login: nama, username, platform, WA, followers, niche, jawaban `join_requirements`, persetujuan dihubungi → `project_external_applicants` pending. Rate limit 5/menit/IP, cek username duplikat per project.

### 3.6 [Fase 2] Kurasi
- Tab **Pendaftar**: sub-tab Internal / Eksternal, filter status, data kreator.
- **Terima** → wajib isi `target_gmv` peserta (saran otomatis) → insert `project_participants` (eksternal: R15). **Tolak** → alasan.
- Counter diterima/target_creators; warning jika lebih.

### 3.7 [Fase 3] Portal peserta
- **Project Saya** → project → tab **Info** (pengumuman, pinned, badge belum dibaca), **Progress & Report** (angka live; narasi + unduh jika final), **Feedback** (form R31).
- **Undangan** (jika ada).

### 3.8 [Fase 3] Feedback
- Banner saat `selesai` → form: rating keseluruhan / materi / mentor / penyelenggaraan (1–5), NPS (0–10), bagian paling bermanfaat, yang perlu diperbaiki, mau ikut lagi (ya/tidak).
- Agregat masuk dashboard & report gabungan.

### 3.9 [Fase 4] Aktivasi portal
- Kolom "Akun portal" di daftar peserta; tombol **Undang ke portal** → link invite untuk dikirim CPM.

---

## 4. Example — "Bootcamp Beauty & Personal Care" (id 9)

Data nyata: type Bootcamp, 1–30 Sep 2026, target_gmv 25.000.000, target_creators 30, aktif, kurva `ramp`, 0 peserta, 0 metrik.

**Pakai Fase 1 saja (tanpa portal).** CPM menambah 28 peserta lewat "tambah peserta" yang sudah ada, mengisi target pribadi masing-masing (saran 833.333; 3 kreator Elite diset 2.500.000). 8 Sep upload `CustomReport_Creator_Product_... 2026-09-01_2026-09-07.xlsx` (product): 412 baris → matched 27, unmatched 9 (bukan peserta), out-of-window 0, GMV masuk 6.140.000 → 189 baris metrik + 340 baris produk. Dashboard: 24,6% target. 9 Sep upload export Live periode sama: 61 baris → hanya mengisi `live_gmv` 27 kreator; `gmv_actual` tidak berubah (R21). 15 Sep re-upload product karena TikTok merevisi → batch lama superseded.

**Report.** 1 Okt → selesai → Generate semua → 28 draft. @glowbyrara: gmv 2.310.000, target pribadi 833.333 (277%), rank 3/28, live share 41% vs rata cohort 18%, produk terlaris "Serum X" 1.100.000 (dari `project_creator_products`). CM edit 2 kalimat → final → unduh PNG → kirim WA. Report gabungan: 23.800.000 (95,2% target project), 25 aktif, live contribution 33%, ads spend 1.200.000 dari `ads_briefs` project 9.

**Fase 2–3 nanti** menambah pendaftaran, kurasi, portal, feedback di atas data yang sama — tanpa migrasi ulang.

---

## 5. Urutan build (report didahulukan)

| Fase | Scope | Tim bisa pakai untuk apa setelah fase ini | Estimasi* |
|---|---|---|---|
| **0** | Hardening: enum type, involvement int, slug/deadline, hapus id 4/5/10 (backup json dulu), kolom baru batch/metrik/produk, fungsi recompute, target peserta wajib | — | 2 hari |
| **1** | **Upload performa + dashboard + report peserta & gabungan + template PNG/PDF** (§3.1–3.3, §6.7–6.9, §6.13) | Menjalankan project aktif (id 7, 8, 9) end-to-end dari sisi tim: tambah peserta manual → upload → report | 7 hari |
| **2** | Kebutuhan kreator, shortlist, link publik, kurasi (§3.4–3.6) | Rekrut peserta lewat link & undangan, bukan manual | 5 hari |
| **3** | Portal peserta: info, report, feedback (§3.7–3.8) | Peserta lihat sendiri; feedback masuk report gabungan | 5 hari |
| **4** | Aktivasi portal manual CPM (§3.9) | Peserta bisa login | 1 hari |

*Dev-day kasar, belum melihat kode. Fase 1 dulu sesuai keputusan #4.

Prasyarat Fase 1 yang bukan kerja dev: **satu sampel tiap export** (product MCN, product TAP, live MCN, live TAP, Shopee) untuk mengunci header parser.

---

## 6. System Requirements

### 6.1 `special_projects`
```sql
create type project_type_t as enum ('bootcamp','training','event','showcase','campaign','trip','other');
alter table special_projects
  add column type_new project_type_t,
  add column slug text unique,
  add column description text,
  add column signup_deadline timestamptz,
  add column feedback_open_at timestamptz,
  add column feedback_close_at timestamptz,
  add column summary_computed_at timestamptz;
-- mapping type lama (lower/trim): bootcamp→bootcamp; 'china trip','china'→trip;
-- 'showcase','showcase testing'→showcase; live_event→event; flash_sale,campaign→campaign; lain→other
-- lalu drop type, rename type_new→type, set not null
alter type project_status_t add value 'dibatalkan';
```
Hapus id 4, 5, 10 + child rows (`project_participants`, `project_manpower`, `project_daily_metrics`) setelah dump ke `audit_logs` action `m7.project_purge`.

### 6.2 `project_manpower`
`involvement` → `involvement_pct smallint check (0..100)` (strip `%`, cast). `role` → enum `manpower_role_t (pic, project_manager, cm, cpm, akuisisi, bizdev, support, other)`.

### 6.3 `project_participants`
`target_gmv` → **not null** (backfill baris lama dengan `target_gmv_project / target_creators`, atau 0 jika target_creators null). Tambah `added_via text check (manual, portal, invite, external) default 'manual'`, `portal_invited_at timestamptz`.

### 6.4 `project_creator_requirements` (baru, Fase 2)
| Kolom | Tipe |
|---|---|
| project_id | bigint PK FK |
| niches | text[] |
| platform | text (tiktok/shopee/all) |
| min_level | smallint |
| follower_tiers | text[] |
| min_gmv_30d | numeric |
| require_live_roster | boolean default false |
| quota | integer (default = target_creators) |
| notes, updated_by, updated_at | |

`project_shortlist(project_id)` → (creator_id, name, niche, level, gmv_30d, live_share, owner_cpm_id, score). Bobot skor di `app_config` `m7.shortlist_weights` default {gmv:0.4, niche:0.25, level:0.2, live:0.15}. Exclude yang sudah peserta/pending.

### 6.5 `project_join_requests` (ubah, Fase 2)
`status` → `diajukan | diundang | diterima | ditolak | waitlist | dibatalkan`; tambah `source text check (portal, invite) default 'portal'`, `reason text`, `note text`, `score numeric`. RLS: creator_user boleh update barisnya sendiri hanya `diundang → diterima/ditolak`.

Server actions baru (belum ada): `approveJoinRequest(id, target_gmv)`, `rejectJoinRequest(id, reason)`, `inviteCreators(project_id, creator_ids[])`.

### 6.6 `project_external_applicants` (baru, Fase 2)
`id, project_id FK cascade, full_name, username, platform, phone, followers bigint, niche, answers_json jsonb, consent_contact bool not null, ip_hash, user_agent, status check (pending, approved, rejected) default pending, reviewed_by FK team_members, reviewed_at, review_note, created_creator_id FK creators, created_at`. Unique `(project_id, lower(username), platform)`. Endpoint `POST /api/join/{slug}` service role, tanpa RLS anon.

### 6.7 Upload performa (Fase 1)
**`metric_upload_batches`** tambah: `project_id bigint FK` (nullable untuk batch lama), `period_start date`, `period_end date`, `file_hash text`, `status text check (processed, superseded, failed, rolled_back) default processed`, `matched_count int`, `unmatched_count int`, `out_of_window_count int`, `unmatched_usernames jsonb`, `missing_columns jsonb`, `error text`. Unique partial `(project_id, file_hash) where project_id is not null`. Hapus `'sap'` dari CHECK `source_type`.

**`project_creator_metrics`** — PK tetap `(project_id, creator_id, date)` (satu baris per kreator per hari). Tambah:
`gmv_product numeric` (dari export product), `gmv_live_report numeric` (dari export live), `gmv_shopee numeric`, `gmv_actual numeric generated always as (coalesce(gmv_product, gmv_live_report, 0) + coalesce(gmv_shopee,0)) stored`, `live_gmv numeric` (= gmv_live_report jika ada, else live split dari product export jika kolomnya ada), `video_gmv numeric`, `orders int`, `live_orders int`, `live_sessions int`, `batch_product_id text`, `batch_live_id text`, `batch_shopee_id text` (FK batches), `updated_at`. `items_sold` tetap.
Upsert per source hanya menyentuh kolomnya sendiri → R21 terpenuhi secara struktural.

**`project_creator_products`** (baru): `project_id, creator_id, product_id text, product_name text, shop_name text, gmv numeric, items int, batch_id text FK`, PK `(project_id, creator_id, product_id)`, replace per batch.

**Parser** — alias header ID/EN, laporkan `missing_columns`:

| source_type | username | tanggal | gmv | orders/items | produk | catatan |
|---|---|---|---|---|---|---|
| mcn_tiktok_product / tap_tiktok_product | Creator username | kolom tanggal jika ada; jika file hanya periode → **tolak dengan pesan minta export harian** `[A2]` | GMV → `gmv_product` | Items sold, Orders | Product ID, Product name, Shop name | Video GMV/Live GMV jika ada → `video_gmv`/`live_gmv` |
| mcn_tiktok_live / tap_tiktok_live | Host username | tanggal live | Live GMV → `gmv_live_report` | Live orders, sesi | — | **sampel belum diterima** |
| shopee | Username afiliasi | tanggal pesanan | GMV → `gmv_shopee` | Orders | Nama produk | `[A3]` |

**Fungsi**: `recompute_project_daily(p)` (agregat `gmv_actual`, `live_gmv`, `items`, `orders` → `project_daily_metrics`; pertahankan `ads_spend_manual`, `creator_commission`, `mea_revenue`; `ads_spend = manual + project_ads_spend_v`), `recompute_project_summary(p)`, `rollback_batch(b)`. Cron 06:00 WIB untuk project `aktif`.
`project_daily_metrics` tambah `gmv_live, items, orders, ads_spend_manual, active_creators`.

### 6.8 Report peserta — `creator_reports` (Fase 1)
```sql
alter type report_period_t add value 'project';
alter table creator_reports add column project_id bigint references special_projects(id);
create unique index on creator_reports(project_id, creator_id) where project_id is not null and status='final';
-- RLS baru (belum ada):
create policy cr_creator_self_final on creator_reports for select
  using (is_creator_user() and creator_id = auth_creator_id() and status = 'final');
```
`data_json`:
```json
{
  "period": {"type":"project","start":"2026-09-01","end":"2026-09-30","project_id":9,
             "project_name":"Bootcamp Beauty & Personal Care","project_type":"bootcamp"},
  "creator": {"id":"CRT-...","name":"glowbyrara","level":3,"niche":"Beauty"},
  "target": {"personal_gmv":833333,"project_gmv":25000000},
  "metrics": {"gmv":2310000,"live_gmv":947000,"video_gmv":1363000,"orders":41,"items":52,
              "aov":56341,"live_share":0.41,"active_days":19},
  "achievement": {"personal_pct":2.77,"share_of_project":0.097,"rank":3,"of":28},
  "cohort_avg": {"gmv":767000,"live_share":0.18,"active_days":11},
  "daily": [{"date":"2026-09-01","gmv":0}],
  "top_products": [{"name":"Serum X","gmv":1100000,"items":22}]
}
```
Prompt insight varian `project` (3 paragraf): pencapaian vs target pribadi & cohort, apa yang bekerja (live/video/produk), 1–2 saran konkret; larangan angka di luar `data_json`. `token_baseline.report_type='project'`.

### 6.9 `result_summary` (dihitung otomatis)
```json
{"computed_at":"...","target_gmv":25000000,"gmv_actual":23800000,"achievement_pct":0.952,
 "live_gmv":7850000,"live_contribution":0.33,"orders":412,"items":530,
 "participants_total":28,"participants_active":25,"sum_personal_targets":27500000,
 "ads_spend":1200000,"creator_commission":0,"mea_revenue":0,"margin":0,
 "top_creators":[{"creator_id":"...","name":"...","gmv":2310000,"personal_pct":2.77}],
 "top_products":[{"name":"Serum X","gmv":3400000}],
 "feedback":{"responses":22,"avg_overall":4.4,"avg_materi":4.5,"avg_mentor":4.6,"avg_organisasi":3.9,
             "nps":58,"would_join_again_pct":0.86},
 "last_batch_at":"..."}
```

### 6.10 `project_announcements` + `project_announcement_reads` (Fase 3)
`project_announcements(id, project_id FK, title, body_md, attachments jsonb, pinned bool, published_at, created_by, created_at, updated_at)`; RLS select creator_user: peserta project & `published_at <= now()`. `project_announcement_reads(announcement_id, creator_id, read_at)`.

### 6.11 `project_feedback` (Fase 3)
`id, project_id, creator_id (UNIQUE bersama), rating_overall/rating_materi/rating_mentor/rating_organisasi smallint 1..5, nps smallint 0..10, would_join_again bool, best_part text, improvement text, sentiment check (positif, netral, negatif) null, created_at, updated_at`. RLS: creator_user insert/update jika peserta & dalam jendela R31; select self. Tim select semua.

### 6.12 Audit actions baru
`m7.project_purge, m7.metrics_upload, m7.metrics_rollback, m7.summary_recompute, m7.report_generate, m7.report_finalize, m7.report_download, m7.requirements_set, m7.invite, m7.join_approve, m7.join_reject, m7.external_apply, m7.external_approve, m7.external_reject, m7.announcement_publish, m7.feedback_submit, m7.portal_invite`.

### 6.13 Template output report (PNG & PDF) — Fase 1
Render server-side dari HTML (Puppeteer/`@vercel/og`) memakai palet & tipografi **MEA Report Designer** (referensi skill `mea-client-reporting`); satu komponen React dipakai untuk layar, PNG, dan PDF. Label "MCN MEA · Special Project" + nama project + periode di header setiap output.

**A. Report Peserta — PNG 1080×1350 (untuk dibagikan di WA/IG)**
1. Header: logo MCN MEA, nama project, tipe, periode.
2. Identitas: nama/username kreator, niche, level, foto/avatar (jika ada `profile_link`).
3. Angka hero: **GMV project** besar, di bawahnya "X% dari target pribadi Rp Y".
4. Baris 4 kartu kecil: Orders · Items · Live share · Hari aktif.
5. Sparkline GMV harian sepanjang periode.
6. Peringkat: "#3 dari 28 peserta" + badge (Top 10% / Top 25% / Peserta).
7. Produk terlaris (maks 3).
8. Kotak insight: 3 paragraf pendek dari `insight_final`.
9. Footer: tanggal terbit, "Data: upload tim MCN MEA", hashtag program.

**B. Report Peserta — PDF A4 (1 halaman)**: sama seperti A dengan tambahan tabel harian ringkas (tanggal, GMV, orders) dan perbandingan cohort (GMV, live share, hari aktif — peserta vs rata-rata).

**C. Report Gabungan — PDF A4 (2–3 halaman)**
Hal 1: header project, manpower/PIC, ringkasan eksekutif (target vs aktual besar, achievement %, peserta aktif/total, live contribution, margin), chart kumulatif vs kurva target.
Hal 2: leaderboard 10 besar (nama, GMV, % target pribadi, live share), distribusi pencapaian peserta (≥100% / 50–99% / <50% / 0), produk terlaris project (5), biaya (ads, commission, revenue, margin).
Hal 3 (jika ada feedback): rating rata-rata per aspek, NPS, distribusi sentimen, 5 kutipan komentar terpilih (tim pilih sebelum render), catatan penutup PIC (input manual).

**D. Report Gabungan — PNG 1080×1350**: versi ringkas hal 1 + top 5 peserta, untuk konten @meaaffiliatepartner (tanpa angka biaya/margin).

Semua unduhan tercatat `m7.report_download`.

---

## 7. Open Assumptions (tersisa)

| # | Asumsi | Status |
|---|---|---|
| A2 | Header aktual export TikTok product (MCN & TAP) dan live (MCN & TAP). Export product harus per hari — jika TikTok hanya memberi rekap periode, opsi: tolak (default) atau bagi rata per hari (butuh keputusan Yohan). | **Butuh 4 sampel file**; sampel live belum terkirim |
| A3 | Header export Shopee afiliasi. | Butuh 1 sampel |
| A6 | Palet warna & font pasti untuk template — mengikuti MEA Report Designer; konfirmasi hex jika ada brand guideline final. | Ringan |
| A13 | Server-side render PNG/PDF di Vercel: Puppeteer (ukuran bundle) vs `@vercel/og` (hanya PNG). Usulan: `@vercel/og` untuk PNG, `react-pdf` untuk PDF. | Dev |
| A14 | Kolom Live GMV/Video GMV di export product ada atau tidak — menentukan apakah `live_share` bisa dihitung tanpa export live. | Dari sampel A2 |

Terselesaikan dari v2.0: A1 (aturan R21), A4 (produk diambil dari upload sendiri), A5 (RLS dibuat), A7 (mesin sama), A8 (manual CPM), A9 (enum role_t), A10 (dibuat), A11 (hapus), A12 (R4), SAP dicoret.

---

## 8. Success Metrics

| Metrik | Definisi | Target |
|---|---|---|
| Report gabungan hidup | % project `selesai` dengan `gmv_actual > 0` | 100% (saat ini 0%) |
| Fase 1 dipakai | Project aktif (7/8/9) punya ≥1 batch upload dalam 7 hari setelah rilis Fase 1 | 3 dari 3 |
| Upload → angka | Konfirmasi upload sampai dashboard berubah | < 2 menit |
| Cakupan peserta | % peserta dengan ≥1 baris metrik di akhir project | ≥ 85% |
| Report terbit | % peserta punya report `final` ≤ 5 hari kerja setelah project selesai | ≥ 90% |
| Report dibaca | % peserta buka tab Report ≤ 7 hari setelah final (Fase 3) | ≥ 70% |
| Feedback | % peserta mengisi (Fase 3) | ≥ 50% |
| Aktivasi portal | % peserta `creator_users.status='active'` (Fase 4) | ≥ 90% |
| Beban tim | Jam manual per project untuk bikin report (survei PIC) | turun ≥ 70% |

Activation event: **batch upload pertama yang mengubah `result_summary` dari 0 menjadi angka nyata** pada project aktif.

---

## 9. Addendum 16 Sep 2026 — format export LIVE Center per sesi (dari sampel)

Sampel yang diterima bukan daftar kreator per periode, melainkan **export LIVE Center per sesi per kreator**, dua file per sesi:

| File | Baris | Kolom kunci (header EN persis) |
|---|---|---|
| `{username}_product_Sesi_{n}__{d}_{Bulan}_{yyyy}.xlsx` | 1 baris per produk di etalase live | Product ID, Product name, Attributed GMV, Attributed items sold, Customers, AOV, Attributed SKU orders, Attributed orders, Payment Rate, Product Impressions, CTR, Added to cart, CTOR (SKU orders), CTOR, Watch GPM, Product Clicks, Available stock |
| `{username}_trend_stats_Sesi_{n}__{d}_{Bulan}_{yyyy}.xlsx` | 1 baris per interval 30 menit | Time, Attributed GMV, Attributed items sold, Customers, Attributed SKU orders, Attributed orders, Viewers, Views, Product Impressions, LIVE CTR, Tap-through rate, Product Clicks, Impressions, New followers, Shares, Comments, Likes, Comment rate, Follow rate, Like rate, Share rate, AOV, CTOR (SKU orders), Watch GPM, CTOR, Payment Rate, Show GPM, Order rate (SKU orders) |

Temuan: **username, nomor sesi, dan tanggal hanya ada di nama file** (penulisan tidak konsisten: `product`/`Product`, `trend_stats`/`Trend_Stat`, `Sesi`/`sesi`). Total GMV Trend Stats bisa berbeda tipis dari Product (sampel haikal: selisih Rp4.040).

### Perubahan spesifikasi
- **`source_type` baru: `tiktok_live_session`.** Upload menerima banyak file sekaligus; sistem memasangkan product+trend per (username, sesi, tanggal) dari nama file (regex case-insensitive), lalu menampilkan **form konfirmasi per sesi** (username → peserta, tanggal, sesi, brand/shop) yang bisa dikoreksi tim sebelum simpan. Bila nama file tidak terbaca, tim isi manual.
- **Tabel baru `project_live_sessions`**: `id, project_id, creator_id, session_date, session_no, brand text, start_time, end_time, duration_min, gmv (dari file Product), gmv_trend, orders, items, customers, views, viewers_peak, impressions_live, product_impressions, product_clicks, add_to_cart, new_followers, shares, comments, likes, ctr, ctor, aov, gpm, batch_id, unique(project_id, creator_id, session_date, session_no)`.
- **Tabel baru `project_live_intervals`**: `session_id FK, time, gmv, orders, items, views, viewers, product_impressions, product_clicks, likes, comments, shares, new_followers` — untuk chart alur sesi di report.
- `project_creator_products` diisi dari file Product (per sesi, `session_id` ditambahkan).
- Roll-up ke `project_creator_metrics`: `gmv_live_report(creator, date) = Σ gmv sesi pada tanggal itu`; `live_sessions = count`. Aturan R21 tetap: jika ada export product harian dari Affiliate/Seller Center untuk tanggal itu, `gmv_actual` mengikuti export product; jika tidak (kasus showcase live murni), `gmv_actual = gmv_live_report`.
- **Sumber GMV sesi = file Product**; file Trend Stats hanya untuk timeline & metrik penonton. Selisih keduanya dicatat di `project_live_sessions.gmv_trend` dan ditampilkan sebagai catatan data di report.
- Report peserta untuk project bertipe live menambah blok **alur sesi** (GMV per 30 menit vs viewers), **funnel** (impresi live → views → impresi produk → klik → keranjang → order), dan **efisiensi** (CTR, CTOR, AOV, GMV/1.000 views, follower baru, komentar, likes, share). Sample: `Sample_Report_Live_Special_Project.html`.
- Asumsi A2/A14 tetap terbuka untuk export **Affiliate/Seller Center per hari** (belum ada sampel). Untuk project live-only, Fase 1 bisa jalan hanya dengan `tiktok_live_session`.

---

## 10. Addendum 16 Sep 2026 — multi-sesi per hari & verifikasi kreator pada upload

### 10.1 Aturan
- R37. Satu kreator boleh live **beberapa sesi dalam satu hari**; setiap sesi disimpan terpisah (`project_live_sessions`, unique `(project_id, creator_id, session_date, session_no)`). Tidak ada penggabungan di level penyimpanan.
- R38. Agregat harian dihitung, bukan disimpan manual: `gmv_live_report(creator, date) = Σ gmv sesi` (roll-up ke `project_creator_metrics`, R21). Report menampilkan **per sesi** dan **gabungan 1 hari**.
- R39. Dua sesi kreator yang sama pada hari yang sama **tidak boleh saling tumpang tindih waktu** (interval Trend Stats). Tumpang tindih → upload ditolak dengan pesan: kemungkinan file milik kreator lain atau sesi duplikat.
- R40. **Upload selalu berkonteks kreator.** Tim memilih peserta dulu; file yang diupload diverifikasi terhadap peserta itu. Tidak ada mode "upload massal tanpa kreator" untuk `tiktok_live_session`.
- R41. Setiap sesi punya `attribution_status`: `verified` (semua cek lolos), `confirmed_manual` (ada cek yang tidak lolos, tim mengonfirmasi dengan alasan), `disputed` (kreator menyanggah di portal), `voided` (dibatalkan tim). Hanya `verified` dan `confirmed_manual` yang ikut roll-up dan report.
- R42. Username TikTok bisa berubah. Sistem menyimpan alias per kreator (`creator_username_aliases`); pencocokan nama file memakai username aktif + alias.

### 10.2 Flow upload berkonteks kreator (menggantikan §3.1 langkah 2–4 untuk `tiktok_live_session`)
1. Tim → project → tab **Performa** → **Upload sesi live** → **pilih peserta** (search nama/username; kartu peserta: avatar, username aktif, alias, level, CPM pemilik, sesi yang sudah tercatat).
2. Drop file (bisa banyak: beberapa sesi, beberapa hari) — semua untuk peserta yang dipilih.
3. Sistem memasangkan Product+Trend per (sesi, tanggal) dari nama file dan menjalankan **cek verifikasi** per sesi (identitas kreator hanya diverifikasi dari username, waktu, dan hash file — bukan dari isi produk):

| Cek | Sumber | Hasil gagal |
|---|---|---|
| V1 Username di nama file = username aktif/alias peserta terpilih | regex nama file vs `creators.username` + `creator_username_aliases` | **Blokir** — tampilkan "file ini bernama @X, peserta yang dipilih @Y". Tombol: *Ganti peserta ke @X* (jika @X peserta project) / *Tambahkan @X sebagai alias @Y* (butuh alasan, role cm_lead ke atas) |
| V2 Tanggal sesi di dalam periode project | nama file vs `start_date..end_date` | Blokir (R6) |
| V3 Tidak tumpang tindih dengan sesi lain kreator ini di hari yang sama | interval Trend Stats | Blokir (R39) |
| V4 File hash belum pernah masuk (project mana pun) | `file_hash` | Blokir; tampilkan sesi/kreator yang sudah memakai file itu |
| V5 Product dan Trend berpasangan (sesi & tanggal sama) | nama file | Peringatan; boleh simpan Product saja (tanpa timeline) |
| V6 Selisih GMV Product vs Trend ≤ 2% | isi file | Peringatan; dicatat di `gmv_trend` |
| V7 Nomor sesi belum ada untuk (kreator, tanggal) | `session_no` | Blokir; tawarkan *Ganti (replace)* dengan konfirmasi |

Catatan: konsistensi brand/produk antar sesi **bukan** sinyal salah kreator — kreator lazim mematikan live dan mulai lagi untuk mencoba produk lain — sehingga tidak dijadikan cek. Brand per sesi hanya ditampilkan sebagai informasi di kartu konfirmasi dan report.

4. **Layar konfirmasi** per sesi: kartu peserta terpilih + ringkasan sesi (tanggal, sesi ke-, jam mulai–selesai, GMV, order, brand terdeteksi) + daftar hasil cek (hijau/kuning/merah). Sesi dengan cek merah tidak bisa disimpan sampai diperbaiki. Sesi dengan kuning (V5/V6) butuh centang "Saya sudah cek, data ini milik peserta ini" + alasan → `confirmed_manual`.
5. Simpan → `project_live_sessions` + `project_live_intervals` + `project_creator_products` → roll-up → recompute. Audit `m7.live_session_upload` menyimpan `uploader_id, creator_id, session_id, checks_json, override_reason`.
6. Riwayat upload per peserta tampil di kartu peserta; tombol **Batalkan sesi** → `voided` + recompute.

### 10.3 Sanggahan dari kreator (portal)
- Di **Progress & Report**, setiap sesi menampilkan tanggal, jam, sesi ke-, GMV, brand. Tombol **"Ini bukan data saya"** → `attribution_status='disputed'`, wajib alasan singkat → sesi dikeluarkan dari roll-up sementara → notifikasi ke CPM pemilik + uploader.
- Tim menyelesaikan di tab Performa: **Pindahkan ke peserta lain** (jalankan ulang V1–V7 untuk peserta tujuan) atau **Tolak sanggahan** (kembali `verified`, alasan dicatat). Audit `m7.live_session_dispute`, `m7.live_session_reassign`.

### 10.4 Perubahan skema
- `project_live_sessions` tambah: `attribution_status text check (verified, confirmed_manual, disputed, voided) default 'verified'`, `attribution_note text`, `confirmed_by uuid`, `confirmed_at timestamptz`, `checks_json jsonb`, `filename_product text`, `filename_trend text`, `uploaded_by uuid`, `disputed_at timestamptz`, `dispute_reason text`. Index `(project_id, creator_id, session_date)`.
- **`creator_username_aliases`** (baru): `creator_id text FK creators, username text, platform text default 'tiktok', valid_from date, valid_to date, added_by uuid, reason text, unique(platform, lower(username))`. Satu username tidak boleh jadi alias dua kreator.
- `project_creator_metrics.live_sessions` = jumlah sesi berstatus `verified/confirmed_manual` pada tanggal itu.
- View **`project_creator_daily_live_v`**: `(project_id, creator_id, session_date, sessions int, gmv, orders, items, customers, duration_min, views, viewers_peak, product_impressions, product_clicks, add_to_cart, new_followers, comments, likes, shares, best_session_no, best_session_gmv)` — sumber blok "gabungan 1 hari" di report.
- Roll-up dan `result_summary` hanya menghitung sesi `verified` dan `confirmed_manual`.

### 10.5 Struktur report peserta (project bertipe live) — tiga lapis
1. **Lapis project**: GMV total periode vs target pribadi, jumlah hari live, jumlah sesi, rata-rata GMV per sesi, tren GMV per hari (bar), rank di project.
2. **Lapis hari** (satu kartu per tanggal, urut terbaru): GMV hari, jumlah sesi & durasi total, order/item, funnel gabungan hari, **perbandingan antar sesi hari itu** (bar GMV per sesi + tabel: sesi, jam, durasi, GMV, order, CTR, AOV), sesi terbaik ditandai.
3. **Lapis sesi** (tab Sesi 1 / Sesi 2 / … di dalam kartu hari): tampilan seperti sample — alur 30 menit, funnel, efisiensi, produk terlaris, catatan performa. Badge status atribusi (`Terverifikasi` / `Dikonfirmasi tim`) dan tombol sanggah.
Insight AI dibuat di lapis hari (membandingkan sesi dalam hari) dan lapis project (tren antar hari); lapis sesi memakai catatan rule-based agar hemat token.

Report gabungan project menambah: jumlah sesi total, sesi per peserta, jam live terbaik lintas peserta (agregat interval), dan daftar sesi berstatus `disputed` yang belum selesai.

### 10.6 Estimasi tambahan
Verifikasi V1–V7 + layar konfirmasi + alias: +2 hari. Sanggahan portal + reassign: +1 hari (Fase 3). Report tiga lapis: +1,5 hari di Fase 1. Total Fase 1 menjadi ±9 hari.
