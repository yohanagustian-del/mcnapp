# Plan Build — Improvement MCN (2026-09)

Sumber request: Google Doc "Improvement MCN" (12QCxLzEYPO56N_vs-PNKQ8cxg0g5J8vEYe-KVNC9QUg).

## Context
Dokumen "Improvement MCN" berisi 3 request:
1. **Special Project → Metrik Harian**: buang tampilan kumulatif GMV. Gantinya, tabel Target GMV / Achieved GMV / GMV Gap / Sisa Hari.
2. **Undang kreator ke Portal Kreator**: saat ini hanya ada di tabel peserta Special Project. CM dan Akuisisi harus bisa mengundang.
3. **Perpanjang kreator + status kemitraan**:
   - Alert perpanjang tampil di CM Workspace (khusus kreator yang di-assign), berwarna merah mulai sisa ≤30 hari.
   - Status **Management Partnership** (TikTok & Shopee) dan **Fee Agreement** (TikTok saja).

Keputusan user yang sudah dikunci:
- **Q1** Tabel harian tetap ada. Yang dibuang hanya kolom kumulatif, lalu ditambah tabel ringkas.
- **Q2** Status kemitraan TIDAK berasal dari platform. User menyiapkan file Excel berisi Username, Nama Kreator, dan kolom status. Tidak ada edit manual per baris.
- **Q3** Status dan sisa kontrak tampil di CM Workspace, /creators/[id], dan tabel /creators.
- **Q4** Tombol undang ada di /creators/[id] dan CM Workspace (tombol lama di Special Project tetap). CPM hanya boleh mengundang kreator miliknya. CM Lead, Akuisisi, dan Management boleh mengundang semua kreator.

Plan ini sudah disetujui user (2026-09-30). Prompt eksekusinya ada di `docs/plans/PROMPT_BUILD_IMPROVEMENT_MCN.md`.

Catatan: dokumen memuat 1 gambar yang tidak terbaca oleh tool.

---

## Status tiket

| Tiket | Judul | Blokir | Migrasi | PR |
|---|---|---|---|---|
| T1 | Metrik Harian: buang kumulatif + tabel ringkas | — | tidak | sendiri, auto-merge |
| T2 | Undang Portal CM & Akuisisi (scoped) | — | tidak | sendiri, auto-merge |
| T3 | Form Perpanjang bersama + threshold app_config | — | tidak | sendiri, auto-merge |
| T4 | Fondasi data status kemitraan (file 0083 + parser) | — | file saja | PR Partnership (ditahan) |
| T5 | Upload Excel status kemitraan | T4 | — | PR Partnership |
| T6 | CM Workspace: kontrak & status kemitraan | T2, T3, T4 | — | PR Partnership |
| T7 | /creators/[id] kartu + /creators kolom | T2, T4 | — | PR Partnership |
| T8 | FINAL: apply migrasi 0083 → merge PR Partnership | semua | apply | — |


### T1 — Metrik Harian: buang kumulatif + tabel ringkas target
- **Blokir:** tidak ada. **Migrasi:** tidak. **PR:** sendiri, auto-merge.
- **File:**
  - `src/app/(portal)/projects/[id]/daily-metrics-table.tsx`
  - `src/app/(portal)/projects/[id]/page.tsx` (sekitar baris 139-151, 241-256, 502-577)
  - `src/lib/m7/tracking.ts` (+ test `src/lib/m7/__tests__/tracking.test.ts`)
  - `src/lib/m7/project-report-export.ts`
