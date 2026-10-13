# Prompt Eksekusi — Revisi BizDev (mode full-auto)

Salin seluruh blok di bawah garis sebagai pesan PERTAMA di chat Claude Code baru (web, repo
`yohanagustian-del/mcnapp`). Sebelum mengirim, pastikan:

1. Branch `main` sudah memuat PR #105 (file `docs/plans/REVISI_BIZDEV_2026-10.md` dan
   `.claude/settings.json` berisi `"model": "opus"` + `"autoCompactWindow": 600000`). Kalau PR #105
   belum di-merge, merge dulu — sesi cloud hanya membaca `.claude/settings.json` yang sudah
   ter-commit.
2. Di environment cloud (dialog environment claude.ai/code), tambahkan variabel
   `CLAUDE_CODE_AUTO_COMPACT_WINDOW=600000` — ini jalur resmi untuk sesi cloud; nilai harus angka
   bulat polos. Setting di repo adalah cadangan untuk CLI lokal.
3. Kalau model sesi belum Opus, kirim `/model opus` sebagai pesan kedua, lalu `/context` untuk
   memastikan batas compaction ±600k.

---

Baca `CLAUDE.md`, `HANDOFF.md`, dan `docs/plans/REVISI_BIZDEV_2026-10.md` sampai habis sebelum
menulis kode apa pun. Plan itu sudah DISETUJUI dan semua keputusan interview Q1–Q6 di §0 sudah
dijawab — jangan tanya ulang.

## Mode kerja: FULL-AUTO, 1 tiket = 1 PR, tanpa jeda konfirmasi

Kerjakan tiket T1 → T9 berurutan sesuai tabel ketergantungan di plan §5, lalu T10 terakhir.
Untuk SETIAP tiket:

1. `git fetch origin main && git checkout -B <branch-tiket> origin/main` (nama branch:
   `claude/revisi-bizdev-tN-<slug>`). Satu tiket = satu branch = satu PR.
2. Implementasi sesuai langkah di plan. Patuhi CLAUDE.md tanpa kecuali: 0 LLM di jalur
   deterministik, threshold dari `app_config`, audit_logs untuk semua mutasi, RBAC di server, UI
   Bahasa Indonesia, satu sumber kebenaran (jangan duplikasi engine/parser/view).
3. Verifikasi lokal WAJIB sebelum push: `npx tsc --noEmit` 0 error, `npx vitest run` semua lulus
   (tidak boleh ada test yang di-skip/dihapus untuk meloloskan), `npx next build` sukses.
4. Commit (pesan `feat/fix/docs(scope): …`, tanpa menyebut model AI), push, buat PR ke `main`
   (bukan draft) dengan ringkasan perubahan + cara verifikasi, lalu `subscribe_pr_activity`.
5. **Merge otomatis** begitu CI Vercel (mcnapp + mcnapp-stagging) hijau dan tidak ada konflik:
   **squash merge**, pesan commit = judul PR `(#nomor)`. Jangan menunggu persetujuan saya.
   Kalau CI merah, perbaiki dan push lagi sampai hijau; jangan pernah skip/quarantine test atau
   push commit kosong untuk memicu CI ulang.
6. Setelah merge, langsung lanjut tiket berikutnya dari `origin/main` terbaru — tanpa bertanya.
7. Perbarui tabel "Status tiket" di `docs/plans/REVISI_BIZDEV_2026-10.md` (tambahkan kolom PR +
   status) di PR tiket itu sendiri, supaya dokumen plan selalu mencerminkan keadaan.

Kalau ada hal yang di plan belum jelas dan HARUS diputuskan: JANGAN berhenti. Ambil opsi yang
paling konservatif/sesuai rekomendasi plan, kerjakan, dan catat di daftar **"Keputusan tertunda"**
(file `docs/plans/REVISI_BIZDEV_2026-10.md` §7, buat kalau belum ada) dengan format:
`ID | tiket | pertanyaan | contoh kasus nyata dari kode/data | opsi A/B/C | yang saya ambil +
alasan | dampak kalau diubah`. Keputusan hanya ditanyakan SEKALI di akhir (lihat "Penutup").

## Migrasi & database: dijalankan TERAKHIR

- Migrasi `0087` (T3) hanya DIBUAT sebagai file di T3; **jangan di-apply** sebelum T10.
- Tiket yang kodenya bergantung pada tabel/view baru (T4–T9) tetap dikerjakan dan di-merge:
  halaman harus gagal dengan pesan jelas ("Migrasi 0087 belum di-apply") bukan crash, mengikuti
  pola `generateReport` M2 saat `app_config` belum ada. Test memakai fake-supabase/fixture, bukan
  DB sungguhan.
- T10: apply lewat `apply_migration` (Supabase MCP) ke staging `fomlangoiiywhexwoqom` → verifikasi
  SQL (`information_schema`, policy deny `is_creator_user()`, view ter-create) + `get_advisors`
  security tanpa temuan baru → lalu **production `bqknstylbpwsnlgnzayw` otomatis** (keputusan user
  2026-10-13), diverifikasi dengan cara yang sama. **JANGAN PERNAH `supabase db push`** (drift ledger,
  lihat HANDOFF 2026-09-12). Backfill SQL (platform Shopee, seed `brand_bizdev_handlers`) dijalankan
  di T10 lewat `execute_sql`, staging dulu lalu production, dan hasilnya dicatat (jumlah baris).
- Upload ulang file mingguan September W1–W5 (Q6) TIDAK bisa Anda lakukan — file ada di komputer
  saya. Sebutkan di laporan akhir sebagai tindakan saya, lengkap dengan urutan file yang perlu
  diupload dan cara memverifikasi hasilnya di UI.

## Pelaporan

- Jangan kirim pesan per tiket. Kirim ringkasan singkat hanya saat: (a) satu tiket selesai di-merge
  (satu baris: nomor PR + apa yang berubah), (b) ada blokir yang benar-benar tidak bisa diatasi
  sendiri (akses ditolak, CI merah karena layanan di luar repo, dsb.).
- Jaga context: jangan membaca file besar utuh kalau cukup `grep`/`sed -n`; jangan tempel output
  test penuh ke chat, cukup ringkasan angka lulus/gagal.

## Penutup (setelah T10 selesai)

Kirim SATU pesan akhir berisi:

1. Tabel status semua tiket (PR, merged, migrasi applied staging/prod).
2. **Daftar "Keputusan tertunda"** — tiap item: pertanyaan, contoh kasus nyata (ambil dari data
   produksi/kode, bukan hipotesis), opsi, rekomendasi Anda, dan apa yang sudah terlanjur diterapkan.
   Format sebagai pertanyaan pilihan ganda supaya saya cukup menjawab satu kali ("1A, 2C, 3B").
3. Daftar tindakan saya: upload ulang file September, cek UI per role (BizDev, CM, Management),
   dan apa yang harus terlihat setelahnya.
4. Perbarui `HANDOFF.md` (sesi baru di paling atas) dan `CLAUDE.md` (#4, #6, #9 sesuai plan T10)
   di PR terakhir sebelum pesan penutup.

Setelah saya menjawab keputusan tertunda, terapkan jawaban yang berbeda dari asumsi Anda sebagai
PR lanjutan dengan aturan yang sama (verifikasi → PR → merge otomatis), lalu laporkan sekali lagi.
