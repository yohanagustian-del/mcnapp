# HANDOFF — MCN MEA Platform

Status per sesi 2026-07-09 (sesi 5, backlog-sweep + audit deploy). Baca ini + `CLAUDE.md` sebelum lanjut.

## ⚡ SESI 2026-08-04 — M14 FINANCE: MEKANISME UBAH TRANSAKSI + APPROVAL DIRECTOR
**Masalah (QA `/finance/transactions/TRX-202608-0001`)**: halaman transaksi finance belum ada di repo,
dan tidak ada jalur untuk Senior/Lead Finance mengubah transaksi ketika klien ganti metode/rekening
pembayaran. Satu-satunya cara sebelumnya: edit langsung di DB — tanpa jejak, tanpa persetujuan.

**Keputusan aturan (house rule DIREVISI, sesuai permintaan)**: CLAUDE.md #3 dipersempit — read-only
absolut hanya untuk field yang dihitung engine / disync platform (`agency_links.link_status`,
`creators.commission_share`). Transaksi finance = catatan internal atas kesepakatan, bukan data
platform → BOLEH berubah, tapi hanya lewat change request + approval Director. Aturan baru ditulis
sebagai **CLAUDE.md #9**. Ini bukan pengecualian terhadap #2, justru penerapannya.

**Tiga tingkat izin (sengaja dipisah)**: staff `finance` catat+baca · `finance_lead` (role BARU,
Senior/Lead Finance) mengajukan · **Director SAJA** yang menyetujui. Head/SPV tidak bisa menyetujui;
pengaju tidak bisa menyetujui pengajuannya sendiri.

**Penegakan di DB, bukan cuma server action** — server action pakai service-role (bypass RLS), jadi
penjaga yang tak bisa dilewati adalah TRIGGER: `guard_finance_txn_update()` menolak setiap UPDATE
yang menyentuh field terkunci. Satu-satunya jalur sah `apply_finance_change()` (SECURITY DEFINER,
atomic: patch transaksi + tandai pengajuan approved; whitelist kolom + `jsonb_populate_record`
sehingga tak ada dynamic SQL dan `id`/`created_by`/`created_at` tak bisa diselundupkan).

**Files**: `supabase/migrations/0031_role_finance_lead.sql` (enum sendiri — label enum baru tak boleh
dipakai di transaksi yang sama), `0032_finance_transactions.sql` (tabel + trigger + RPC + RLS +
`app_config finance.guarded_fields`), `src/lib/finance/transaction.ts` (enum/label + nomor
`TRX-YYYYMM-NNNN`), `src/lib/finance/change-request.ts` (diff, partisi approval-vs-langsung, validasi
Rupiah/tanggal/enum — pure, 0 LLM), `src/app/(portal)/finance/transactions/{page.tsx,actions.ts}`,
`.../[id]/{page.tsx,change-request-form.tsx}`, RBAC di `src/lib/rbac.ts` (+`FINANCE_ROLES`).

**⚠ APP-nya BEDA REPO.** `/finance/transactions` di `web-internal-mea.vercel.app` dilayani
**`MEAgrup/AgencyAPP`**, BUKAN `mcnapp` (dikonfirmasi user; `mcnapp` tidak punya route/tabel finance
sama sekali sebelum sesi ini). `MEAgrup/AgencyAPP` tidak bisa dilampirkan ke sesi ini — beda owner,
`add_repo` menolak dengan `cross-tier adds are not supported`. `yohanagustian-del/agencyapp` yang
bisa dilampirkan ternyata repo dokumen CDPS, bukan app-nya.
**Fallback yang dibuat**: `docs/port/finance-transaction-approval/` — versi LEPAS dari mekanisme ini:
`migration.sql` (standalone tanpa schema MCN MEA), `change-request.ts` (logika pure nol-dependensi),
`service.ts` + `service.test.ts` (ORKESTRASI lengkap ajukan/putuskan/batalkan di atas 7 fungsi store
yang disuntikkan host — host cuma menulis adaptor DB/audit + peta role→4 boolean), `verify.sql`
(uji-diri 12 skenario), `README.md`. Implementasi di `mcnapp` tetap acuan yang berjalan.
Diuji di Postgres 16 **DB kosong**: migration apply bersih + idempotent (2×), FK auto-attach terbukti
dua arah (dipasang kalau tabel tujuan ada, dilewati kalau tidak), `verify.sql` 12/12 lulus lalu
rollback bersih, `change-request.ts` lulus `tsc --strict` tanpa node_modules/alias/lib DOM,
`service.test.ts` 27/27 (fake store-nya MENIRU trigger + unique index, jadi orkestrator yang
menyentuh field terkunci langsung akan menggagalkan tes). `vitest.config.ts` include diperluas ke
`docs/port/**` supaya port kit tidak membusuk diam-diam.

**Dua perbaikan yang muncul saat menulis `service.ts`, dibawa balik ke mcnapp:**
1. **BUG — pengaju bisa menyetujui pengajuannya sendiri.** `finance.request_change` mencakup
   management (termasuk Director), jadi Director bisa mengajukan lalu approve sendiri → gate
   approval tak berarti. Diperbaiki di `apply_finance_change()` (DB, errcode 42501) DAN di
   `decideTransactionChange`. Sengaja bukan di RBAC: yang dilarang bukan role-nya, melainkan
   kombinasi aktor+pengajuan tertentu. Diverifikasi di Postgres: pengaju ditolak, Director lain
   berhasil approve (`payment_method` → `qris`, `decided_by` terisi).
2. Alasan perubahan kini wajib **hanya** kalau ada field terkunci. Kalau yang berubah cuma
   keterangan, tidak ada yang memutuskan → alasan itu tak punya pembaca, dan memaksanya cuma
   melatih orang menulis alasan basa-basi yang lalu menular ke pengajuan penting.
