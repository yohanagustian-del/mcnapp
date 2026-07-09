# Spesifikasi Output — Agency Leaked Generator (artifak eksternal)

Dokumen ini untuk pembuat/pemelihara tool eksternal "Agency Leaked Generator".
Platform MCN MEA (`/ingest` → "Upload Hasil Artifak Leak") hanya menerima file yang
mengikuti spesifikasi di bawah. Simpang sedikit = upload ditolak dengan pesan error.

## Aturan #1 — SATU FILE PER MINGGU (W1–W5)

Platform menolak file yang periodenya bukan satu minggu skema W1–W5:

| Minggu | Tanggal |
|---|---|
| W1 | tanggal 1–7 |
| W2 | tanggal 8–14 |
| W3 | tanggal 15–21 |
| W4 | tanggal 22–28 |
| W5 | tanggal 29–akhir bulan |

Contoh BENAR: `2026-06-01 to 2026-06-07` (W1 Juni). Contoh SALAH: `2026-05-27 to
2026-06-23` (4 minggu lintas bulan — ini penyebab penolakan QA Juli 2026). Untuk
laporan sebulan, jalankan generator 4–5 kali, satu file per minggu.

## Format v1 (KANONIS — gunakan ini)

Format v1 satu-satunya yang membawa rincian bocor **per kreator**, sehingga status
link kreator (via_agency / bocor_sebagian / bocor_total) bisa dihitung platform.

### File 1 — Leak Detail Report (wajib)

**Sheet 1: `Executive Summary`** — harus ada satu baris di kolom A yang memuat:

```
Period: 2026-06-01 to 2026-06-07 | Generated: <bebas>
```

Tanggal wajib format ISO `YYYY-MM-DD`, dipisah kata ` to `.

**Sheet 2: `Creator_Detail_Sections`** — satu blok per kreator, semuanya di kolom A:

```
▶ CREATOR: bidanlilis77
• Total Affiliate GMV: Rp121.193.930
• Agency Link GMV (TAP): Rp15.000.000
• Bocor (Leak): Rp45.000.000
• Peluang BD (Non-Partnered Shops): Rp60.000.000
• Direct GMV: Rp1.193.930
• Agency Link Effectiveness: 12.4%
```

Aturan blok:
- Marker blok persis `▶ CREATOR: ` diikuti username apa adanya (sesuai platform).
- Bullet diawali `• `, dicocokkan berdasarkan AWALAN label (teks setelah `: ` boleh
  membawa anotasi tambahan, mis. `Rp335.467.486  ← Commission lost`).
- Angka Rupiah boleh titik-ribuan atau koma-ribuan — dua-duanya terbaca.
- Bullet yang hilang → nilai dianggap kosong (tidak bikin gagal), tapi `Bocor (Leak)`
  dan `Total Affiliate GMV` minimal harus ada agar status kreator terhitung.
- Tabel produk di bawah bullet diabaikan platform (detail tetap di Excel).

**Sheet 3: `Leaked_Products_All`** — bebas, diabaikan platform.

### File 2 — BD Opportunity Report (opsional)

**Sheet 1: `BD_Shop_Summary`** — baris header lalu data:

| Kolom | Isi |
|---|---|
| Shop ID | angka 19 digit, WAJIB sebagai teks (jangan sampai jadi notasi ilmiah) |
| Shop Name | teks |
| Level 1 Category | teks |
| Level 2 Category | teks (boleh kosong) |
| GMV Opportunity | angka Rupiah |
| Num Creators | angka |
| Total Products Promoted | angka |

**Sheet 2: `BD_Detail_Per_Shop`** — bebas, diabaikan platform.

## Format v2 (2-tab "MEA Agency Link Intelligence") — diterima, TIDAK disarankan

Platform juga bisa membaca format v2 (`Ringkasan Creator` + `Produk Bocor
(Partnered Shops)`; file BD: `Ringkasan Shop Non-Partnered`). **Keterbatasan serius**:
format ini tidak punya rincian bocor per kreator, jadi platform hanya menyimpan total
level-CM + GMV affiliate per kreator; kolom status link per kreator kosong ("—") di
workspace. Gunakan hanya sebagai jalan darurat; target akhir tetap v1.

## Definisi metrik (harus konsisten dengan platform)

- **Bocor (Leak)** = GMV kreator di shop ber-deal (partnered) MINUS GMV yang lewat
  agency link (TAP/SAP). GMV yang sudah lewat TAP = via_agency, BUKAN bocor.
- **Peluang BD** = GMV kreator di shop yang TIDAK partnered (belum ada deal).
- Ambang status (dihitung platform dari `app_config`, bukan oleh generator):
  ratio bocor ≥ 0.5 → bocor_total; ≥ 0.1 → bocor_sebagian; > 0 → via_agency dengan
  catatan; 0 → via_agency.

## Checklist sebelum kirim file ke platform

1. Periode = satu minggu W1–W5 penuh, format `YYYY-MM-DD to YYYY-MM-DD`.
2. Sheet `Executive Summary` + `Creator_Detail_Sections` ada dengan nama persis.
3. Setiap kreator punya blok `▶ CREATOR:` + minimal bullet Total Affiliate GMV dan
   Bocor (Leak).
4. Shop ID di File 2 berbentuk teks 19 digit (bukan 7.49514E+18).
5. Username kreator sama persis dengan yang terdaftar di platform.
