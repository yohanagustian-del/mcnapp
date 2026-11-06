# Tutorial — Request Ads: metode pembayaran "Ads by Brand" (6 Nov 2026)

Salinan section yang di-append ke Google Doc **Tutorial MCN** (dokumen tidak ditimpa; changelog di atas +
section baru). Melanjutkan `docs/TUTORIAL_REQUEST_ADS_FINANCE.md`.

## Changelog (baris baru di atas)

- **6 Nov 2026**: Live — Request Ads metode pembayaran **Ads by Brand** (Brand Budget, tanpa ACC
  Finance/Head CM/Director). Permintaan Adinda. PR #143, migrasi 0101. Keputusan D-2026-11-06-1
  (mengganti sebagian D-2026-10-31-3).

---

## Request Ads: metode pembayaran "Ads by Brand" (PR #143, merge 6 Nov 2026)

**Status:** Live sejak 6 Nov 2026. Butuh migrasi 0101 di produksi — kalau belum di-apply, form
menolak dengan pesan *"Migrasi 0101 (metode Ads by Brand) belum di-apply di environment ini…"*;
pilih Cash di awal / Invoice dulu dan minta developer meng-apply migrasinya.

**Diminta oleh:** Adinda (6 Nov 2026).

**Untuk:** CM / BizDev / Campaign Ops (pemohon), Creator Support (executor). Finance, Head CM, dan
Director **tidak** perlu melakukan apa pun untuk request jenis ini.

**Keputusan:** `docs/DECISIONS.md` **D-2026-11-06-1** — mengganti sebagian **D-2026-10-31-3**.
Sebelumnya Brand Budget hanya punya dua metode (Cash di awal / Invoice). Sekarang ada metode ketiga,
**Ads by Brand**, khusus Brand Budget.

### 1. Apa itu Ads by Brand

Brand **menjalankan dan membayar ads sendiri** (pakai akun/saldo iklan brand). Tidak ada uang yang
lewat MEA, tidak ada piutang, tidak ada biaya MEA. Karena tidak merugikan perusahaan, request ini
**berlaku otomatis** (pola "auto"): tetap tercatat di audit log, tapi tidak antre ACC.

### 2. Kapan memilih metode apa (khusus Brand Budget)

| Situasi | Pilih | Yang terjadi |
|---|---|---|
| Brand transfer dana ads ke MEA **sebelum** ads jalan | **Cash di awal** | Finance catat uang masuk → Finance ACC → eksekusi |
| Brand dibayar belakangan, MEA yang menjalankan ads dulu | **Invoice (bayar belakangan)** | Head CM / Finance ACC → invoice PDF terbit otomatis → eksekusi → Finance tagih |
| Brand pakai **akun/saldo ads brand sendiri**, MEA tidak menerima/menagih uang | **Ads by Brand (tanpa ACC)** | Langsung *Siap dieksekusi* → Creator Support klaim |

Patokan cepat: **ada uang yang harus masuk ke MEA?** Ya → Cash di awal atau Invoice. Tidak → Ads by Brand.

Creator Budget **tidak** punya pilihan Ads by Brand (tetap Cash di awal / Invoice). Budget MEA dan
TikTok Ads Credit tidak berubah.

### 3. Alur singkat

```
Pemohon ajukan (Brand Budget · Ads by Brand)
        │   (tanpa Director, tanpa Finance, tanpa Head CM, tanpa invoice)
        ▼
Siap dieksekusi → Creator Support klaim → input realisasi → selesai
```

### 4. Mengajukan request (CM / BizDev / Campaign Ops)

1. Buka form Request Ads seperti biasa:
   - **Dari Jadwal Live**: klik slot di kalender → bagian *Ads* → **+ Request Ads untuk slot ini**.
   - **Dari Special Project**: halaman project → panel *Ads project per pendanaan* → **+ Request Ads**.
2. **Tipe pendanaan** → pilih **Brand Budget**.
3. **Metode pembayaran** → pilih **Ads by Brand (tanpa ACC)**. Di bawahnya muncul keterangan:
   *"Brand menjalankan/membayar ads sendiri — tanpa ACC Finance/Director dan tanpa invoice; request
   langsung masuk antrean eksekusi."*
4. Isi **Nominal budget ads (Rp)** (budget yang akan dipakai brand — untuk catatan & realisasi),
   **Nama brand yang membayar**, **Objektif / produk yang di-ads**, dan **Catatan untuk executor**
   (mis. akun ads brand yang dipakai, jam ads, link produk).
5. Klik **Ajukan**. Request langsung berstatus **Siap dieksekusi**. Badge-nya tampil
   *"Brand Budget · Ads by Brand"*.
6. Pantau di menu **Request Ads** → tab *Request saya*. Selama belum diklaim executor, request masih
   bisa **Dibatalkan**.

CPM tetap hanya bisa mengajukan untuk kreator yang dipegangnya.

### 5. Apa yang TIDAK perlu di-ACC / tidak terjadi

- **Tidak ada ACC Finance** — request tidak muncul di *Antrean ACC request ads* menu Finance. Kalau
  ada yang mencoba ACC, sistem menolak: `[request Ads by Brand tidak memerlukan ACC]`.
- **Tidak ada ACC Head CM / CM Lead.**
- **Tidak ada approval Director** (approval Director hanya untuk Budget MEA yang melewati jatah).
- **Tidak ada cek uang masuk** (tanggal uang masuk tidak perlu diisi Finance).
- **Tidak ada invoice** — tidak terbit `INV-…`, tidak masuk *Invoice & piutang*, tidak ada pengingat
  jatuh tempo.
- **Tidak memotong jatah Budget MEA** dan **tidak mengurangi margin Special Project** (yang mengurangi
  margin hanya Budget MEA).

Yang **tetap** berjalan: audit log tiap langkah, eksekusi oleh Creator Support, input realisasi, dan
tampilan di kalender Jadwal Live / CM & BizDev Workspace.

### 6. Eksekusi (Creator Support)

Sama seperti request lain:

1. Menu **Request Ads** → tab *Antrean eksekusi* → buka request (badge *Brand Budget · Ads by Brand*)
   → **Klaim & mulai kerjakan**.
2. Koordinasikan dengan brand sesuai *Catatan untuk executor* (ads dijalankan dari akun/saldo brand).
3. **Input realisasi** per periode (ads spent wajib; GMV/ROAS/CPM/CTR/CVR opsional) — angka ini untuk
   report, bukan biaya MEA.
4. **Tandai selesai** (minimal satu baris realisasi). Status terkunci.

### 7. Hati-hati

- Jangan pilih Ads by Brand kalau sebenarnya brand akan **transfer ke MEA** atau MEA yang **menalangi**
  ads — itu Cash di awal / Invoice. Memilih Ads by Brand membuat request lolos tanpa ACC dan tanpa
  tagihan, jadi uangnya tidak akan tertagih.
- Kalau salah pilih metode: **Batalkan** request (selama belum diklaim), lalu ajukan ulang dengan
  metode yang benar.

### 8. Yang perlu disiapkan tim

- Pastikan migrasi **0101** sudah di-apply di produksi (kalau belum, pilihan Ads by Brand ditolak saat
  Ajukan dengan pesan migrasi di atas).
- Sosialisasikan ke CM/BizDev/Campaign Ops patokan di bagian 2 supaya request yang seharusnya ditagih
  tidak masuk sebagai Ads by Brand.