**Jalur paling bersih untuk melanjutkan**: buka sesi baru dengan `MEAgrup/AgencyAPP` sebagai source
AWAL, lalu tempel port kit itu (jangan rancang ulang).

**Migration BELUM di-apply ke staging/production** — tidak ada kredensial DB di sesi ini. 0031 harus
jalan SEBELUM 0032 (dan sebagai transaksi terpisah). Setelah apply, `TRX-202608-0001` baru ada
isinya kalau transaksi dicatat lewat form "Catat transaksi baru" di `/finance/transactions`
(nomor dibuat berurutan per bulan oleh `next_finance_trx_id`, jadi transaksi pertama Agustus 2026
otomatis bernomor TRX-202608-0001).

**Verifikasi**: typecheck 0 error · **677 pass + 2 skip** (+33 tes baru: change-request 22, RBAC
finance 11) · `next build` sukses (route `/finance/transactions` & `/finance/transactions/[id]`
terdaftar). Migration 0031+0032 dijalankan di Postgres 16 lokal dan 10 skenario diuji langsung
lewat SQL: UPDATE langsung field terkunci ditolak · keterangan boleh langsung · nilai transaksi
TIDAK berubah selama pengajuan menunggu · approve menerapkan semuanya sekali jalan · approve dua
kali ditolak · trigger kembali menjaga setelah apply (flag transaction-local) · dua pengajuan
menunggu ditolak (unique index) · alasan kosong ditolak (check) · kolom di luar whitelist ditolak ·
daftar field terkunci benar-benar mengikuti `app_config` (digeser → perilaku ikut bergeser) ·
RLS: finance_lead baca 2 baris, od_viewer & creator_user 0 baris, user biasa gagal UPDATE.

## ⚡ SESI 2026-07-29 — ARTIFAK "AGENCY LEAKED GENERATOR" DIPINDAH KE DALAM PLATFORM (staging)
**Masalah**: halaman `/link-leakage` cuma menampung hasil export artifak HTML eksternal. CM harus: export MCN+TAP → buka artifak → upload 3 file di sana → download 2 Excel → upload lagi ke `/ingest` Lane 2. File MCN+TAP yang sama sudah diupload di Lane 1 untuk agregat performa.

**Sekarang**: platform yang menghitung. Keputusan interview (final, jangan re-interview):
1. **Sumber master shop = PILIHAN USER** — dari `cooperating_shops` (default) ATAU upload file "Master Data Shop" seperti artifak (radio button di `/link-leakage`, file input opsional di `/ingest`). File master hanya untuk hitungan minggu itu; tabel `cooperating_shops` TIDAK diubah (refresh master tetap tombol terpisah). deal_end tetap dibaca dari DB untuk shop yang terdaftar → alert kadaluarsa jalan walau master dari file.
2. **Alur = satu upload** — Lane 1 `/ingest` sekaligus menghitung leak dari baris yang SAMA (file diparse sekali). Form mandiri di `/link-leakage` untuk hitung ulang / minggu terlewat. Tanpa file TAP, analisa leak DILEWATI (dengan pesan jelas) karena semua GMV shop ber-deal akan terlihat 100% bocor.
3. **Rumus**: angka RESMI = join per (product_id, shop_id) sesuai CLAUDE.md #5; angka basis-shop (rumus artifak lama) ikut dihitung & ditampilkan sebagai PEMBANDING transisi (kolom baru `gmv_bocor_shop_basis` / `leak_ratio_shop_basis` / `gmv_leak_potential_shop_basis`). Basis produk selalu ≥ basis shop (surplus TAP di satu produk tak lagi menutupi bocor produk lain).
4. **Rollup saja di DB** (detail produk TIDAK masuk Postgres) + **backup CSV**: 3 file CSV (ringkasan kreator / detail produk bocor / peluang BD) ditulis ke bucket privat baru `leak-exports` (folder uid, signed URL 1 jam, retensi `retention.leak_export_days` = 30 hari), plus seksi "Backup CSV Analisa" di `/link-leakage` untuk mengunduh lagi.
5. **Lane 2 artifak DIBIARKAN** sebagai fallback data historis (copy UI diubah: bukan jalur mingguan lagi).
6. Hasil otomatis tampil di CM Workspace (pill `platform` di kolom minggu) — tidak ada langkah manual.
7. **TikTok dulu** (Shopee belum).

