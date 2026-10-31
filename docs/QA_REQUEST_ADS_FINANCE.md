# QA Manual — Request Ads & Finance (produksi)

Checklist untuk Yohan + tim sebelum fitur dipakai harian. Alur & keputusan: `docs/TUTORIAL_REQUEST_ADS_FINANCE.md`,
`docs/DECISIONS.md` D-2026-10-31-1…7.

## Yang sudah di-QA otomatis (2026-10-31)

| Lapisan | Hasil |
|---|---|
| Aturan & izin per role (`src/lib/m10/__tests__/qa-flow.test.ts`, skenario S1–S6) | Lulus |
| Database staging: S1–S5 + margin Special Project, dijalankan lalu di-rollback | Lulus, tidak ada data tersisa |
| Skema produksi 0100 (kolom, tabel, view, policy, trigger, config, alert, cron) | Lulus |
| Deploy produksi = commit PR #140 (`a4dcb41`) | READY |
| Akun Finance Endang Puji Astuti (role `finance`, aktif, sudah login) | OK |

Yang **belum** bisa diuji mesin dan perlu manusia: tampilan halaman, tombol yang muncul per role,
PDF invoice, dan badge sidebar. Itulah isi checklist di bawah.

## Persiapan (5 menit)

**Akun yang dipakai**

| Peran QA | Akun | Catatan |
|---|---|---|
| Pemohon | CM Lead atau CPM | CPM hanya bisa memilih kreator miliknya |
| Head | Yohan (Director) atau Head | set jatah, approval Director |
| Finance | Endang | ACC cash, catat uang masuk, invoice |
| Executor | Creator Support | klaim, input realisasi, selesai |

Yohan (Director) bisa menjalankan hampir semua langkah sendiri. Akun lain tetap diperlukan untuk
**cek negatif** (role yang TIDAK boleh melakukan sesuatu).

**Data uji di produksi:** semua yang dibuat akan tercatat permanen di audit log, dan nomor invoice
tidak pernah dipakai ulang. Jadi:
- Pakai **1 kreator uji** dan nominal kecil (mis. Rp10.000).
- Isi catatan/pembayar dengan awalan **`QA -`** supaya mudah dikenali.
- Setelah selesai, **batalkan** request & invoice uji (langkah 7), dan set jatah kreator uji kembali ke 0.

---

## Langkah QA

### 1. Jatah Budget MEA (akun Head/Director)
1. Buka **Request Ads → Jatah Budget MEA**.
2. Pilih kreator uji, isi jatah **Rp20.000**, catatan `QA - jatah uji`, Simpan.
- [ ] Muncul "Jatah tersimpan." dan baris kreator dengan Jatah 20.000, Terpakai 0, Sisa 20.000.
- [ ] Login sebagai CM Lead: halaman ini **tidak bisa** mengisi jatah (form tidak muncul / ditolak).

### 2. Request Budget MEA dari slot Jadwal Live (akun CM/CPM)
1. Buka **Jadwal Live**, pilih slot kreator uji (buat slot dulu bila belum ada, lalu **simpan**).
2. Buka lagi slot itu, klik tautan **+ Request Ads untuk slot ini →**. Tipe pendanaan **Budget MEA**, nominal **Rp10.000**,
   objektif `QA - test`, kirim.
- [ ] Form menampilkan "Jatah Budget MEA … terpakai … sisa Rp20.000" sebelum dikirim.
- [ ] Request tersimpan dengan status **Menunggu ACC**.
- [ ] Di kalender, slot menampilkan `Ads: Budget MEA · Menunggu ACC`.
- [ ] Di **CM Workspace → Jadwal Live (hari ini & besok)** (bila slotnya hari ini/besok), kolom **Request Ads**
      menampilkan label yang sama dan bisa diklik ke detail request; kolom **Nominal / Catatan Ads** = Rp10.000.
- [ ] (CPM) Kreator milik CPM lain **tidak bisa** dipilih/diajukan.

### 3. Melebihi jatah → approval Director + alert jatah habis
1. Masih sebagai CM, ajukan request Budget MEA kedua untuk kreator yang sama, nominal **Rp15.000**
   (total 25.000 > jatah 20.000).
- [ ] Muncul pesan jatah tersisa Rp10.000 dan request melebihi → status **Menunggu approval Director**.
- [ ] Akun Head/Director: halaman **Jatah Budget MEA** menampilkan panel kuning **"Jatah habis bulan ini"**
      untuk kreator uji, dan badge menu **Request Ads** bertambah.
