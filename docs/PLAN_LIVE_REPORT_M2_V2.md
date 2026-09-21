# Rencana Eksekusi — Report Live Stream dari Jadwal Live + Report Kreator (M2) v2

> Disetujui user 2026-09-21. Sumber kebenaran status implementasi = HANDOFF.md; file ini = rencana yang disepakati.

## Context (hasil audit)

Audit repo `yohanagustian-del/mcnapp` (branch `claude/mcn-report-quality-evk1tu`) + data produksi Supabase `bqknstylbpwsnlgnzayw` (read-only). Baseline: typecheck 0 error, 942 tes lulus.

### Yang sudah berjalan
| Area | Fakta |
|---|---|
| Jadwal Live (M13, `/schedule`) | `live_schedule_slots` 163 slot (69 sudah diverifikasi `done`), 32 kreator di roster. Fitur: buat/edit slot, verifikasi jam aktual, "Tidak Jadi Live", copy minggu, roster, notifikasi PIC TAP. **Tidak ada hubungan apa pun ke data performa live.** |
| Special Project (M7 v2, `/projects/13`) | Upload sesi live TikTok LIVE Center (file Product + Trend Stats) → `project_live_sessions` (25 sesi), `project_live_intervals`, `project_live_session_products` (1.330 baris). Verifikasi V1–V7 (`lib/m7/live-verify.ts`), parser (`live-parse.ts`, `live-filename.ts`), report peserta (`lib/m7/report-data.ts` → `components/project-report-view.tsx`), catatan deterministik (`live-notes.ts`), refresh otomatis (`report-refresh.ts`). Tabel **mewajibkan `project_id`** dan V2 mengikat tanggal ke periode project — tidak bisa dipakai untuk jadwal live rutin. |
| Report Kreator (M2, `/reports`) | 19 weekly + 4 monthly report. Sumber: `creator_period_summary` (2.801 baris mingguan sejak Juli 2026), `creator_top_products` (55.891 baris, hanya `gmv` & `orders` per produk), `creator_subcat_segment_gmv`. Output `reports/[id]/page.tsx` = satu tabel metrik + daftar sub-kategori + insight LLM. **Dangkal** karena data per produk (live/video/CTR/CTOR/items) dibuang saat ingest, dan sesi live sama sekali tidak dibaca. |

### Bug/kelemahan yang ditemukan (diperbaiki dalam rencana ini)
1. **Monthly report hanya menghitung satu minggu.** `generateReport` mengambil `latestByCreatedAt(currentSummaryRows)` = SATU baris `creator_period_summary` untuk seluruh bulan, padahal bulan berisi 4–5 baris mingguan. Harus: baris terbaru per `period_start`, lalu dijumlahkan.
2. **Benchmark peer selalu null.** Dihitung dari `platform_metrics_raw` yang di produksi **0 baris** (drop-raw sejak Module 0.5). Harus dipindah ke `creator_period_summary`.
3. `gmv_by_source` selalu kosong di jalur agregat (tidak ada dimensi source) — bagian "Sumber GMV" di report selalu "—". Diganti pecahan Live/Video/Direct yang memang tersedia.
4. Creator Portal `/portal/reports` hanya MENDAFTAR report weekly/monthly final tanpa bisa dibuka (tidak ada renderer) — report yang "dikirim ke creator" tidak pernah bisa dibaca kreator.
5. `creator_top_products` membuang `affiliate_live_gmv`, `affiliate_video_gmv`, `items_sold`, `ctr`, `ctor`, `direct_gmv`, `shop_name`, `level1_category` yang sudah ada di `McnRow` — report "produk terbaik untuk live vs video" mustahil tanpa itu.
6. Ledger migrasi remote drift (sudah tercatat di HANDOFF): apply hanya boleh lewat `apply_migration`, bukan `db push`.

## Keputusan desain