**Files**: `src/lib/m4/leak-compute.ts` (engine murni, 0 LLM — reuse `classify.ts`: allocateAgencyGmv/classifyPairStatus/rollupCreatorStatus/shopDealState/leadPriority), `src/lib/m4/master-shop-file.ts` (parser master multi-sheet, tolak notasi ilmiah), `src/lib/m4/leak-export.ts` (builder CSV + tulis/prune/list storage), `src/lib/m4/leak-analysis.ts` (orkestrator: W1-W5 gate → resolve kreator → tulis `creator_link_status` source='platform' + `leak_week_summary` source_format='platform' + `bd_leads` source='platform' + `platform_alerts` link_bocor/deal_expiring/deal_expired + retensi + CSV + audit `m4.leak_compute`), `src/lib/ingest/leak-retention.ts` (extract `enforceLeakRetention` dari run.ts — hindari import cycle; run.ts tetap re-export), `src/components/leak-result-panel.tsx` (read-out bersama 2 form), `src/app/(portal)/link-leakage/leak-analysis-form.tsx`, action `runLeakAnalysisFromStorageAction`, `scripts/gen-sample-leak-files.ts` (generator file contoh QA).
**Migration 0027** `0027_leak_compute_in_platform.sql` — **SUDAH APPLIED KE STAGING (`fomlangoiiywhexwoqom`), BELUM ke production (`bqknstylbpwsnlgnzayw`)**: provenance 'platform' di 3 CHECK constraint, 3 kolom pembanding basis-shop, seed `retention.leak_export_days`, bucket `leak-exports` + policy storage per-folder uid.
**Alert kembali hidup**: `platform_alerts` diisi lagi (era artifak tidak mengisi). Delete-then-insert di-SCOPE per creator_id/shop_id run ini supaya CM lain di minggu sama tidak terhapus.
**Yang TIDAK ditulis**: `agency_links` (pair-level, bisa puluhan ribu baris/minggu) dan `leakage_products` tetap tidak diisi — konsisten dengan keputusan "rollup saja"; tabel `leakage_products` tetap read-only data historis.
**Verifikasi**: typecheck 0 error, **551 pass + 2 skip** (naik dari 521: 30 tes baru — leak-compute 15, master-shop-file 5, leak-export 7, integrasi parse→compute→CSV 3), `next build` sukses. Migration + bentuk payload tulis (semua kolom/constraint baru) diverifikasi langsung ke staging via SQL lalu baris ujinya dibersihkan. Angka file contoh diverifikasi dengan menjalankan parser+engine nyata.
**Seed QA di staging** (dibiarkan, DB staging tadinya kosong total): `creators` CRT-QA0001 `qa_creator_satu`, CRT-QA0002 `qa_creator_dua`; `cooperating_shops` 7490000000000000001 (deal aktif 2026-12-31), ...002 (kadaluarsa 2026-06-01), ...003 (deal_end null). `qa_creator_tiga` di file contoh belum ada di DB → akan otomatis dibuat saat upload (uji jalur auto-create).
**Cara QA**: `npx tsx scripts/gen-sample-leak-files.ts ./sample-data` → upload `sample_mcn_2026-07-01.xlsx` + `sample_tap_2026-07-01.xlsx` (+ opsional `sample_master_shop.xlsx`) di `/ingest` atau `/link-leakage`. Ekspektasi (tercetak juga oleh script, sudah diverifikasi): qa_creator_satu bocor basis produk Rp2.500.000 / basis shop Rp2.000.000 → bocor_sebagian (rasio 33,3%); qa_creator_dua via_agency + peluang BD Rp2.500.000 (shop deal kadaluarsa) + alert deal_expired; qa_creator_tiga belum_ada_link + peluang BD Rp3.000.000; 2 lead BD.
**Belum dilakukan**: apply 0027 ke production + QA tim di staging.

### Akun login STAGING (dibuat 2026-07-29)
- `director.qa@meagency.co.id` — role `director`, team_group `management`, `active=true`, uid `d1000000-0000-4000-8000-000000000001`. Hanya untuk staging (`fomlangoiiywhexwoqom`); jangan pernah dipakai di production. **Password TIDAK ditulis di repo** (sengaja — jangan commit kredensial): dikirim terpisah ke Director; kalau hilang, reset dengan SQL di bawah.
- Dibuat via SQL: `auth.users` (bcrypt `extensions.crypt`, email_confirmed) + `auth.identities` (provider email) + `team_members` + `audit_logs` (`team.seed_staging_director`, type auto). Semua idempotent (`on conflict do update`), jadi aman dijalankan ulang untuk reset password.
- **JEBAKAN — wajib diingat kalau bikin user via SQL lagi**: kolom token `auth.users` (`confirmation_token`, `recovery_token`, `email_change`, `email_change_token_new`, `email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token`) harus diisi **string kosong `''`, BUKAN dibiarkan NULL**. GoTrue memetakannya ke string non-nullable → kalau NULL, query login gagal. Gejalanya menipu: `login()` (`src/app/login/actions.ts`) mengubah error apa pun jadi `?error=invalid` → user melihat "Email atau password salah" padahal password benar. Ini kejadian pada seed pertama 2026-07-29 dan sudah diperbaiki. Perbaikan/pencegahan: `update auth.users set confirmation_token=coalesce(confirmation_token,''), recovery_token=coalesce(recovery_token,''), email_change=coalesce(email_change,''), email_change_token_new=coalesce(email_change_token_new,'') where email='...';`
- Cara audit cepat user hasil SQL: bandingkan pola NULL semua kolom teksnya dengan user yang terbukti pernah login (`director@mcn.test`) — kalau ada selisih NULL vs non-NULL, itu calon masalah.
- Reset password staging (Supabase SQL Editor, ganti `<password-baru>`):
  `update auth.users set encrypted_password = extensions.crypt('<password-baru>', extensions.gen_salt('bf')), updated_at = now() where email = 'director.qa@meagency.co.id';`
- Terverifikasi: hash cocok (`crypt(pw, encrypted_password)` = true), tidak banned/deleted, bukan `creator_users` → `login()` mengarah ke `/dashboard`. HTTP langsung ke `*.supabase.co` diblokir proxy sesi ini, jadi cek dilakukan lewat SQL (kondisi yang sama dipakai GoTrue).
- **Cakupan role**: director lolos **22/22 item nav** — satu akun cukup untuk preview semua halaman. Satu-satunya aksi di luar jangkauan: `reports.finalize` (sengaja `head/spv/cm_lead/cpm` per PRD M2 §2.5) → tombol "Finalisasi & kirim" report perlu akun head/spv/CM kalau mau diuji.
- **Isi DB staging**: `auth.users` 39 baris warisan restore production (5 seed `@mcn.test` + ~30 email gmail kreator) TAPI `team_members`=0 dan `creator_users`=0 → akun-akun itu yatim, tidak bisa login (`no_member`). Jangan jalankan flow invite M9 di staging kalau tidak mau email nyasar ke kreator asli. Tabel data: creators 2, cooperating_shops 3, app_config 38, buckets 2 — sisanya kosong dan siap diisi uji upload.

