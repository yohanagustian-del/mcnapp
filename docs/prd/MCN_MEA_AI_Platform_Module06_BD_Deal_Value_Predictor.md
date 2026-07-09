# MCN MEA AI Platform
## Module 6: BD Deal Value Predictor (BizDev Tool)

---

### 1. Background

Alat bantu **BizDev**: saat mempertimbangkan sebuah deal/campaign dengan brand, sistem memproyeksikan **nilai/omzet deal** — perkiraan **GMV campaign kalau jadi dijalankan** — agar BD punya angka acuan untuk negosiasi, targeting ROI, dan keputusan ambil/tolak deal.

**Dasar proyeksi (dari brief):** GMV historis creator **28 hari terakhir** pada **sub-kategori (level-2) yang sama** dan **segmen harga yang sama** dengan produk deal. Creator yang punya track record di kombinasi sub-kategori + segmen harga itu = dasar proyeksi paling relevan.

**Masalah tool lama:** BD Deal Value Predictor lama memakai AI untuk proses yang sebenarnya **deterministik** — agregasi GMV historis creator by sub-kategori & segmen harga, lalu rumus proyeksi. Tidak ada bagian yang butuh reasoning.

**Keputusan arsitektur: REPLACE, 0 token AI.** Sama pola dengan Module 4 & 5. Prediksi = query + agregasi 28 hari + rumus. Konsisten dengan Module 1 §2.4.

**Shared engine:** proyeksi GMV di sini memakai **mesin proyeksi yang sama** dengan Module 5 (sub-kategori level-2 + segmen harga + histori creator). Bedanya arah: M5 = 1 creator → banyak campaign (potensi komisi creator); M6 = 1 deal → banyak creator (proyeksi GMV total campaign). Satu sumber rumus, dua penggunaan → konsisten & hemat.

---

### 2. Rules

**2.1 Input**
- **Deal/produk** yang sedang dipertimbangkan: sub-kategori (level-2), harga (→ segmen §Module 5 2.1.1), model deal (bulk/endorsement/ads/CPS), rate komisi.
- **Pool creator** yang mungkin dilibatkan (kandidat, atau creator existing di sub-kategori itu).
- **Data historis**: GMV creator **28 hari terakhir** per sub-kategori & segmen harga (dari `platform_metrics_raw`, Module 2).

**2.2 Logika Proyeksi (deterministik)**
1. **Filter creator relevan** — creator dengan GMV historis 28 hari di sub-kategori (level-2) & segmen harga yang sama dengan produk deal.
2. **Ambil GMV historis 28 hari** tiap creator relevan pada kombinasi sub-kategori + segmen itu.
3. **Proyeksi per creator** — GMV historis 28 hari sebagai basis, disesuaikan faktor (level creator, format live/video, durasi campaign). Ditampilkan sebagai **range (min–max)**, bukan angka tunggal — konsisten dengan disclaimer Module 5 (proyeksi belum matang).
4. **Agregasi deal** — jumlahkan proyeksi creator yang direncanakan ikut → **proyeksi GMV total campaign (potensi GMV untuk brand)**.
5. **Tampilan pendukung** — per creator tampilkan **GMV total** dan **% GMV dari live** (live paling menguntungkan, jadi komposisi live jadi sinyal kualitas). Fokus output = potensi GMV untuk brand; **tidak menghitung income/komisi agency MEA di module ini.**

Semua = query + agregasi + rumus. **Tidak ada LLM.**

**2.3 Window 28 Hari & Aturan List Creator**
- Basis historis = **28 hari terakhir** (rolling). Menangkap performa terkini, bukan data usang.
- **Creator tanpa transaksi di sub-kategori yang ditarget → tidak dimasukkan** ke list (tidak dipaksa diprediksi).
- **Fallback:** bila list creator relevan terlalu sedikit → tampilkan creator dengan **sub-kategori sama tapi range harga berbeda** (ditandai sebagai kandidat fallback, confidence lebih rendah).

**2.4 Output & Disclaimer**
- **Proyeksi GMV total deal (range) = potensi GMV untuk brand.** Breakdown per creator, masing-masing dengan **GMV total** & **% dari live**.
- Tidak menampilkan income/komisi agency MEA (di luar scope module ini).
- **Disclaimer**: estimasi berbasis histori 28 hari, bukan jaminan; akurasi meningkat seiring data. BD tidak menjadikannya angka mutlak untuk komitmen ke brand.

**2.5 RBAC**
| Aksi | Director | Head/SPV | BizDev Lead | BizDev | CM Lead/CPM | Lainnya |
|---|---|---|---|---|---|---|
| Jalankan prediksi deal | ✔ | ✔ | ✔ tim | ✔ | ✖ | ✖ |
| Lihat proyeksi & breakdown | ✔ | ✔ | ✔ tim | ✔ | (view creator terkait) | ✖ |
| Set faktor/parameter proyeksi | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ |

- Alat ini **milik BizDev**. CPM tidak menjalankannya; tapi data creator yang dipakai berasal dari pool yang di-handle CPM.

**2.6 Efisiensi Token & Cache**
- **0 token AI.**
- Cache proyeksi per (sub-kategori, segmen harga, window) — kombinasi sama tidak dihitung ulang; invalidate saat data 28 hari bergeser.
- Batch: proyeksikan banyak skenario deal sekaligus.

---

### 3. Flow

**3.1 Prediksi On-Demand**
1. BD input deal: sub-kategori, harga (→ segmen), model deal, rate komisi, rencana jumlah/list creator.
2. Sistem filter creator relevan (histori 28 hari, sub-kategori + segmen match).
3. Ambil GMV 28 hari per creator → proyeksi per creator (range).
4. Agregasi → proyeksi GMV total campaign + perkiraan komisi MEA.
5. Tampilkan hasil + breakdown + disclaimer + bandingkan target ROI.

**3.2 Skenario Perbandingan**
- BD ubah komposisi creator / model deal → sistem re-proyeksi → bandingkan skenario untuk pilih yang paling menguntungkan.

**3.3 Loop ke Deal**
- Bila deal jadi → dicatat sebagai `DEAL-xxxxx`; GMV aktual campaign nanti dibandingkan ke proyeksi → feedback untuk menyempurnakan rumus proyeksi (shared engine, dipakai M5 juga).

---

### 4. Example

**Skenario:** Brand drink menawarkan bulk deal, produk range 180–800rb (segmen Entry/mid-low), sub-kategori "beverage-RTD".
- Sistem filter creator dengan transaksi 28 hari di beverage-RTD → 12 creator. (Creator tanpa transaksi di sub-kategori ini tidak masuk.)
- BD rencana libatkan 6 creator. GMV 28 hari mereka: total ~180jt; ditampilkan per creator dengan GMV total & % dari live (mis. creator A 60% live).
- Proyeksi campaign (disesuaikan durasi & level): **potensi GMV untuk brand ~150–230jt**.
- Kalau creator relevan ternyata cuma 3 (terlalu sedikit) → sistem tampilkan tambahan creator beverage-RTD di range harga lain sebagai fallback.
- BD pakai angka ini untuk pitch ke brand. **Semua tanpa LLM.** Model deal tidak mengubah proyeksi GMV.

---

### 5. System Requirements

- **Data sumber**: `platform_metrics_raw` (Module 2) — GMV creator per sub-kategori & segmen harga, window 28 hari rolling. `creators` (level, format). List deal/produk (sub-kategori, harga, rate komisi, model).
- **Shared projection engine**: modul proyeksi GMV yang sama dengan Module 5 — input (creator, sub-kategori, segmen) → output GMV proyeksi (range). Dipakai dua arah (M5 per-campaign, M6 per-deal).
- **Prediction engine**: server action/edge function — filter creator relevan, agregasi 28 hari, rumus proyeksi + faktor (level/format/durasi), agregasi deal. Tanpa LLM. Batch-capable.
- **Config**: window (default 28 hari), faktor penyesuaian (level/format/durasi), definisi segmen (share dengan M5).
- **Cache**: proyeksi per (sub-kategori, segmen, window).
- **Feedback loop**: simpan proyeksi vs GMV aktual campaign → metrik akurasi untuk penyempurnaan rumus (shared dengan M5).
- **Frontend**: panel BizDev — input deal, hasil proyeksi (range) + breakdown per creator + komisi MEA + banding target ROI; mode skenario.
- **Estimasi token**: **0 token** pipeline inti. Penghematan vs tool lama = 100% biaya prediksi LLM lama.

---

### 6. Open Assumptions

1. **Window 28 hari — LOCKED.** Rolling; creator tanpa histori 28 hari di sub-kategori/segmen = tanpa basis (confidence rendah/dikecualikan).
2. **Sub-kategori level-2 + segmen harga — LOCKED (shared dengan M5).** Taksonomi sub-kategori & definisi 5 segmen harga sama persis dengan Module 5.
3. **Shared projection engine — LOCKED.** Satu rumus proyeksi GMV dipakai M5 & M6; disempurnakan bersama via feedback loop. Hindari dua rumus berbeda.
4. **Faktor penyesuaian** (level/format live-video/durasi campaign) — komposisi awal perlu di-set & di-tune; default sederhana dulu.
5. **Model deal TIDAK mempengaruhi proyeksi — LOCKED.** Output hanya potensi GMV untuk brand; tidak menghitung income/komisi agency MEA di module ini.
6. **Feedback loop akurasi — opsional (nanti).** Tidak dibangun sekarang; bisa ditambah bila diminta di masa depan (catat proyeksi vs aktual untuk mematangkan rumus M5 & M6).

---

*Module 6 — draft untuk direview & di-lock. Selaras dengan Module 1 v4 & berbagi projection engine dengan Module 5.*