- **Satu engine sesi live untuk dua pemilik** (CLAUDE.md #4). `project_live_sessions.project_id` jadi nullable + kolom baru `schedule_slot_id` (CHECK tepat satu terisi — pola yang sama dengan tracking report campaign `deal_id XOR project_id`). Parser, V1–V7, penyimpanan, catatan deterministik, dan komponen report **dipakai apa adanya**; yang berbeda hanya konteks pemilik (parameter, bukan salinan kode).
- **Opsional per slot**: report live hanya dibuat kalau tim mengunggah file untuk slot itu. Tidak ada kewajiban.
- **V2 untuk slot** = tanggal slot ±1 hari (live yang mulai menjelang tengah malam diekspor TikTok dengan tanggal berikutnya). V3/V7 untuk slot memakai SEMUA sesi kreator (pemilik mana pun) — kreator tidak bisa live dua kali pada jam yang sama. V4 (hash file) tetap lintas semua pemilik: satu file = satu live; pesan menyebut project atau slot yang memegangnya.
- **Report M2 v2 = 100% rule-based, TANPA LLM** (keputusan user saat review plan). Semua angka, insight box, badge, dan rekomendasi dihasilkan dari aturan deterministik (`lib/report/rules.ts`) + benchmark/aturan di `app_config` (`m2.live_benchmarks`, `m2.report_rules`). `token_used` selalu 0; gate 15% dan ratchet token tidak lagi relevan untuk v2 (kode ratchet dibiarkan untuk report lama). Sumber: `creator_period_summary` (dijumlah per minggu), `creator_top_products` (kolom baru), `creator_subcat_segment_gmv`, dan sesi live kreator milik **Jadwal Live** dalam periode lewat `project_live_sessions` + intervals + products.
- **Tombol "Edit Report"**: tim (izin `reports.finalize`) bisa menyunting teks report — ringkasan eksekutif, judul/isi tiap insight box, daftar rekomendasi — langsung di halaman `/reports/[id]`. Suntingan disimpan di kolom baru `creator_reports.edits_json` (ditambahkan ke migrasi 0066) sebagai override per bagian; render = default rule-based ⊕ override; ada "Kembalikan ke otomatis" per bagian. Angka TIDAK bisa disunting (tetap dari data). Finalisasi mengunci suntingan; audit `report.edit`.
- Report live slot (Jadwal Live) juga tanpa LLM: catatan deterministik `buildLiveNotes` + narasi tim lewat form finalisasi yang sudah ada (`insight_final`).
- Metrik yang TIDAK tersedia dari data platform tidak dikarang: durasi per video (tidak ada data per video), AWD (tidak ada di export). Report menyebutnya secara jujur.

## Status pekerjaan saat rencana disetujui

Sudah selesai sebelum mode plan aktif:
- `supabase/migrations/0066_live_report_schedule_and_report_v2.sql` — enum `live_session`, `project_live_sessions.project_id` nullable + `schedule_slot_id` + CHECK + index natural-key slot, view `project_creator_daily_live_v` dibatasi `project_id not null`, `creator_reports.schedule_slot_id` + unique draft/final per slot, kolom baru `creator_top_products`, seed `m2.live_benchmarks` & `m2.report_rules`.
- `src/lib/ingest/aggregate.ts` + `run.ts` + tes: `TopProductRow` membawa live/video/items/orders split, direct, CTR/CTOR berbobot GMV, shop_name, level1.
- `src/lib/m7/live-ingest.ts` (BARU): inti bersama `groupUploadedFiles` / `analyzeLiveSessionGroups` / `persistLiveSessions` dengan `LiveSessionOwner = project | slot`, `ownerDateWindow()`.
- `src/lib/m7/live-verify.ts`: `periodLabel` + konflik V4 bisa menunjuk slot; tes ditambah.
- `src/app/(portal)/projects/[id]/performa/live-actions.ts`: ditulis ulang memanggil inti bersama (perilaku project tidak berubah).
- `src/lib/m7/report-data.ts`: `period.type: "project" | "live_slot"`, `buildSlotLiveReportData(slotId)`, `buildLiveDetail` berlingkup project/slot. `report-refresh.ts`: `refreshSlotReportData(Safe)`. `components/project-report-view.tsx`: judul/meta/footer untuk slot, blok "Posisi di project" disembunyikan.

## Langkah eksekusi tersisa

### A. Report live stream dari Jadwal Live (M13 ↔ M7)
1. **`src/lib/schedule/live-report.ts`** (pure, dites): status slot yang boleh diunggah (bukan `off`/`cancelled`, tanggal ≤ hari ini), label ringkasan sesi per slot, pemetaan `slotId → {sessions, reportStatus}` untuk kalender.
2. **`src/app/(portal)/schedule/live/[slotId]/page.tsx`** — halaman "Data & Report Live" satu slot: info slot (kreator, tanggal, jam rencana/aktual, brand), form upload (pola `performa/live-upload-form.tsx`: Pratinjau → V1–V7 → Simpan), daftar sesi slot (Batalkan), tombol **Generate Report**, **Finalkan** (edit narasi), link ke report. Guard server: `schedule.view` untuk lihat.
3. **`src/app/(portal)/schedule/live/[slotId]/actions.ts`** — `previewSlotLiveSessions`, `saveSlotLiveSessions` (izin `schedule.edit` + scope CPM = `assertCreatorInScope`, `LiveSessionOwner.kind="slot"`), `voidSlotLiveSession`, `generateSlotReport` (izin `reports.generate` + scope CPM; `buildSlotLiveReportData`; insert/update `creator_reports` `period_type='live_session'`, `schedule_slot_id`; LLM varian `project` opsional, `token_used` dicatat), `finalizeSlotReport` (izin `reports.finalize`). Semua tulis `audit_logs` (`schedule.live_session_upload`, `schedule.live_session_void`, `schedule.report_generate`, `schedule.report_finalize`). Setelah simpan/batal → `refreshSlotReportDataSafe`.
4. **`.../live/[slotId]/report/page.tsx`** — render `ProjectReportView` (`audience="team"`), tombol finalisasi seperti `projects/[id]/report/[creatorId]/page.tsx`.
5. **Kalender `/schedule`**: `page.tsx` mengambil sesi (`schedule_slot_id in (slot minggu ini)`) + status report per slot; `schedule-board.tsx` `SlotBlock` menampilkan badge "📊 data live"/"Report draft/final" dan link ke `/schedule/live/[slotId]` (untuk slot tanggal ≤ hari ini yang bukan OFF/cancelled). `slot-form.tsx` mendapat link yang sama.
6. **Portal kreator**: `/portal/reports/[id]/page.tsx` (BARU) merender report final milik kreator: `live_session` → `ProjectReportView` (audience creator), `weekly/monthly` → `CreatorReportView` (lihat B). `/portal/reports/page.tsx` menautkan tiap baris.

### B. Report Kreator (M2) versi 2
7. **`src/lib/report/types.ts`** — kontrak `data_json` v2 (`schema_version: 2`) + tipe `ReportEdits` (override per bagian, kunci stabil per insight/rekomendasi): header KPI (GMV total/live/video/direct, orders, items, AOV, delta vs periode lalu), `video` (GMV, orders, share, AOV, top produk video: items/AOV/CTR/CTOR, kategori), `live` (GMV, orders, share, AOV; dari sesi: jumlah sesi, durasi total/rata-rata, GMV per sesi & per jam, top sesi, jam mulai terbaik, benchmark CVR/ERR/GPM/CTR/CTOR vs `m2.live_benchmarks`, sesi terpanjang vs rata-rata), `live_deep_dive` (N sesi terbaik: metrik, benchmark, timeline 30 menit, top 5 produk CTR/CTOR/GPM, catatan `buildLiveNotes`), `products` (top live & top video + badge deterministik), `insights` (kalimat rule-based), `recommendations`, plus yang lama (deltas, benchmark peer, kontrak, link leakage, level).
8. **`src/lib/report/live-analysis.ts`** (pure, dites) — sesi → statistik: bucket jam mulai, durasi, GMV/jam, top sesi, ERR = views/impressions_live, CVR = orders/views, GPM, ranking sesi untuk deep dive.
9. **`src/lib/report/rules.ts`** (pure, dites) — badge produk ("CTR terbaik", "AOV tertinggi", "CTOR champion", "Volume tinggi"), insight box (warna+judul+teks) dari angka + `m2.report_rules`/`m2.live_benchmarks`, rekomendasi. Tidak ada angka yang tidak berasal dari input.
10. **`src/lib/report/build.ts`** — pengambil data + perakit v2: jumlah `creator_period_summary` per minggu (perbaikan bug #1), `creator_top_products` kolom baru, `creator_subcat_segment_gmv`, sesi live kreator dalam periode (verified/confirmed_manual, pemilik mana pun), benchmark peer dari `creator_period_summary` (perbaikan #2), kontrak/link leakage/level seperti sekarang.
11. **`src/app/(portal)/reports/actions.ts`** — `generateReport` memakai `build.ts`, TANPA panggilan LLM (`token_used = 0`, `insight_draft` = ringkasan eksekutif rule-based); action baru `saveReportEdits` (izin `reports.finalize`, hanya saat draft, tulis `edits_json` + audit `report.edit`) dan `resetReportSection`. `finalizeReport` tetap (mengunci). `insight.ts` tidak dipakai lagi untuk weekly/monthly (dibiarkan untuk report project lama).
12. **`src/components/creator-report-view.tsx`** (BARU, client) — tampilan setara sampel `reportmcnmea.linkreator.id`: header hijau gelap + 5 KPI, nav tab lengket (Short Video · Live Performance · Analisa Live Terbaik · Produk Optimal), kartu, tabel peringkat, bar benchmark dengan jarum, insight box berwarna, donut kategori (recharts), print-friendly. Tailwind (stack repo), bukan HTML statis. Prop `editable` + `edits`: saat mode edit, setiap insight box/rekomendasi/ringkasan punya textarea inline dan tombol simpan; komponen memanggil `saveReportEdits`.
13. **`src/app/(portal)/reports/[id]/page.tsx`** — dispatch: `schema_version 2` → `CreatorReportView`; report lama → tampilan lama (tetap terbaca); `period_type project` → redirect ke halaman report project; `live_session` → `ProjectReportView`. `reports/page.tsx`: label jenis Bahasa Indonesia + link kreator/slot.

### C. Verifikasi, dokumentasi, rilis
14. Tes: `live-analysis`, `rules`, `live-report` (schedule), `report-data` slot builder (mock), `aggregate` (sudah), `live-verify` (sudah). `npx tsc --noEmit`, `npx vitest run`, `npx next build`.
15. HANDOFF.md: sesi baru (keputusan, file, migrasi 0066 **belum di-apply**, cara QA). CLAUDE.md #4/#5: tambah kalimat "sesi live = satu tabel dua pemilik". `docs/TUTORIAL_JADWAL_LIVE_REPORT.md` singkat untuk tim.
16. Commit + push ke `claude/mcn-report-quality-evk1tu`, PR draft.
17. **Migrasi 0066 ke Supabase**: hanya lewat `apply_migration` (ledger drift), staging dulu (`fomlangoiiywhexwoqom`) lalu production (`bqknstylbpwsnlgnzayw`) — sesuai jawaban pertanyaan di bawah. Kolom `creator_top_products` baru terisi pada upload mingguan berikutnya; report v2 tetap jalan untuk batch lama (bagian produk live/video menampilkan "belum tersedia untuk periode ini").

## Verifikasi end-to-end
- Unit: tes di atas + suite lama 942 tetap lulus.
- Build: `next build` sukses.
- Manual (staging, akun `director.qa@meagency.co.id`): buat slot tanggal hari ini → buka `/schedule/live/[slotId]` → unggah `sample` Product+Trend (`docs/data-samples`, penamaan `{username} Sesi 1, {d} {Bulan} {yyyy}.xlsx`) → V1–V7 hijau → Simpan → Generate Report → report tampil (alur 30 menit, funnel, produk) → Finalkan → login kreator → `/portal/reports/[id]` terbaca. Upload file yang sama ke project → V4 menolak dan menyebut slot pemegangnya.
- M2: generate monthly untuk kreator dengan ≥2 minggu data → GMV = jumlah minggu (bukan satu minggu); report v2 menampilkan 4 seksi; kreator tanpa sesi live → seksi live memakai angka period summary saja tanpa benchmark sesi.
- SQL (read-only) setelah apply: `select count(*) from project_live_sessions where schedule_slot_id is not null` bertambah setelah upload dari jadwal; `creator_reports` `period_type='live_session'` terisi.

## Keputusan interview (final — jangan re-interview)
1. **Izin upload data live dari Jadwal Live = semua pemegang `schedule.edit`** (management, CM Lead, CPM untuk kreatornya sendiri via `assertCreatorInScope`, BizDev Lead, BizDev, Creator Support). Generate/finalisasi report tetap `reports.generate` / `reports.finalize` (PRD M2 §2.5).
2. **Creator Portal menampilkan report final UTUH** — halaman baru `/portal/reports/[id]` (weekly/monthly → `CreatorReportView`, live_session → `ProjectReportView` audience creator). Isolasi: filter `creator_id` eksplisit + RLS `reports_creator_selfonly` (0011).
3. **Seksi Live Performance di Report Kreator (M2) HANYA membaca sesi milik Jadwal Live** (`project_live_sessions.schedule_slot_id is not null`). Sesi Special Project TIDAK ikut — konteks project dianggap terpisah. Konsekuensi di `build.ts`: filter `not.is.null(schedule_slot_id)`; index `idx_live_sessions_creator_date` tetap berguna.
4. **Migrasi 0066 di-apply oleh saya via `apply_migration`: staging (`fomlangoiiywhexwoqom`) dulu, verifikasi SQL, lalu production (`bqknstylbpwsnlgnzayw`)** — tidak pernah `db push` (ledger drift). Dicatat di HANDOFF.