### Status deploy / link preview (per 2026-07-29)
**BELUM ADA link preview.** Tim Vercel `MEA` (`team_UdpHsNFgYV8sMfd2QwaAaia7`, slug `meagency`) **nol project** — repo belum pernah diimport, jadi tidak ada URL staging/preview apa pun. Untuk membuatnya: import repo `yohanagustian-del/mcnapp` di Vercel (Framework Next.js, otomatis dapat Preview URL per branch), lalu set env **untuk scope Preview** → `NEXT_PUBLIC_SUPABASE_URL=https://fomlangoiiywhexwoqom.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_B0qskTOMVMf4fVptAKqlZQ_n5LtGoIv`, `SUPABASE_SERVICE_ROLE_KEY=<secret staging, ambil di Dashboard > Settings > API keys>` (WAJIB: `login()` memakai admin client — tanpa ini login gagal), opsional `ANTHROPIC_API_KEY`/`M2_INSIGHT_MODEL`. Terakhir tambahkan domain Vercel ke Supabase staging > Auth > URL Configuration. Service role key tidak bisa diambil lewat MCP (secret) dan MCP Vercel di sesi ini tidak bisa menulis env var — dua langkah itu harus lewat dashboard.

## ⚡ SESI 2026-07-20 — Upload data mingguan file BESAR (feedback tim ingest)
**Masalah**: file export platform mingguan (TikTok MCN & TAP) bisa ~61.000 baris (belasan–puluhan MB). Upload lewat Server Action kena limit body serverless Vercel (~4,5MB, terlepas dari `bodySizeLimit: 10mb` di next.config) → "tidak bisa upload banyak". Kalau dipecah manual, replace PER (kreator × minggu) di `writeAggregates` menimpa potongan sebelumnya untuk kreator yang barisnya terbelah antar file → "replace bukan append".

**Solusi (direct-to-Storage)**: browser mengunggah file UTUH langsung ke Supabase Storage (bucket privat `ingest-uploads`), mem-bypass fungsi serverless. Server Action tipis hanya menerima `{path, name}`, mengunduh file via service-role, menjalankan pipeline `runIngest`/`runShopeeIngest` yang SUDAH ADA tanpa perubahan (parse → agregat → drop-raw), lalu MENGHAPUS objeknya. File utuh ⇒ tidak ada pemecahan ⇒ tidak ada kehilangan data replace. Raw tetap tidak pernah dipersistkan.

- **File**: `supabase/migrations/0026_ingest_uploads_bucket.sql` (bucket + RLS storage.objects scoped folder uid, limit 100MB), `src/lib/ingest/storage.ts` (download/remove/validate ref, server), `src/lib/ingest/upload-client.ts` (`uploadIngestFile`, browser), action baru `runIngestFromStorageAction` (actions.ts) + `runShopeeIngestFromStorageAction` (shopee-actions.ts), form TikTok & Shopee dialihkan ke path storage (2-tahap: unggah → proses; label progress). Action FormData lama (`runIngestAction`/`runShopeeIngestAction`) DIBIARKAN sebagai fallback (permission-gated, tak dipakai UI).
- **Tes**: `src/lib/ingest/__tests__/storage.test.ts` (8 tes: validasi ref/traversal, rekonstruksi File nama asli, cleanup best-effort). Total **502 pass + 2 skip**, tsc 0 error, `next build` sukses.
- **⚠ WAJIB OPERASIONAL sebelum fitur jalan di remote**: apply migration **0026** (buat bucket `ingest-uploads` + policy). Tanpa ini, upload gagal ("bucket not found"). Belum di-apply sesi ini (tidak ada perubahan DB dari agent) — apply via Supabase MCP/Dashboard saat deploy.

## ⚡ SESI 2026-07-09 (sesi 5) — Sweep backlog HANDOFF + audit kesiapan deploy Vercel
1. **/link-leakage disesuaikan ke era artifak**: copy engine-era diganti (data = upload artifak CM via /ingest Lane 2, bukan hitungan platform); banner totals mingguan dari `leak_week_summary`; status NULL (artifak v2) kini badge "Belum diketahui (artifak v2)" (bukan render `null`); pill "artifak" per baris source='artifact'; blok stale-engine warning (query `transactions_all` m4all:) DIHAPUS (meaningless pasca drop-raw); tabel `leakage_products` hanya dirender kalau ada data historis, dengan label "data historis era engine", selain itu empty-state yang mengarahkan ke file Excel artifak.
2. **Verifikasi one-time upsert clobber SELESAI (vs remote, baris test dibersihkan)**: kekhawatiran TIDAK terbukti — PostgREST upsert hanya menimpa kolom yang dikirim. TAPI ketemu bug nyata: payload master-refresh `upsertDerivedFromTap` meng-omit `shop_id` NOT NULL → SELALU gagal constraint (branch INSERT divalidasi walau hanya UPDATE yang jalan) dan error di-swallow diam-diam → last_seen/updated_at produk master tak pernah ter-bump. **SUDAH DIFIX**: payload kini kirim `shop_id` existing; error di-log + di-surface via `errors[]` → masuk daftar `skipped` laporan ingest (prefix `products_tap:`). Script verifikasi: `scripts/verify-upsert-clobber.ts`. 2 test regresi baru.
3. **Audit deploy Vercel (read-only)**: TIDAK ada blocker kode — 0 hardcode localhost, service role key server-side only, RBAC guard semua mutasi, 0 dependensi native, next.config aman (bodySizeLimit 10mb untuk CSV). Yang dibutuhkan hanya operasional: commit+push → import repo ke Vercel → set env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, opsional `ANTHROPIC_API_KEY`/`M2_INSIGHT_MODEL`) → set Site URL domain Vercel di Supabase Dashboard > Auth > URL Configuration. Remote git: https://github.com/yohanagustian-del/Claudecode.git (HTTPS).
4. Verifikasi: typecheck 0 error, **492 pass + 2 skip** (naik dari 490: 2 test baru products.test.ts), tidak ada regresi.

