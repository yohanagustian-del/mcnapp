# Tutorial — Data & Report Live dari Jadwal Live

Untuk tim CM / Creator Support / BizDev. Fitur ini **opsional per slot**: slot jadwal
boleh selamanya tanpa data live. Buat report hanya untuk live yang memang mau dievaluasi.

## 0. Belum punya file asli? Pakai file contoh

Selama export TikTok sungguhan belum tersedia, file contoh bisa dibuat sendiri:

```bash
npx tsx scripts/gen-sample-live-files.ts ./sample-live {username} {YYYY-MM-DD}
```

Menghasilkan 4 file (2 sesi × Product + Trend Stats) dengan header, nilai, dan nama
file persis seperti export aslinya — langsung bisa di-drop ke form upload. Isinya
data karangan yang deterministik, jadi aman dipakai di staging. Skrip itu mencetak
juga apa yang **seharusnya** terlihat setelah upload, supaya hasilnya bisa dicocokkan.

## 1. Siapkan file dari TikTok LIVE Center

Per sesi live ada dua file `.xlsx`:

| File | Isi |
|---|---|
| **Product** | daftar produk + GMV, order, item, impresi & klik produk |
| **Trend Stats** | alur 30 menit: GMV, penonton, like, komentar, share, follower baru |

Penamaan file harus memuat **username kreator**, **"Sesi {n}"**, dan **tanggal**, contoh:

```
tesakun Sesi 1, 17 September 2026.xlsx
tesakun_Sesi_1__17_September_2026.xlsx
```

Boleh ada kata lain di antaranya. Mana yang Product dan mana yang Trend Stats dideteksi
otomatis dari **isi** file — bukan dari namanya.

## 2. Buka halaman slotnya

Dari kalender **Jadwal Live** (`/schedule`), klik **“Data & report live →”** di bawah blok
slot. Link ini hanya muncul untuk slot yang:

- bukan **OFF** dan bukan **“Tidak jadi live”**, dan
- tanggalnya **sudah lewat atau hari ini** (live yang belum terjadi tidak punya data).

Link yang sama juga ada di pojok kanan atas form Edit Slot.

## 3. Unggah → Pratinjau → Simpan

1. Drop file Product + Trend Stats (boleh beberapa sesi sekaligus).
2. Klik **Pratinjau**. Sistem menjalankan pemeriksaan V1–V7 (kecocokan username, tanggal
   ±1 hari dari tanggal slot, selisih GMV Product vs Trend, file kembar, dll.).
   - **Hijau** — aman disimpan.
   - **Kuning** — perlu dicentang + alasan sebelum bisa disimpan.
   - **Merah** — tidak bisa disimpan sampai temuannya diselesaikan.
3. **Pratinjau belum menyimpan apa pun.** Klik **Simpan Sesi (n)**.

> Satu file live hanya boleh dipegang satu pemilik. Kalau file yang sama sudah diunggah ke
> sebuah Special Project, V4 akan menolak dan menyebut project/slot pemegangnya.

Salah unggah? Klik **Batalkan** pada baris sesi — angkanya langsung keluar dari report,
dan nomor sesi itu bebas dipakai ulang.

## 4. Generate report

Klik **Generate Report** (butuh izin `reports.generate`). Report berisi angka sesi, alur
30 menit, funnel, produk, dan catatan performa deterministik — **0 token AI**.

Klik **Segarkan Report** setelah menambah/membatalkan sesi supaya angkanya ikut berubah.

## 5. Finalkan

Di halaman report, isi **catatan tim untuk kreator** (opsional, ditulis manusia) lalu klik
**Finalkan Report** (izin `reports.finalize`). Setelah final:

- report terkunci,
- kreator bisa membacanya sendiri di **Portal Kreator → Report Saya**.

## Yang perlu diingat

- Badge di kalender (`📊 2 sesi · Report final`) menunjukkan slot mana yang sudah punya data.
- CPM hanya bisa membuka & mengunggah data kreator yang dipegangnya sendiri.
- Sesi live dari Jadwal Live juga dipakai **Report Kreator (M2)** — bagian
  “Live Performance” dan “Analisa Live Terbaik” hanya terisi kalau file sesinya diunggah
  di sini. Sesi milik Special Project sengaja TIDAK ikut (konteksnya terpisah).