2. Login Director → buka request tsb → **Approval Director** → **Tolak** dengan alasan `QA - tolak`.
- [ ] Status **Ditolak**; terpakai kembali 10.000; panel "Jatah habis" **hilang** (alert tertutup sendiri).
- [ ] Head (bukan Director) **tidak** melihat tombol Setujui/Tolak Director.

### 4. ACC & eksekusi request Budget MEA (Head CM → Creator Support)
1. Akun CM Lead/Head: buka request langkah 2 → **ACC request** → **ACC**.
- [ ] Status **Siap dieksekusi**; tidak ada invoice yang terbit (Budget MEA tidak ditagihkan).
2. Akun Creator Support: menu **Request Ads** → tab **Antrean eksekusi** → buka request → **Klaim & mulai kerjakan**.
- [ ] Status **Dikerjakan**; badge Request Ads di akun Creator Support berkurang.
3. **Input realisasi**: periode hari ini, Ads spent `10000`, GMV `0`, **Simpan realisasi**.
4. **Selesaikan request** → **Tandai selesai**.
- [ ] Status **Selesai**; tombol batal tidak ada lagi.
- [ ] Mencoba **Tandai selesai** sebelum ada realisasi → ditolak dengan pesan "isi minimal satu baris hasil".

### 5. Creator/Brand Budget — cash di awal (Finance)
1. Akun CM: buat request dari slot lain (atau dari Special Project), pendanaan **Creator Budget**,
   metode **Cash di awal**, pembayar `QA - kreator`, nominal Rp10.000.
- [ ] Akun CM Lead/Head: tombol **ACC** untuk request ini **tidak muncul / ditolak** ("ACC pembayaran cash hanya oleh Finance").
2. Akun **Endang (Finance)**: menu **Finance Ads & Penagihan** → **Antrean ACC request ads** → **Proses**.
- [ ] Mencoba ACC tanpa tanggal uang masuk → ditolak ("pembayaran cash belum tercatat").
3. **Catat uang masuk (cash di awal)** → isi tanggal hari ini → simpan, lalu **ACC**.
- [ ] Status **Siap dieksekusi**; kolom **Uang masuk** di halaman Finance terisi; tidak ada invoice.
- [ ] Endang **tidak bisa** membuat request ads (menu Request Ads tidak menampilkan tombol buat request).

### 6. Brand Budget — invoice (Head CM ACC, Finance menagih)
1. Akun CM/BizDev: buat request pendanaan **Brand Budget**, metode **Invoice**, pembayar `QA - brand`, nominal Rp10.000.
2. Akun CM Lead/Head (atau Endang): **ACC request** → **ACC**.
- [ ] Muncul pesan **"Invoice INV-YYYYMM-NNNN terbit"**.
- [ ] Halaman Finance → **Invoice & piutang**: DPP 10.000, **PPN 1.100**, **Total 11.100**, jatuh tempo = hari ini + 14 hari.
3. Klik **PDF**.
- [ ] PDF terunduh dan memuat nomor invoice, pembayar, DPP, PPN, total, dan jatuh tempo
      (layout masih sementara sampai template resmi masuk; yang dicek isinya).
4. Akun Endang: buka invoice → **Kirim tagihan** → **Catat sudah dikirim** (WhatsApp).
5. **Catat pembayaran** nominal **10.000** (kurang dari total).
- [ ] Ditolak: invoice hanya lunas bila dibayar penuh.
- [ ] Akun CM Lead **tidak** melihat tombol catat pembayaran/kirim/batal invoice.
- [ ] Riwayat invoice menampilkan event *dibuat* dan *dikirim* berurutan, tanpa tombol edit/hapus.

### 7. Bersih-bersih data uji
1. Akun Endang: invoice langkah 6 → **Batalkan invoice**, alasan `QA - data uji`.
- [ ] Status invoice **Batal**; badge Finance tidak menghitungnya lagi.
2. Request langkah 5 & 6 (masih Siap dieksekusi) → **Batalkan request**, alasan `QA - data uji`.
- [ ] Status **Batal**.
3. Jatah kreator uji → set **0**.

### 8. Special Project (opsional, bila ada project berjalan)
1. Di detail project, panel **Ads project per pendanaan** → **Request Ads** untuk satu peserta.
- [ ] Panel memisahkan baris per pendanaan; hanya **Budget MEA** bertanda "Biaya MEA" dan masuk margin
      **Profitabilitas** (ads brand/kreator/credit = informasi saja).

---

## Cara melapor hasil

Tandai tiap kotak. Untuk yang gagal, catat: **langkah no., akun/role, apa yang terjadi, screenshot**.
Kirim ke sesi Claude ini — perbaikan dikerjakan di PR baru.