## ⚡ SESI 2026-07-09 — M13 Penjadwalan Live Streaming + shop_name dashboard BD (QA batch 4)
> UPDATE (sesi yang sama, setelah user kasih Supabase PAT): nomor modul dikoreksi **M11 → M13** (M11 = OD Oversight, M12 = Retensi Data — sudah terpakai). Migration **0023 SUDAH APPLIED ke remote** via Management API. **MCP Supabase kini ter-setup di `.mcp.json`** (project-scoped, `@supabase/mcp-server-supabase`, project-ref bqknstylbpwsnlgnzayw, token PAT inline — file di-gitignore; aktif mulai SESI BERIKUTNYA, sesi ini pakai Management API langsung via curl, catatan: python urllib diblok Cloudflare 1010, wajib curl + User-Agent browser). **E2E TERBUKTI di browser vs remote**: login director → /schedule render → toggle roster vikahere → buat slot (badge PK/TAP benar) → muncul di antrean Verifikasi Hari Ini → verifikasi (✓ done, keluar antrean) → 3 audit_logs `schedule.*` tercatat → data uji dibersihkan (slots=0, roster=0).
Semua keputusan via interview user (final, jangan re-interview):
1. **shop_name di dashboard BD (fix kecil)**: `bd_leads.shop_name` sudah ada (0018) & terisi oleh ingest artifak — bug hanya di select/render. `workspace/bizdev` + `link-leakage` kini menampilkan nama shop + shop_id sebagai subteks muted, fallback shop_id kalau null (baris lama pra-artifak-v2).
2. **M13 baru: Penjadwalan Live** (pengganti Google Sheet "Penjadwalan" CM). Tabel `live_schedule_slots` (migration **0023 — applied, lihat UPDATE di atas**) + flag manual `creators.live_roster` (kurasi kalender, permission `schedule.roster`). Slot: status `scheduled|tentative|off|done`, brand FREE TEXT + `deal_id` opsional ke brand_deals, `deals_by` (bd|cm|creator), `ads_payer` (brand|mea|invoicing_mea|organik) + ads_note bebas, pk_ready & product_connected_tap boolean, fokus_produk. **Verifikasi oleh CM ATAU CS** (CS handle di luar jam kerja CM): actual_start/end + verified_by/at → status done (locked). Multi-slot per creator per hari diizinkan.
3. **RBAC**: view = management+CM+BD+CS (cpm hanya lihat creator sendiri, lainnya semua); edit = CM+BD+CS (cpm scope `owner_cpm_id`); verify = CM+CS+management; roster = CM lead/cpm/management. Semua mutasi → audit_logs type `auto` (siapa edit tercatat — permintaan eksplisit user). Writes via service role, RLS select-only; otorisasi halus di server actions.
4. **UI**: `/schedule` (nav "Jadwal Live") — matriks creator × 7 hari (Senin-start), badge PK ✘/TAP ✘/Tentatif/✓ done/ring merah belum-verifikasi + penanda "besok belum ada jadwal"; form slot client island; nav minggu + "Salin dari minggu lalu" (`copyWeekAction`, tolak kalau minggu target sudah terisi, reset status/PK/verifikasi, skip OFF); panel "Verifikasi Hari Ini" + "Terlewat belum diverifikasi"; panel "Kelola Roster". Workspace CM: seksi ringkas hari ini+besok + warning kreator kosong besok. Workspace BD: seksi slot minggu ini `deals_by='bd'` OR ada deal_id.
5. **Keputusan scope**: mulai KOSONG (2.170 baris sheet historis = arsip, tidak diimpor); indikator visual saja (reminder/notifikasi eksternal = fase nanti); sheet "import Data CM & Creator" (master tambahan) out of scope; recurrence penuh tidak dibuat (cukup salin minggu).
6. **Files**: `supabase/migrations/0023_live_schedule.sql`, `src/lib/schedule/{types,week,matrix,indicators,copy-week}.ts` + 28 unit test, `src/app/(portal)/schedule/{actions.ts,page.tsx,schedule-board.tsx,slot-form.tsx,week-nav.tsx,verify-panel.tsx,roster-panel.tsx,compact-list.tsx}`, rbac `schedule.*` + NAV_ITEM.
7. Verifikasi: typecheck 0 error, **490 pass + 2 skip**, production build sukses (route /schedule 5,2 kB) + e2e browser vs remote (lihat UPDATE di atas — create/verify/roster/audit semua terbukti).

