# MCN MEA AI Platform
## Module 5: Creator–Campaign Matching (CPM Tool)

---

### 1. Background

Alat bantu **CPM (Creator Partnership Manager)** untuk mencarikan **produk/campaign** yang cocok bagi creator yang mereka handle. CPM punya creator; sistem mencari dari **list campaign MEA** yang **kategori sama & range harga sama** dengan yang sesuai untuk creator itu, lalu menampilkan **saran list** + **potensi komisi** yang bisa didapat creator dari tiap saran.

Tujuan: memberi creator gambaran menarik ("promosikan produk ini, potensi komisimu segini") agar creator mau promosi → menaikkan GMV & komisi creator sekaligus komisi MEA. Ini bukan alat BizDev dan bukan prediktor nilai deal; fokusnya rekomendasi produk untuk creator existing.

**Masalah tool lama:** matching dilakukan per creator-product pair lewat pemanggilan LLM berulang — boros token. Padahal matching di sini pada dasarnya **query + filter + ranking + hitungan komisi**, yang deterministik.

**Keputusan arsitektur: REPLACE, 0 token AI.** Sama karakternya dengan Module 4 (Link Leakage): logika yang tampak "pintar" sebenarnya rule-based. Konsisten dengan Module 1 §2.4. LLM tidak diperlukan; bila kelak ingin narasi rekomendasi, itu opsional atas hasil jadi.

---

### 2. Rules

**2.1 Input**
- **Creator** (`CRT-xxxxx`): niche, level (L1–L6), performa historis (GMV per kategori & per segmen harga, konversi, konten live/video).
- **Kategori = level-2 (sub-kategori)** dari data transaksi platform — bukan kategori umum. Matching pakai sub-kategori agar lebih presisi (mis. bukan "beauty" tapi "skincare-serum").
- **List campaign/produk MEA**: sub-kategori, harga (→ dipetakan ke segmen §2.1.1), **rate komisi** (angka komisi per deal — sudah tersedia per deal), ketersediaan (aktif, slot).
- (Opsional) status agency link creator (dari Module 4) untuk konteks bocor.

**2.1.1 Segmen Harga (dari data transaksi creator)**
Harga produk dipetakan ke 5 segmen; GMV historis creator juga dibagi ke segmen ini untuk lihat di mana creator kuat. (Angka default, tunable.)
| Segmen | Range | Karakter |
|---|---|---|
| Low-ticket | < 180 rb | Volume tinggi, komisi rendah, butuh traffic besar |
| Entry/mid-low | 180 rb – 800 rb | Populer ads, konversi cepat |
| Sweet spot | 800 rb – 3,6 jt | Balance konversi + komisi, potensi winning tinggi |
| High-ticket | 3,6 jt – 8 jt | Leverage kuat, komisi besar per sale |
| Premium | > 8 jt | Max profit per konversi, fokus high-value niche |

Dari data transaksi creator, sistem hitung distribusi GMV creator di 5 segmen → tahu creator ini kuat di segmen mana → prioritaskan campaign di segmen kuat creator.

**2.2 Logika Matching (deterministik, bertingkat)**
Pipeline filter → skor → ranking, semua rule-based:

1. **Filter sub-kategori (level-2)** — campaign yang sub-kategorinya = sub-kategori tempat creator punya GMV historis (atau sub-kategori berdekatan).
2. **Filter/prioritas segmen harga** — cocokkan segmen harga campaign (§2.1.1) dengan segmen tempat creator terbukti kuat (distribusi GMV creator per segmen).
3. **Skor ranking (bobot default SEIMBANG, tunable)** — skor gabungan dari faktor:
   - GMV historis creator di sub-kategori & segmen itu
   - Konversi/GPM creator (efisiensi jualan)
   - Level creator & kecocokan format (live vs video)
   - Rate komisi campaign (makin tinggi makin menarik untuk creator & MEA)
   - **Default: bobot merata antar faktor.** Bisa di-tune per faktor nanti (mis. utamakan GMV historis, atau utamakan komisi).
4. **Output**: daftar campaign ter-ranking + potensi komisi per item (§2.3).

Semua langkah = query + agregasi + pembobotan. **Tidak ada LLM per-pair.**

**2.3 Potensi Komisi (estimasi, dengan disclaimer)**
- `potensi komisi creator = proyeksi GMV creator (untuk produk/kategori ini) × rate komisi creator pada deal tsb`.
- **Rate komisi** diambil dari angka komisi yang sudah ada per deal.
- **Proyeksi GMV** dari data historis creator di kategori serupa. **Data proyeksi belum 100% matang**, maka:
  - Ditampilkan sebagai **estimasi/gambaran** (idealnya **range** min–max), **bukan angka pasti**.
  - Diberi disclaimer di UI agar CPM tidak over-promise ke creator.
  - Metode proyeksi (mis. rata-rata GMV kategori × faktor level) disimpan transparan agar bisa disempurnakan seiring data menumpuk.

**2.4 Read/Refresh**
- List campaign & rate komisi mengikuti data campaign terkini (refresh saat ada perubahan deal).
- Proyeksi GMV creator memakai data historis terbaru (dari platform / Module 2).

