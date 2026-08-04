# Port Kit — Ubah Transaksi Finance dengan Approval Director

**Fallback untuk kasus "app-nya beda repo."**

Mekanisme ini diminta untuk halaman `/finance/transactions/<TRX-...>` di
`web-internal-mea.vercel.app`, yang ternyata dilayani repo **`MEAgrup/AgencyAPP`** — bukan
`mcnapp`. Repo itu tidak bisa dilampirkan ke sesi ini (beda owner:
`cross-tier adds are not supported`), jadi implementasinya dibangun di `mcnapp` sebagai
**implementasi acuan yang berjalan** (PR #15), dan folder ini adalah versi lepasnya:
bisa ditempel ke app mana pun tanpa menyeret schema MCN MEA.

Kalau nanti bisa membuka sesi dengan `MEAgrup/AgencyAPP` sebagai source awal, port ini
tinggal ditempel — bukan dirancang ulang.

## Isi

| File | Isi | Sudah diuji |
|---|---|---|
| `migration.sql` | Tabel, penjaga (trigger), penerap (RPC), nomor transaksi, config | Postgres 16 DB **kosong** + idempotensi (apply 2×) + FK auto-attach dua arah |
| `verify.sql` | Uji-diri 11 skenario; gagal keras kalau penjaganya bocor | 11/11 lulus, baris uji di-rollback (DB bersih) |
| `change-request.ts` | Logika pure: diff, partisi approval/langsung, validasi Rupiah/tanggal/enum | `tsc --strict` bersih **nol dependensi** (tanpa `@/`, tanpa node_modules, tanpa lib DOM) |

---

## 1. Aturannya dulu (jangan lewati bagian ini)

Yang dijaga port ini bukan sekadar "form edit". Intinya:

> Transaksi finance **boleh** diubah — klien nyata memang mengganti metode/rekening
> pembayaran setelah transaksi tercatat. Tapi perubahan yang menyentuh **uang atau tujuan
> uang** tidak berlaku sampai **Director** menyetujuinya, dan tidak ada jalur `UPDATE`
> langsung sama sekali.

Tiga tingkat izin, dipisah sengaja:

| Tingkat | Catat transaksi | Ajukan perubahan | Setujui |
|---|---|---|---|
| Staff finance | ✔ | ✘ | ✘ |
| **Senior/Lead Finance** | ✔ | ✔ | ✘ |
| **Director** | ✔ | ✔ | **✔ (hanya ini)** |
| Head / SPV | ✔ | ✔ | ✘ |

Pengaju ≠ pemutus: Lead Finance tidak pernah bisa menyetujui pengajuannya sendiri.

Alurnya:

```
Lead Finance ubah field ──▶ diff ──┬─▶ field TERKUNCI → pengajuan status `menunggu`
                                   │                    nilai lama TETAP berlaku
                                   │                         ▼
                                   │                  Director approve → apply_finance_change()
                                   │                  Director tolak   → status `ditolak` (+alasan)
                                   └─▶ field BEBAS   → berlaku langsung + audit
```

## 2. Kenapa penjaganya di DB, bukan di server action

Ini keputusan desain yang paling penting untuk dipertahankan saat porting.

App seperti ini biasanya melakukan mutasi lewat **service-role / connection admin** yang
**bypass RLS**. Artinya RLS *tidak* bisa jadi penjaga terakhir: satu `UPDATE` dari server
action mana pun akan lolos. Yang tidak bisa dilewati service-role adalah **trigger**.

Karena itu:

- `guard_finance_txn_update()` menolak **setiap** `UPDATE` yang menyentuh field terkunci
  (errcode `42501`), dari siapa pun, termasuk service-role.
- Satu-satunya jalur sah: `apply_finance_change()`, yang menyetel flag
  **transaction-local** (`set_config(..., true)`) setelah memverifikasi ada pengajuan
  `menunggu`. Flag itu tidak bisa disetel dari luar fungsi tersebut, dan hilang sendiri
  saat transaksi berakhir — `verify.sql` §8 khusus menguji flag itu tidak bocor keluar.

Kalau saat porting kamu tergoda memindahkan validasi ini ke server action saja: jangan.
Di situ tepatnya masalah lama muncul (orang mengubah data langsung di DB, tanpa jejak).

## 3. Langkah port

### Langkah 1 — migration
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration.sql
```
Perhatikan `NOTICE` di §8: FK ke `brand_deals` / `creators` / `special_projects` /
`team_members` **hanya dipasang bila tabel itu ada**. Kalau app tujuan memakai nama lain
(mis. `clients`, `users`), edit tabel nama di blok `values (...)` §8 lalu jalankan ulang —
migration idempotent, aman diulang.

### Langkah 2 — RLS (§9 migration, WAJIB diadaptasi)
Model role tiap app beda, jadi §9 sengaja dibiarkan minimal (`enable row level security`
saja). Apa pun bentuknya, jamin tiga hal:

1. Hanya divisi finance + management yang boleh `SELECT` — baris transaksi memuat
   **rekening tujuan**, jadi ini bukan data yang layak dibuka ke semua staff.
2. **Tidak ada** policy `INSERT`/`UPDATE`/`DELETE` untuk user biasa. Semua mutasi lewat
   server action yang sudah dicek izinnya.
3. Principal eksternal (portal klien/kreator) dan role oversight read-only ditolak.

Contoh lengkap untuk model role MCN MEA: `supabase/migrations/0032_finance_transactions.sql` §7.

### Langkah 3 — logika
Copy `change-request.ts` ke app tujuan (mis. `lib/finance/change-request.ts`). Nol
dependensi, jadi tidak perlu menyesuaikan import.

### Langkah 4 — server action (satu-satunya bagian yang harus ditulis di app tujuan)
Bentuknya bergantung framework/auth host, tapi kontraknya tetap:

```ts
// AJUKAN — izin: Senior/Lead Finance + management (BUKAN staff finance)
const diff = diffTransaction(txn, proposedFromForm);
const { guarded, free } = partitionChanges(diff, await readConfig("finance.guarded_fields"));
const reason = validateReason(formReason);

if (countChanges(free) > 0) {
  // field bebas: UPDATE biasa (trigger tidak menghalangi) + audit "auto"
}
if (countChanges(guarded) > 0) {
  // INSERT ke finance_transaction_changes status 'menunggu' + audit "approval"
  // JANGAN sentuh finance_transactions di sini — itu inti aturannya
}

// PUTUSKAN — izin: Director SAJA
approve
  ? await rpc("apply_finance_change", { p_request_id, p_actor, p_note })   // atomic
  : await update(changes, { status: "ditolak", decision_note /* wajib */ });
```

Empat hal yang mudah salah:
- Baca `finance.guarded_fields` **runtime dari DB**, jangan hardcode. Kalau melenceng,
  UI menyangka suatu field bebas lalu trigger menolaknya — dan config di DB jadi bohong.
- Cek dulu apakah sudah ada pengajuan `menunggu` sebelum insert, supaya user dapat pesan
  jelas, bukan error unique-violation mentah.
- Alasan **penolakan** wajib diisi. Approve boleh tanpa catatan, tolak tidak.
- Tulis audit di **setiap** tahap: ajukan / approve / tolak / batal.

### Langkah 5 — buktikan, jangan diasumsikan
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f verify.sql
```
Ini bukan smoke test "apakah tabelnya ada". Ia menyerang penjaganya dari 11 arah dan
berhenti dengan `ERROR: GAGAL: ...` begitu ada satu yang bocor. Semua baris uji
di-`rollback`, jadi aman dijalankan di staging.

Yang diuji: nomor berurutan · UPDATE langsung 5 field terkunci ditolak · keterangan boleh
langsung · nilai lama tetap berlaku selama menunggu · dua pengajuan menunggu ditolak ·
alasan kosong ditolak · approve menerapkan semua sekaligus tanpa menyapu field lain ·
approve dua kali ditolak · flag bypass tidak bocor keluar transaksi · kolom di luar
whitelist tidak bisa diselundupkan · perilaku benar-benar mengikuti config · format
periode divalidasi.

### Langkah 6 — UI
Acuan siap-contek di `mcnapp`:
- `src/app/(portal)/finance/transactions/page.tsx` — daftar, form catat baru, banner pengajuan menunggu
- `src/app/(portal)/finance/transactions/[id]/page.tsx` — detail, panel approval Director (tabel *sekarang → diusulkan*), riwayat, audit trail
- `src/app/(portal)/finance/transactions/[id]/change-request-form.tsx` — form pengajuan, tiap field bertanda `approval` / `langsung`
- `src/app/(portal)/finance/transactions/[id]/not-found.tsx` — fallback nomor transaksi tak ada

## 4. Kalau nama tabel config host berbeda

`migration.sql` memakai `app_config(key text primary key, value jsonb)`. Kalau host punya
tabel config sendiri dengan nama lain, lewati §1 dan ganti tiga kemunculan `app_config`
(§6 fungsi penjaga, §10 seed) dengan nama tabel host. Bentuk nilainya harus tetap **array
JSON berisi nama kolom**, contoh: `["amount","payment_method",...]`.

## 5. Catatan penomoran

`TRX-YYYYMM-NNNN` disengaja, bukan uuid: nomor ini ditempel di invoice dan dipakai saat
rekonsiliasi bank, jadi harus berurutan dan menunjukkan periode. Nomor diambil dari
`next_finance_trx_id(period)` yang memakai `pg_advisory_xact_lock` per bulan — dua input
bersamaan tidak akan dapat nomor sama.

Konsekuensi yang perlu diketahui saat QA: **`TRX-202608-0001` adalah transaksi pertama
yang dicatat di Agustus 2026.** Nomor itu tidak bisa "dibuat" dengan mengetiknya di URL —
catat satu transaksi lewat form, dan nomor itu muncul sendiri.