## ⚡ SESI 2026-07-08 MALAM (lanjutan) — Lane Shopee /ingest (keputusan interview, final)
1. **File Shopee = SATU CSV gabungan MCN+SAP** (Conversion Report per-transaksi, contoh: ConversionReport_202607080813.csv, BOM utf-8-sig, header Indonesia). Card Shopee /ingest kini form hidup 1 slot (bukan placeholder).
2. **Aturan (user-final)**: hanya baris `Status Pesanan="Selesai"`; GMV = `Total Pembelian yang Dibuat(Rp)`; tanggal acuan window = **`Waktu Pesanan Selesai`**; window W1-W5 persis TikTok (lintas window DITOLAK — file contoh 28Jun-4Jul memang ditolak, by design); live/video dari kolom `Platform` (Shopeelive/Shopeevideo, lainnya cuma masuk total); replace idempotent per creator×week.
3. **Kreator Shopee TERPISAH per platform**: `resolveCreatorNamesByPlatform` match username + platform='shopee' saja (tak pernah nyambung ke kreator TikTok walau username sama); baru → dibuat status 'prospek'. Avg GMV bulanan otomatis jalan (helper bersama `src/lib/ingest/creator-autofill.ts`, run.ts ikut direfactor pakai ini).
4. **LEAK/BD SHOPEE TIDAK DIHITUNG PLATFORM**: user akan bikin artifak Agency Leaked Generator versi Shopee "persis sama seperti TikTok" (belum dibuat) → dibaca Lane 2 existing; master deal Shopee belum sinkron, menyusul. Kolom Campaign Type/Partner Promo di CSV sengaja diabaikan (dikomentari di shopee-run.ts). Rule bisnis leak Shopee utk artifak nanti: Promo MCN+Partner Promo="Pemilik"=via agency; Promo MCN+nama lain=leaked (list creator/shop_id/ID Promosi); non-Promo MCN → cek deal shop: tak ada=BD opportunity, ada=leak.
5. **Agregat Shopee = GMV mingguan SAJA** (creator_period_summary; kolom khusus TikTok diisi netral 0/null) — TANPA subcat/top-products/products_tap (matching M5 tetap TikTok-only dulu).
6. Migration **0022** (source_type 'shopee' di upload_batches) SUDAH applied ke remote. Files: shopee-csv.ts / shopee-aggregate.ts / shopee-run.ts / creator-autofill.ts / shopee-actions.ts / shopee-ingest-form.tsx. batch_id `ingest-shopee:<periodStart>:<hash8>`, audit `ingest.run_shopee`. Tests **458 pass + 2 skip**, tsc 0 error; e2e browser: penolakan lintas window tampil benar di card Shopee.

## ⚡ SESI 2026-07-08 MALAM — QA batch 3 (avg GMV /creators + konsolidasi /ingest + hapus /metrics)
Semua keputusan via interview user (final, jangan re-interview):
1. **GMV di /creators = RATA-RATA BULANAN** (rata-rata total bulanan dari SEMUA bulan yang punya data, live/video ikut). Disimpan di `creators.gmv/gmv_live/gmv_video` (bukan on-the-fly): `autoFillCreators` (run.ts) kini menghitung dari SELURUH histori `creator_period_summary` per creator (bukan total batch) via `buildMonthlyAverages` di `src/lib/m8/weekly-growth.ts` (reuse grouping bulan + dedupe `buildMonthlyGrowth` — helper internal `groupWeeksByMonth` dipakai bersama). Backfill sekali SUDAH DIJALANKAN ke remote (`scripts/backfill-avg-gmv.ts`, 6 update/6 skip/0 gagal, audit `creator.backfill_avg_gmv`); bidanlilis77 Rp399.859.865 = cocok chart W1-W4 Juni.
2. **/metrics DIHAPUS**: page → `redirect("/ingest")`, `metrics/actions.ts` dihapus (tidak ada importer lain; util shared memang di `src/lib/platform-csv.ts`), nav + permission `metrics.upload` dihapus. Jenis report LIVE TikTok (mcn/tap_tiktok_live) ikut dihapus — keputusan user: tidak dipakai (live sudah dari affiliate_live_gmv file MCN). Tabel `platform_metrics_raw`/`metric_upload_batches` DIBIARKAN.
3. **/ingest** = satu-satunya pintu upload, nav label "Upload Data Platform Mingguan". Dua card terpisah: **TikTok** ("File MCN TikTok report (semua transaksi) — wajib" + "File TAP report (via agency link) — opsional, disarankan") dan **Shopee** (MCN Shopee wajib + Sap opsional) — card Shopee **PLACEHOLDER disabled** ("segera hadir") karena user belum kasih file contoh Shopee/SAP; user janji kasih path contoh sesi berikutnya → baru bangun parser (keputusan: placeholder dulu, bukan pipeline penuh). Lane 2 artifak tidak disentuh.
4. Test: **419 pass + 2 smoke skip** (−1 dari 420: test auto-generated per key PERMISSIONS berkurang saat `metrics.upload` dihapus — bukan regresi). Typecheck 0 error. Verifikasi browser: /ingest 3 card OK, /metrics redirect 200 → /ingest, /creators tampil avg + header "(avg/bln)".