- **Langkah:**
  1. Buang kolom Kumulatif, Target Kumulatif, dan Gap (beserta sort key dan field `cumActual`/`cumTarget`/`gap` di `DailyMetricRow`). Kolom yang tersisa: Tanggal (H-n), GMV, Ads, Revenue MEA.
  2. Tambah field murni di `TrackingSummary` (`trackDaily()`):
     - `gmvGapToTarget = max(targetGmv − cumActual, 0)`
     - `daysRemaining` (pindahkan dari `page.tsx:151`)
     - Tambah test untuk keduanya.
  3. Buat komponen baru `project-target-summary.tsx` di atas tabel harian dengan kolom **Target GMV | Achieved GMV | GMV Gap | Sisa Hari**.
     - Gap > 0 → merah. Gap = 0 → hijau "Tercapai".
     - Angka hanya dari `tracking` (CLAUDE.md #4).
  4. Kartu "Progres GMV"/"Status" (kurva ramp) tidak diubah.
  5. Export Excel: sheet "Metrik Harian" ikut membuang kumulatif, sheet "Ringkasan" ditambah GMV Gap dan Sisa Hari.

### T2 — Undang Portal untuk CM & Akuisisi (scoped)
- **Blokir:** tidak ada. **Migrasi:** tidak. **PR:** sendiri, auto-merge.
- **Kondisi sekarang:**
  - `invitePortalAccount` ada di `src/app/(portal)/projects/[id]/portal-invite-actions.ts`, dengan gate `m7.curate` dan tanpa scope check.
  - UI-nya `portal-invite-button.tsx`, hanya dirender di `projects/[id]/page.tsx:683`.
  - `m9.invite` (`src/lib/rbac-constants.ts:282`) belum dipakai.
- **Langkah:**
  1. Set `m9.invite` = `[...MANAGEMENT_ROLES, ...CM_ROLES, ...ACQUISITION_ROLES]`. `m7.curate` tidak diubah karena juga dipakai shortlist.
  2. Pindahkan action dan tombol ke modul bersama: `src/lib/portal/invite.ts` + `src/components/portal-invite-button.tsx`, dengan gate `requirePermission("m9.invite")`. Halaman project memakai komponen yang sama (tanpa salinan).
  3. Scope: panggil `assertCreatorInScope()` (`src/lib/schedule/scope.ts`) sehingga CPM hanya bisa mengundang kreator dengan `owner_cpm_id = actor.id`. Generalisasi pesan error helper itu (parameter `action`), karena teksnya sekarang menyebut "jadwal".
  4. Perbaiki bug: `projects/[id]/page.tsx:195` membaca `creator_users` dengan client sesi. Di bawah RLS `cu_self_read`, staf tidak mendapat baris, jadi status portal selalu tampil "belum diundang".
     - Buat `loadPortalStatus(creatorIds)` memakai admin client, dengan otorisasi di kode.
     - Pakai di semua tempat tombol ini muncul.
  5. Tambah status portal (Belum diundang / Diundang / Aktif) dan tombol di header `/creators/[id]` (`src/app/(portal)/creators/[id]/page.tsx`).
  6. Test di `src/lib/__tests__/rbac.test.ts`:
     - `m9.invite` diizinkan untuk cpm, cm_lead, acquisition_spec, acquisition_lead;
     - ditolak untuk bizdev dan finance;
     - tambah test scope CPM.

### T3 — Komponen form Perpanjang bersama + threshold dari app_config
- **Blokir:** tidak ada. **Migrasi:** tidak. **PR:** sendiri, auto-merge.
- **Langkah:**
  1. Ekstrak form inline "Perpanjang" dari `src/app/(portal)/workspace/acquisition/perpanjangan/perpanjangan-table.tsx` menjadi `src/components/contract-renew-form.tsx`. Action tetap `renewContractAction` (sudah memakai `assertCreatorInScope`).
  2. Ganti bucket 30/60 yang di-hardcode (`perpanjangan-table.tsx:22-28`) dengan `contractBucket()` (`src/lib/creators/contract.ts`) + `loadContractAlertDays()` (`app_config m8.contract_alert_days`).
     - danger/expired → merah, warning → kuning.
     - Terapkan juga pada kolom Sisa Kontrak di `src/app/(portal)/creators/creators-table.tsx`.

### T4 — Fondasi data status kemitraan (file migrasi + parser, BELUM diterapkan)
- **Blokir:** tidak ada.
- **Migrasi:** YA, tapi hanya FILE `supabase/migrations/0083_creator_partnership_status.sql`. Penerapan ke DB dilakukan di T8.
- **PR:** gabungan "Partnership" (T4–T7), DITAHAN sampai T8.
- **Migrasi 0083:**
  - Tabel `creator_partnership_status` (satu baris per kreator = status terkini):

    | Kolom | Tipe / catatan |
    |---|---|
    | `creator_id` | PK, FK creators on delete cascade |
    | `platform` | tiktok \| shopee |
    | `partnership_status` | enum linked \| not_linked \| link_req \| unlink_req |
    | `fee_agreement_status` | enum agree \| disagree \| agreement_req \| cancellation_req; nullable, selalu null untuk Shopee |
    | `source_batch_id`, `updated_by`, `updated_at` | — |

  - Tabel `creator_partnership_uploads` (log batch).
  - RLS:
    - baca: staf internal, CPM hanya kreatornya;
    - **restrictive deny `is_creator_user()`** (pelajaran 0067/0068);
    - tanpa policy tulis, jadi penulisan hanya lewat service role.
  - Seed `app_config m8.partnership_status_labels` (label + arti 8 status dari dokumen user).
  - Tambah `partnership_drop` ke constraint `platform_alerts.alert_type` bila ada.
- **`src/lib/creators/partnership-spec.ts`** (murni, dengan test):
  - Kolom: `Username* | Nama Kreator | Platform | Management Partnership | Fee Agreement`.
  - Normalisasi nilai: LINKED/LINK/BINDING, NOT LINKED, LINK REQ, UNLINK REQ, AGREE, DISAGREE, AGREEMENT REQ, CANCELATION/CANCELLATION REQ.
  - Platform kosong → tiktok.
  - Nilai yang tidak dikenal → ditandai di hasil, tanpa crash.
  - Template .xlsx dibangun dari daftar kolom yang sama (pola `src/lib/creators/import-template.ts`), dijaga test round-trip.
  - Rule murni `isPartnershipRegression(old, new)`:
    - partnership → unlink_req/not_linked;
    - fee dari agree → disagree/cancellation_req.
- Tambah tabel baru ke `src/lib/supabase/types` (atau file tipe DB yang dipakai repo) secara manual, mengikuti pola.

### T5 — Upload Excel status kemitraan
- **Blokir:** T4. **PR:** gabungan Partnership.
- **Langkah:**
  1. Permission baru `creators.partnership_upload` = Management + `cm_lead` + `acquisition_lead`.
  2. Server action `uploadPartnershipStatus`:
     - parse file;
     - cocokkan `(lower(username), platform)` via `normalizeUsername()` (`src/lib/creators/username.ts`). Username tidak ditemukan → dilewati + dilaporkan, tidak membuat kreator (aturan 0049);
     - bandingkan dengan status lama, lalu upsert;
     - `audit_logs`: regresi → `platform_alert` + baris `platform_alerts` (alert_type `partnership_drop`) untuk CM pemilik; perubahan lain → `auto`.
  3. Panel upload di `/creators` (pola `creator-import-panel.tsx`): tombol Download Template dan ringkasan hasil (cocok / tak dikenal / berubah / alert).

### T6 — CM Workspace: section "Kreator Saya — Kontrak & Status Kemitraan"
- **Blokir:** T2, T3, T4. **PR:** gabungan Partnership.
- **Lokasi:** `src/app/(portal)/workspace/cm/page.tsx` + komponen baru `cm-creator-status-table.tsx`.
- **Scope:** sama dengan query kreator CM yang sudah ada (CPM = `owner_cpm_id`). Tambah `contract_end_date` ke select.
- **Kolom:** Kreator | Sisa Kontrak | Management Partnership | Fee Agreement (Shopee "—") | Portal (tombol T2) | Aksi (form Perpanjang T3).
- **Alert merah** untuk bucket danger/expired (≤ `danger` dari app_config, BUKAN angka 30 di-hardcode):
  - banner "N kreator kontraknya habis ≤{danger} hari";
  - baris kreator yang terkena diberi warna merah.
- **Badge status:**
  - hijau: linked / agree
  - kuning: link_req / agreement_req
  - merah: unlink_req / not_linked / disagree / cancellation_req
  - abu "Belum ada data": kreator belum ada di file

### T7 — /creators/[id] kartu + /creators kolom
- **Blokir:** T2, T4. **PR:** gabungan Partnership.
- **/creators/[id]:** kartu "Kontrak & Kemitraan" berisi sisa kontrak (merah jika ≤ danger), badge Partnership + Fee Agreement, dan waktu upload terakhir.
- **/creators (`creators-table.tsx`):** dua kolom baru Partnership & Fee Agreement, dengan badge yang sama dan bisa difilter.

### T8 — FINAL: terapkan migrasi 0083 lalu merge PR Partnership
- **Blokir:** semua tiket lain selesai, dan PR Partnership hijau.
- **Langkah:**
  1. Cek `list_migrations` di project Supabase untuk memastikan 0083 belum ada.
  2. `apply_migration` dengan isi file 0083 persis.
  3. Jalankan `get_advisors` (security) dan pastikan tidak ada tabel baru tanpa RLS.
  4. Merge PR Partnership, lalu verifikasi halaman /creators, /creators/[id], dan /workspace/cm tidak error.

### Asumsi default (dipakai jalan dulu, dikonfirmasi di akhir)
- A1: Shopee Management Partnership memakai 4 nilai yang sama dengan TikTok.
- A2: Upload status hanya boleh oleh Management + CM Lead + Acquisition Lead.
- A3: Username yang tidak ditemukan dilewati (tidak dijadikan prospek).
- A4: Regresi status = alert ke CM pemilik (tidak ada approval).

### Verifikasi per tiket
- `npm run typecheck && npm run lint && npm test && npm run build` wajib hijau sebelum push.
- Test baru:
  - `tracking.test.ts`
  - `partnership-spec.test.ts` (normalisasi, round-trip template, regresi)
  - `rbac.test.ts` (m9.invite, partnership_upload)
  - scope CPM
- Kalau memungkinkan, jalankan app (skill `run`) dan cek halaman yang disentuh.