**2.5 RBAC**
| Aksi | Director | Head/SPV | CM Lead | CPM | BizDev | Lainnya |
|---|---|---|---|---|---|---|
| Jalankan matching untuk creator | ✔ | ✔ | ✔ tim | ✔ creator sendiri | ✖ | ✖ |
| Lihat saran & potensi komisi | ✔ | ✔ | ✔ tim | ✔ creator sendiri | (view campaign terkait) | ✖ |
| Kelola list campaign/rate komisi | ✔ | ✔ | ✖ | ✖ | ✔ (input deal) | ✖ |

- Alat ini **milik CPM**. BizDev mengisi list campaign & rate komisi (dari deal), tapi tidak menjalankan matching per-creator.

**2.6 Efisiensi Token & Cache**
- **0 token AI** untuk matching & perhitungan komisi.
- Cache hasil per (kategori, range harga) — kombinasi yang sama tidak dihitung ulang (Module 1 §2.4).
- Batch: bisa jalankan matching untuk banyak creator sekaligus (mis. semua creator satu CPM).

---

### 3. Flow

**3.1 Matching On-Demand**
1. CPM pilih creator (`CRT-xxxxx`).
2. Sistem tarik niche, level, performa historis creator.
3. Filter list campaign: kategori match → range harga match.
4. Skor & ranking kandidat pakai performa historis + bobot komisi.
5. Hitung potensi komisi (estimasi/range) per kandidat.
6. Tampilkan daftar ter-ranking + potensi komisi + disclaimer.

**3.2 Tindak Lanjut**
- CPM pilih saran → sampaikan ke creator sebagai rekomendasi promosi.
- (Opsional) tandai campaign yang creator setuju ambil → feed ke pencatatan campaign/assignment.

**3.3 Batch (opsional)**
- CM Lead jalankan matching untuk semua creator satu CPM sekaligus → ringkasan peluang per creator.

---

### 4. Example

**Skenario:** CPM Rina buka matching untuk creator beauty `CRT-00456` (level L4).
- Filter kategori beauty → 40 campaign; filter range harga (produk 50–200rb, sesuai histori audiens Rina) → 18 campaign.
- Ranking pakai performa historis: GMV beauty creator tinggi, konversi bagus, cocok format live → 5 campaign teratas naik.
- Potensi komisi per campaign = proyeksi GMV creator di beauty × rate komisi deal. Contoh: campaign A, proyeksi GMV ~15–25jt × rate 12% → **estimasi komisi ~1,8–3jt** (ditampilkan sebagai range + disclaimer "estimasi berdasarkan histori").
- Rina sampaikan 3 teratas ke creator sebagai rekomendasi promosi minggu ini.
- **Semua tanpa LLM.**

---

### 5. System Requirements

- **Data sumber**:
  - `creators` (Module 1) + performa historis dari `platform_metrics_raw` (Module 2): GMV per kategori, konversi, format.
  - `campaigns` / list produk: campaign_id, category, price_range, commission_rate (per deal), availability. Terhubung `brand_deals`.
- **Matching engine**: server action/edge function — filter kategori & harga (SQL), skor ranking (bobot performa + komisi), tanpa LLM. Batch-capable.
- **Commission estimator**: fungsi `proyeksi_gmv(creator, kategori) × commission_rate`; output range (min–max) + metadata metode. Proyeksi GMV modular agar bisa disempurnakan.
- **Cache**: hasil filter per (kategori, price_range) di-cache; invalidate saat list campaign berubah.
- **Frontend**: panel CPM — pilih creator → daftar saran ter-ranking, kolom potensi komisi (range) + disclaimer, aksi "rekomendasikan ke creator".
- **Config**: bobot ranking (GMV/konversi/level/komisi) tunable; parameter proyeksi GMV.
- **Estimasi token**: **0 token** pipeline inti. Penghematan vs tool lama = 100% biaya matching LLM per-pair.

---

### 6. Open Assumptions

1. **Kategori = level-2 (sub-kategori) — LOCKED.** Ambil sub-kategori dari data transaksi platform untuk matching presisi. Perlu pastikan taksonomi sub-kategori creator = sub-kategori campaign.
2. **Segmen harga — LOCKED (5 segmen, §2.1.1, tunable).** GMV creator dibagi ke 5 segmen dari data transaksi → tahu segmen kuat creator → prioritaskan campaign di segmen itu.
3. **Metode proyeksi GMV — LOCKED (diakui belum matang).** Heuristik sederhana (rata-rata GMV sub-kategori/segmen × faktor level), tampilkan range + disclaimer. Disempurnakan saat data menumpuk. Kandidat fitur prediksi terpisah kelak.
4. **Bobot ranking — LOCKED default seimbang.** Faktor GMV/konversi/level/komisi berbobot merata di awal; di-tune bersama CPM nanti.
5. **Integrasi status link (Module 4) — LOCKED sebagai fitur bantu.** Insight kunci: bocor sering terjadi karena **CPM hanya menyarankan beberapa SKU, lalu creator ambil SKU lain dan CPM tidak cek.** Maka tool ini sebaiknya: (a) sarankan SKU spesifik yang ber-agency-link MEA, (b) tandai/ingatkan bila creator promosi SKU di luar yang disarankan (dari data transaksi/Module 4) → kurangi bocor sejak sumbernya.
6. **Pencatatan hasil — LOCKED (confirm).** Campaign yang disarankan & diambil creator dicatat → ukur efektivitas tool & feed metrik hands-on CPM di Module 3. Sekaligus jadi baseline untuk cek "creator ambil SKU lain" (#5).

---

*Module 5 — draft untuk direview & di-lock. Selaras dengan Module 1 v4.*