## ⚡ SESI 2026-07-08 SORE — QA batch 2 (Uma 4-minggu + artifak format baru)
Semua via interview user (keputusan final):
1. **Replace Lane 1 kini PER (kreator × minggu)** — bug nyata: `batch_id` lama global per minggu (`ingest:<period_start>`) membuat upload Uma W4 MENGHAPUS agregat vikahere W4. Fix: `batch_id = ingest:<periodStart>:<hash8 sha256 file MCN>`; delete agregat di-scope `.in(creator_id) + period_start/window_end` (chunk 200). Dua CM upload minggu sama = aman berdampingan. Regression test ada di run.test.ts.
2. **Parser artifak Lane 2 dual-format** (`detectArtifactFormat`): v1 = 3-tab lama (Executive Summary "Period: X to Y" + blok "▶ CREATOR:"), v2 = 2-tab baru "MEA Agency Link Intelligence" (Ringkasan Creator + Produk Bocor). v2 TIDAK punya rincian bocor per kreator → simpan `gmv_affiliate_total` per kreator, `link_status/gmv_bocor/leak_ratio` = NULL (unknown, bukan nol; migration 0021 drop NOT NULL), totals level-CM ke tabel baru `leak_week_summary` (unique week+uploaded_by). Migration 0021 SUDAH applied ke remote. Sheet BD dideteksi by header probing (nama sheet varian: "Ringkasan Shop Non-Partnered"/"Ringkasan Peluang BD Shops").
3. **Akar "tidak terbaca sama sekali" QA**: (a) file 3-tab Uma lama ditolak W1-W5 (periode 2026-05-27→06-23 = 4 minggu) TAPI pesannya tak pernah tampil karena server action `throw` DISENSOR Next.js production; (b) file baru = format v2 tak dikenali. Fix: SEMUA action /ingest kini return `{ok:true,result}|{ok:false,error}` (jangan pernah throw ke client), pesan menyebut periode file + window W1-W5 valid + daftar sheet ditemukan vs diharapkan.
4. **UI Growth W1-W5**: CM Workspace section "Pertumbuhan GMV Mingguan" (pemilih bulan `?bulan=YYYY-MM`, tabel W1-W5 + panah + Total Bulan + Growth + baris TOTAL; kreator tanpa data bulan itu disembunyikan) + chart recharts (BARU diinstal) di `/creators/[id]` + helper murni `src/lib/m8/weekly-growth.ts` (weekIndexOf/buildMonthlyGrowth/availableMonths, dedupe createdAt, preferensi canonical week-start 1/8/15/22/29). TERBUKTI di browser: TOTAL W4 Juni = Rp640,2jt (cocok DB), chart bidanlilis77 total Rp399,9jt growth -62,5%.
5. **Terbukti e2e vs remote** dengan file QA nyata (`MEA_Agency_Link_Detail_2026-06.xlsx` + `MEA_BD_Opportunity_2026-06.xlsx`, W1 Juni): 6 kreator masuk creator_link_status (status NULL by design), leak_week_summary terisi (347,4jt/66,1jt/185,8jt), bd_leads 16 baru + 29 update.
6. **Spec generator artifak**: `docs/artifact-generator-spec.md` — untuk memperbaiki tool eksternal (target: kembali ke format v1 per-creator + WAJIB per minggu W1-W5). Keputusan user: leak SEMENTARA tetap via artifak (master shop belum tercover); hitung-di-platform ditunda.
7. **vikahere**: agregat W4-nya yang tertimpa TIDAK dipulihkan otomatis — file sumber di ~/Documents ternyata export BULANAN (tak bisa dipecah per minggu jujur; data lama berasal dari salinan smoke yang tanggalnya direkayasa). Upload ulang export mingguan via UI kapan saja (kini aman).

## ⚡ PERUBAHAN ARSITEKTUR BESAR (keputusan user 2026-07-08, via interview)
Target skala: **sampai 1.000 kreator/minggu**. Analisis agency-leak M4 **dipindah ke tool eksternal** ("Agency Leaked Generator" artifak, dijalankan tiap CM MINGGUAN untuk semua kreator yang di-handle). Platform tidak lagi menghitung leak — hanya menyimpan hasil. Dua jalur upload di `/ingest`:

1. **Lane 1 — Upload performa (MCN + TAP opsional)**: parse → agregat in-memory → tulis 3 tabel agregat + katalog products_tap + auto-fill creators → SELESAI. **Raw TIDAK PERNAH ditulis ke DB** (tidak ada staging, tidak ada engine M4). Terbukti: file vikahere W4 (2.528 MCN + 1.746 TAP) tuntas **16,3 detik** (sebelumnya >6 menit gagal fetch).
2. **Lane 2 — Upload hasil artifak leak (2 file Excel per CM)**: parse → validasi W1-W5 → simpan **ROLLUP SAJA** per kreator per minggu ke `creator_link_status` (kolom baru migration 0020) + `bd_leads` dari sheet BD_Shop_Summary → tampil di CM Workspace section "Link Leakage Kreator". Detail produk bocor TETAP di Excel (tidak disimpan — keputusan "rollup saja").

Keputusan interview lain (final, jangan re-interview):
- Report M2 = **data-only dulu cukup** (insight LLM nanti setelah API key diganti).
- BD pitch / Prediksi Deal (M6) **ditunda sampai pasca-produksi**; menu `/predictor` disembunyikan dari NAV_ITEMS (kode utuh, tinggal un-comment di rbac.ts).
- Artifak WAJIB dijalankan dengan rentang W1-W5; periode lain ditolak dengan pesan jelas.

## Kondisi sekarang
- Branch: `claude/mcn-phase-3-kickoff-zjtfyo` — 2 commit lama BELUM di-push + **seluruh perubahan sesi ini BELUM di-commit** (user push hanya setelah semua review lolos; `gh` belum terinstal di mesin ini).
- Typecheck HIJAU (0 error). Tests: **490 pass + 2 smoke manual auto-skip** (vitest). Production build sukses.
- Migration **0001–0023 SEMUA applied ke remote** (0023 = live schedule, applied 2026-07-09 via Management API).
- **MCP Supabase**: `.mcp.json` di root project (gitignored, berisi PAT) — tersedia mulai sesi berikutnya. Fallback tanpa MCP: Management API `POST /v1/projects/bqknstylbpwsnlgnzayw/database/query` dengan curl + User-Agent browser (python urllib kena Cloudflare 1010).
- Supabase project: `bqknstylbpwsnlgnzayw`. Dev server: `npm run dev -- --port 3100` (launch.json `mcn-dev`).
- `ANTHROPIC_API_KEY` di `.env.local` masih INVALID (401) — report M2 jalan data-only (pesan error di UI sudah jelas + report tetap tersimpan draft).

## Login QA
Semua akun `@mcn.test`, password `Password123!`. Director: `director@mcn.test`.

