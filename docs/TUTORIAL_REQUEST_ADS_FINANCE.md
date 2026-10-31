# Tutorial — Request Ads & Finance (Jadwal Live + Special Project)

Untuk CM / BizDev / Campaign Ops (pemohon), Creator Support (executor), Head CM & Finance (ACC),
Director (approval lewat jatah). Keputusan: `docs/DECISIONS.md` D-2026-10-31-1…7.

## 1. Alur singkat

```
Pemohon ajukan ──(Budget MEA lewat jatah?)──▶ Director setujui/tolak
        │                                            │
        └────────────────────────────────────────────▼
                                             Menunggu ACC
                      cash di awal → Finance catat uang masuk → Finance ACC
                      invoice / Budget MEA / TikTok credit → Head CM atau Finance ACC
                      (invoice PDF terbit otomatis saat ACC untuk pendanaan invoice)
                                                     ▼
                       Siap dieksekusi → Creator Support klaim → input realisasi → selesai
```

## 2. Mengajukan request (CM / BizDev / Campaign Ops)

1. **Dari Jadwal Live**: buka slot (klik di kalender) → di bagian *Ads* klik **+ Request Ads untuk slot ini**.
   Kreator & tanggal otomatis dari slot. Slot OFF / tidak jadi live tidak bisa diberi request.
2. **Dari Special Project**: halaman project → panel *Ads project per pendanaan* → **+ Request Ads**,
   atau tombol **+ Request Ads** di baris peserta (untuk Budget MEA wajib memilih kreator peserta).
3. Isi **tipe pendanaan**:
   - **Budget MEA** — jatah per kreator per bulan (lihat sisa di form). Melebihi sisa → approval Director.
   - **Creator Budget / Brand Budget** — pilih **Cash di awal** atau **Invoice**; isi nama pembayar.
   - **TikTok Ads Credit** — kredit platform, tanpa uang.
4. Nominal, objektif, catatan untuk executor → **Ajukan**. CPM hanya bisa untuk kreator yang dipegangnya.
5. Pantau di menu **Request Ads** (tab *Request saya*). Request bisa dibatalkan selama belum dikerjakan.

## 3. ACC (Head CM / Finance)

- Menu **Finance** (Finance, Head, CM Lead, management) → *Antrean ACC request ads* → **Proses**.
- **Cash di awal**: Finance mengisi **tanggal uang masuk** (form *Catat uang masuk* atau langsung di form ACC).
  Tanpa itu, ACC ditolak sistem: `[pembayaran cash belum tercatat, isi tanggal uang masuk sebelum ACC]`.
  ACC cash hanya oleh Finance.
- **Invoice**: Head CM atau Finance klik **ACC** → invoice `INV-YYYYMM-NNNN` terbit otomatis
  (DPP = budget disetujui, PPN otomatis), eksekusi boleh jalan sebelum lunas.
- **Budget MEA / TikTok credit**: Head CM atau Finance klik **ACC**.
- Tolak = alasan wajib; request ditutup.

## 4. Eksekusi (Creator Support)

1. Menu **Request Ads** → tab *Antrean eksekusi* → buka request → **Klaim & mulai kerjakan**.
2. Setelah ads jalan: **Input realisasi** per periode (ads spent wajib; GMV/ROAS/CPM/CTR/CVR opsional).
   `ads_spent` inilah sumber tunggal biaya ads — untuk Special Project otomatis masuk metrik harian
   (hanya Budget MEA yang mengurangi margin MEA).
3. **Tandai selesai** (butuh minimal satu baris realisasi). Status terkunci.

## 5. Penagihan & pembayaran (Finance)

- Menu **Finance** → *Invoice & piutang*: baris kuning = segera jatuh tempo (H-3), merah = lewat.
  Badge di sidebar menghitung yang sama.
- Buka invoice → **Unduh PDF** → kirim ke kreator/brand lewat WA/email (teks tagihan siap salin) →
  **Catat sudah dikirim**.
- Uang masuk → **Catat pembayaran** (tanggal bayar, nominal penuh, link bukti) → status **Lunas**.
- Salah terbit → **Batalkan invoice** (alasan wajib); nomor tidak dipakai ulang. ACC ulang request
  menerbitkan invoice baru bila perlu.
- Pengingat otomatis (job harian 06:00 WIB) menulis alert `ads_invoice_due` / `ads_invoice_overdue` dan
  event *Pengingat sistem* di riwayat invoice.

## 6. Jatah Budget MEA (Head / Director)

Menu **Request Ads** → **Jatah Budget MEA** → pilih bulan → isi kreator (ID), nominal, catatan.
Tanpa baris = 0. Sisa bulan hangus. Tabel menampilkan jatah, terpakai (request yang tidak batal/ditolak),
sisa; kreator yang memakai jatah tanpa baris ikut tampil dengan jatah 0.

Begitu terpakai mencapai jatah (jatah > 0), muncul alert **"Jatah habis bulan ini"** di halaman ini dan
badge menu Request Ads (Head/Director). Alert tertutup sendiri saat jatah dinaikkan atau request Budget
MEA kreator itu dibatalkan/ditolak. Request berikutnya tetap bisa diajukan — langsung masuk approval Director.

Di CM Workspace & BizDev Workspace, kolom **Request Ads** daftar jadwal kini membaca request (pendanaan +
status, klik → detail request) dan kolom **Nominal / Catatan Ads** menampilkan nominal request. Slot lama
tanpa request tetap menampilkan pembayar/catatan lama dengan tanda *(lama)*.

## 7. Yang perlu disiapkan tim

- Buat akun role **finance** di menu Tim untuk Endang Puji Astuti (`endangpujia046@gmail.com`).
- ~~Apply migrasi 0100 ke produksi~~ — sudah di-apply & diverifikasi 2026-10-31.
- Kirim template invoice resmi → ganti layout di `src/lib/m10/invoice-pdf.ts`.
