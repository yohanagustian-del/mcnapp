# Prompt Chat Baru — Build Improvement MCN

Salin seluruh blok di bawah ke chat Claude Code baru pada repo `yohanagustian-del/mcnapp`.

```
Kamu mengerjakan build "Improvement MCN" di repo yohanagustian-del/mcnapp.

SUMBER KEBENARAN
- Baca CLAUDE.md penuh dulu.
- Lalu baca docs/plans/IMPROVEMENT_MCN_2026-09.md. Kalau file itu belum ada di
  main, ambil dari branch claude/hopeful-pascal-yr147k:
  git fetch origin claude/hopeful-pascal-yr147k &&
  git show origin/claude/hopeful-pascal-yr147k:docs/plans/IMPROVEMENT_MCN_2026-09.md
- Plan itu SUDAH disetujui user. Jangan tanya ulang keputusan Q1–Q4.

ATURAN KERJA
1. Ambil tiket otomatis. Kerjakan setiap tiket T1–T8 yang statusnya terbuka
   dan tidak terblokir, tanpa menunggu user. Urutan: T1, T2, T3 (bebas, boleh
   paralel lewat subagent), lalu T4 → T5 → T6 → T7, dan T8 paling akhir.
   Pakai TaskCreate/TaskUpdate untuk melacak status tiket. Kalau sebuah tiket
   butuh keputusan user, tandai "menunggu keputusan", pakai asumsi default dari
   plan bila ada, lalu lanjut ke tiket lain. Jangan berhenti.

2. Auto-merge saat CI hijau. User memberi izin eksplisit: PR boleh di-merge
   tanpa persetujuannya. Kamu juga diizinkan membuat branch per PR dengan
   awalan claude/mcn-.
   - T1, T2, dan T3 masing-masing punya PR sendiri. Merge (squash) begitu hijau.
   - T4–T7 masuk SATU PR "Partnership" (1 commit per tiket). PR ini TIDAK
     di-merge sebelum T8.
   - Repo tidak punya GitHub Actions. "Hijau" berarti:
     (a) npm run typecheck && npm run lint && npm test && npm run build
         lolos di lokal sebelum push, DAN
     (b) semua status check di PR (Vercel, Claude Approvals bila ada)
         sukses di head commit terakhir.
   - Kalau check merah, perbaiki dan push lagi. Jangan skip atau disable test.
   - Sebelum mulai tiket berikutnya yang bergantung, rebase atau merge main
     terbaru.

3. Jaga konteks tetap ramping.
   - 1 tiket = 1 unit kerja.
   - Eksplorasi lebar lewat subagent Explore; ambil kesimpulannya saja.
   - Baca file besar per bagian, jangan utuh.
   - Setelah tiket selesai, tulis ringkasan 3 baris di TaskUpdate agar tetap
     bisa dilanjutkan setelah konteks dirangkum.

4. Pertanyaan ke user HANYA di akhir. Setelah tidak ada lagi tiket yang bisa
   dikerjakan, kirim SATU pesan penutup berisi:
   - Status tiap tiket (selesai / PR + link / menunggu).
   - Semua pertanyaan yang butuh keputusan user. Untuk setiap pertanyaan:
     konteks singkat, contoh kasus konkret (mis. "kreator @abc status
     LINKED → UNLINK REQ, sekarang muncul alert merah ke CPM-nya"), opsi,
     rekomendasi kamu beserta alasannya, dan asumsi yang sedang dipakai.
     Asumsi A1–A4 di plan wajib ikut dikonfirmasi di sini.

5. Migrasi DIJALANKAN TERAKHIR.
   - Selama T4–T7, migrasi hanya ditulis sebagai file
     supabase/migrations/0083_*.sql. JANGAN apply ke database.
   - Di T8 (setelah semua tiket lain selesai dan PR Partnership hijau):
     cek list_migrations, apply_migration via Supabase MCP, cek get_advisors
     (security), lalu langsung merge PR Partnership. Setelah itu verifikasi
     halaman /creators, /creators/[id], dan /workspace/cm tidak error.
   - Kalau apply gagal, JANGAN merge. Masukkan error-nya ke pertanyaan akhir.

ATURAN TETAP DARI CLAUDE.md YANG WAJIB DIPATUHI
- Threshold dari app_config, tanpa hardcode.
- Tabel baru wajib punya RLS + restrictive deny is_creator_user().
- Setiap mutasi menulis audit_logs (auto | approval | platform_alert).
- Tanpa LLM di jalur ini.
- UI berbahasa Indonesia, kode dan komentar berbahasa Inggris.
- Satu sumber logika: pakai ulang contract.ts, contract-renewal.ts,
  assertCreatorInScope, dan normalizeUsername. Jangan membuat versi kedua.
```