## Selesai sesi ini ✅ (e2e TERBUKTI di remote + browser preview)
1. **Root cause "upload lambat + gagal fetch" ditemukan & dibasmi**: N+1 di `upsertDerivedFromTap` (2 query sekuensial × 1.841 produk) + staging round-trip. Fix: bulk `.in()` select chunk 200 + bulk upsert chunk 500 (dipisah per bentuk kolom — PostgREST menolak batch dengan key set beda), dan Lane 1 aggregates-only tanpa staging.
2. **Batch stranded `ingest:2026-06-22` dibersihkan** dari DB (audit `ingest.recover_stuck_staging`), lalu re-ingest sukses 16,3 dtk, invariant terpenuhi (processed, staging 0, agregat lengkap).
3. **Lane 2 dibangun & terbukti dengan file Uma nyata** (6 kreator multi-creator per CM): parser toleran (`src/lib/ingest/leak-artifact.ts`), rollup deterministik reuse `rollupCreatorStatus` + threshold `m4.bocor_*` dari app_config (`leak-rollup.ts`), orchestrator (`leak-run.ts`), server action + card kedua di /ingest, section read-only di workspace CM. 50 bd_leads source='artifact'. Status terhitung benar (0.49→bocor_sebagian, 0.926→bocor_total, 0→via_agency).
4. **Report M2 vikahere terbit** (draft #4, weekly 2026-06-22, data-only) dan **Matching M5 menghasilkan kandidat** (Skintific, skor 0.625 + proyeksi GMV) — dua kegagalan QA sebelumnya akarnya sama: tabel agregat kosong karena pipeline tak pernah tuntas.
5. Menu `/predictor` disembunyikan; smoke test manual tersedia: `RUN_INGEST_SMOKE=1` / `RUN_LEAK_SMOKE=1` + `SMOKE_DIR` (lihat `src/lib/ingest/__tests__/smoke*.qa-manual.test.ts`).

## Belum dilakukan 🟡
- **QA user /schedule dengan data nyata**: tim CM set `live_roster` kreator via panel Kelola Roster lalu isi jadwal minggu berjalan (e2e teknis sudah terbukti; tinggal pemakaian nyata).
- **Artifak Agency Leaked Generator versi SHOPEE** — user yang buat (format persis TikTok v1); sampai ada, leak Shopee tak terhitung. Master deal Shopee juga belum sinkron ke cooperating_shops.
- **Commit + push** semua perubahan (3 sesi menumpuk, butuh `gh auth login`).
- **Perbaiki generator artifak eksternal** pakai `docs/artifact-generator-spec.md` (target format v1 per-creator, per minggu W1-W5) — supaya status per kreator hidup lagi (v2 = status NULL).
- **Re-upload data mingguan vikahere** via UI (agregatnya tertimpa era batch global; lihat poin 7 di atas).
- Tests baseline sekarang: **492 pass + 2 smoke manual auto-skip**; typecheck 0 error; migration applied s/d **0023**.
- Data smoke di DB adalah data QA nyata (vikahere W4 + rollup Uma week 2026-06-22) — DIBIARKAN sebagai contoh; re-upload periode sama akan me-replace.
- ~~/link-leakage copy era engine~~ → SELESAI sesi 5. ~~Verifikasi upsert clobber~~ → SELESAI sesi 5 (tidak clobber; bug shop_id ketemu & difix — lihat blok sesi 5 di atas).
- **Deploy Vercel untuk QA tim** (baru): kode siap; tinggal commit+push, import ke Vercel, set 3 env wajib + Site URL Supabase (lihat blok sesi 5).
- ANTHROPIC_API_KEY ganti yang valid → insight M2 hidup.
- Portal kreator M9 "Produk Cocok Untukmu"; BD Master Data kolom kaya; M8 e-sign provider; M5/M6 taxonomy Level 2.

## Arsitektur penting (jangan keliru)
- **Lane 1 /ingest**: parse → validasi W1-W5 + guard overlap → resolve creators → agregat in-memory → writeAggregates + upsertDerivedFromTap (bulk) + autoFillCreators → processed. TANPA staging/engine. `enforceLeakRetention` dipanggil dari Lane 2 (bukan Lane 1).
- **Lane 2 /ingest**: `uploadLeakArtifact` (leak-run.ts): File 1 wajib (Executive Summary "Period: X to Y" + sheet Creator_Detail_Sections blok "▶ CREATOR:" + bullet Rp), File 2 opsional (BD_Shop_Summary). Delete-then-insert rollup HANYA (week × creator di file) — CM lain minggu sama aman. bd_leads existing: refresh metrics saja, status BizDev tak diubah.
- **Skema W1-W5** (final): W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir. Identik=replace, overlap-beda=tolak.
- **M10 matching**: katalog = master upload UNION derived_tap; skor dari `creator_subcat_segment_gmv`.
- **M4 engine** (`src/lib/m4/engine.ts`) TIDAK dipanggil dari mana pun sekarang (di-retain untuk referensi rumus; `rollupCreatorStatus` di classify.ts di-reuse Lane 2).

## File contoh user (di luar repo, untuk QA)
- `~/Downloads/Uma_AgencyLink_Leak_Detail_Report (1).xlsx` + `~/Downloads/Uma_AgencyLink_BD_Opportunity_Report.xlsx` — artifak batch multi-kreator (CM Uma, 6 kreator) — SUMBER format Lane 2.
- `~/Documents/Organik kreator /data platform transaksi creator - vikahere.csv` + `~/Documents/tap /data tap vika here.csv` — export bulanan (header Indonesia, delimiter `;`).
- `~/Downloads/sample data mcn .xlsx` + `~/Downloads/sample data tap .xlsx` — sampel 5 creator.

## Aturan yang gampang kelupaan (dari CLAUDE.md)
- `commission_share` & `agency_links.link_status` READ-ONLY; creator_link_status juga read-only (diisi Lane 2).
- Semua threshold dari `app_config` (m4.bocor_sebagian=0.1, m4.bocor_total=0.5, retensi leak).
- Semua mutasi material → `audit_logs`. 0 LLM di jalur deterministik. `genId()` terpusat.
- Invariant Module 0.5: pasca-upload staging HARUS kosong (Lane 1 kini by construction — raw tak pernah ditulis).
- `getConfig` request-scoped (Next cookies) — di luar request pakai mock/admin client (lihat smoke tests).
