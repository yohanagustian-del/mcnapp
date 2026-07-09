# MCN MEA AI Platform
## Module 4: Link Leakage Detection & BD Lead Generation
### *(v2 — deteksi via diff dua CSV; master shop refresh mingguan; durasi deal & cek kadaluarsa)*

---

### 1. Background

Sumber profit MEA termasuk **komisi agency (CPS)** ketika creator promosi produk lewat **link agency MEA**. Kebocoran = creator promosi produk dari seller yang **punya deal MEA**, tapi transaksinya **tidak lewat link agency MEA** → komisi yang seharusnya masuk hilang.

Deteksi dari **data transaksi creator per minggu**, dengan mencocokkan **shop_id** ke daftar seller ber-deal MEA. Data di-upload mingguan → status **selalu berubah** & dihitung ulang tiap minggu.

Output kedua dari data yang sama: shop yang **belum** punya deal MEA tapi sering dipromosikan = **lead untuk BizDev** (prioritas frekuensi × GMV).

**Masalah tool lama:** klasifikasi per creator-product pair (ribuan baris) lewat LLM berulang — boros token, padahal klasifikasi ini **murni deterministik** (join shop_id + selisih dua file + if-else).

**Keputusan arsitektur: REPLACE.** Rebuild jadi pipeline **rule-based, batch, 0 token AI** — kandidat replace paling bersih di seluruh platform. Konsisten dengan Module 1 §2.3 (Agency Link read-only, dihitung dari upload mingguan) & §2.4 (efisiensi token).

---

### 2. Rules

**2.1 Input Data (upload mingguan) — 3 sumber**
Deteksi memakai **dua CSV yang dibandingkan** + satu master:

| Sumber | Isi | Peran |
|---|---|---|
| **CSV-1: All Transactions** | Semua transaksi per creator (semua promosi, apa pun jalurnya), termasuk shop_id & GMV | Basis total |
| **CSV-2: Agency-Link Transactions** | Subset transaksi creator yang **lewat agency link MEA** (MEA dapat komisi) | Basis "aman" |
| **Master: All Cooperating Shops** | Daftar semua shop yang kerjasama/ber-deal MEA (dari platform), **di-refresh mingguan**, tiap deal punya **durasi/tanggal berakhir** | Referensi ber-deal |

Parsing Rupiah per Module 1 §0.7. Idempotent per `upload_batch` (minggu).

**2.2 Logika Klasifikasi (deterministik, per transaksi — via diff dua CSV)**
Untuk tiap transaksi di CSV-1:
- **A. Shop ber-deal MEA?** → shop_id ada di Master (dan deal **masih aktif**, belum kadaluarsa — §2.5).
- **B. Transaksi lewat agency link?** → transaksi ada di CSV-2.

| A: Ber-deal aktif? | B: Ada di CSV-2 (agency link)? | Klasifikasi |
|---|---|---|
| Ya | Ya | **Aman** — komisi masuk MEA |
| Ya | Tidak | **BOCOR** — ada di CSV-1 tapi tidak di CSV-2 → komisi hilang |
| Tidak | (n/a) | **LEAD** — shop non-deal, kandidat BizDev |

> Inti deteksi = **selisih CSV-1 dan CSV-2 pada shop ber-deal**. Transaksi shop ber-deal yang muncul di CSV-1 tapi absen di CSV-2 = bocor.

**2.3 Status: Pair-Level + Rollup Creator**
Dihitung di **dua level** (sesuai keputusan): per **creator-product pair** (`LNK-xxxxx`), lalu **rollup creator**.

*Rollup — 4 status. Basis rasio = **nilai GMV** (LOCKED).*
`rasio bocor = GMV transaksi bocor / GMV total transaksi pada shop ber-deal aktif`

| Status Creator | Kondisi (default, tunable) | Arti |
|---|---|---|
| **Via Link Agency** | rasio bocor ≤ 10% | Mayoritas lewat link MEA, aman |
| **Bocor Sebagian** | 10% < rasio bocor ≤ 50% | Sebagian komisi hilang |
| **Bocor Total** | rasio bocor > 50% | Mayoritas komisi hilang |
| **Belum Ada Link** | tidak ada transaksi pada shop ber-deal aktif | Belum ada basis komisi agency |

Ambang 10%/50% align target OKR **Avg bocor TAP < 50%**; tunable di config.

**2.4 Output Lead Generation (BD)**
- Transaksi **LEAD** (shop non-deal) diagregasi per shop_id.
- Prioritas = **frekuensi × GMV** (default; bisa ditambah dimensi niche/repeat creator nanti).
- Lead masuk daftar BizDev, terhubung entity Brand Deal (calon `DEAL-xxxxx`).

**2.5 Durasi Deal & Cek Kadaluarsa (baru)**
- Tiap deal di Master punya **durasi/tanggal berakhir**. Deal yang **kadaluarsa** → shop tidak lagi dihitung "ber-deal aktif" → transaksinya berpindah dari basis komisi ke kategori **LEAD** (peluang re-deal).
- Sistem memunculkan **alert ke BizDev**: daftar deal yang **mendekati/melewati** tanggal berakhir dan belum diperpanjang. Menyambung KR Campaign Ops ("100% perpanjangan campaign sebelum durasi habis").
- Deal kadaluarsa yang lolos = kebocoran tersembunyi (komisi yang bisa didapat jadi hilang) → prioritas follow-up BD.

**2.6 Loop Master Shop (mingguan)**
- Setelah BD closing lead → `DEAL-xxxxx` baru. Minggu berikutnya, **tarik Master All Shop yang lebih update** → shop itu kini ber-deal → transaksinya mulai dihitung sebagai potensi komisi MEA.
- Master selalu di-refresh dari platform tiap minggu sebelum klasifikasi jalan.

**2.7 Read-Only & Alert (bukan approval)**
- Status link **read-only** (Module 1 §2.3) — tidak ada edit manual. Berubah hanya pada upload minggu berikutnya.
- Bocor & deal-kadaluarsa = **event data platform** → memicu **alert/flag follow-up** (Module 1 §0.6), bukan approval.
- Creator Bocor Sebagian/Total → alert CPM. Deal mendekati kadaluarsa → alert BizDev.

**2.8 RBAC**

| Aksi | Director | Head/SPV | CM Lead | CPM | BizDev/Lead | Campaign Ops | Campaign External |
|---|---|---|---|---|---|---|---|
| Upload CSV mingguan | ✔ | ✔ | ✔ | ✔ (creator sendiri) | ✖ | ✔ | ✔ (external) |
| Lihat status bocor | ✔ all | ✔ divisi | ✔ tim | ✔ creator sendiri | ✔ (deal terkait) | ✔ | ✔ (external) |
| Assign follow-up bocor | ✔ | ✔ | ✔ | (terima) | ✖ | ✖ | ✖ |
| Lihat & ambil lead BD | ✔ | ✔ | ✖ | ✖ | ✔ | ✖ | ✔ |
| Lihat alert deal kadaluarsa | ✔ | ✔ | ✖ | ✖ | ✔ | ✔ | ✖ |
| Edit status manual | ✖ (read-only untuk semua) | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |

**2.9 Efisiensi Token**
- **0 token AI.** Klasifikasi = join + diff dua CSV + if-else + agregasi, batch per upload.
- LLM tidak dipakai. (Ringkasan naratif tren bocor untuk manajemen opsional, 1 call atas angka jadi — tidak wajib.)

---

### 3. Flow

**3.1 Pipeline Mingguan (batch, no LLM)**
1. Refresh **Master All Shop** dari platform (deal baru masuk, cek durasi/kadaluarsa).
2. Upload **CSV-1 (all transactions)** & **CSV-2 (agency-link transactions)** → parser → `upload_batch`.
3. Untuk tiap transaksi CSV-1: cek shop_id di Master (ber-deal aktif?) + cek keberadaannya di CSV-2 (via agency link?).
4. Klasifikasi Aman / Bocor / Lead (§2.2).
5. Status per pair (`LNK-xxxxx`) + rollup rasio bocor GMV per creator → 4 status (§2.3).
6. Agregasi lead (frekuensi × GMV) + cek deal mendekati/lewat kadaluarsa (§2.5).
7. Update `agency_links` (read-only) + `bd_leads` + alert. Ter-log dengan `source_upload_week`.

**3.2 Follow-up Bocor**
1. SPV/CM Lead lihat dashboard bocor.
2. Assign follow-up ke CPM.
3. CPM ajak creator pakai link agency. Hasil terlihat di upload minggu depan (tanpa edit manual).

**3.3 Lead & Perpanjangan (BD)**
1. BizDev buka daftar lead terprioritas (shop non-deal) + alert deal kadaluarsa.
2. BD approach seller baru → `DEAL-xxxxx`; & perpanjang deal yang mau habis.
3. Master update minggu depan → perhitungan menyesuaikan.

---

### 4. Example

**Skenario:** Upload minggu ini untuk creator Sinta (`CRT-00123`).
- CSV-1: 100 transaksi. CSV-2 (agency link): 60 transaksi. Master: daftar shop ber-deal aktif.
- Join & diff:
  - 60 transaksi shop ber-deal & ada di CSV-2 → **Aman**.
  - 20 transaksi shop ber-deal tapi **tidak ada di CSV-2** → **BOCOR** (GMV bocor 25jt dari 100jt pada shop ber-deal → rasio 25%).
  - 20 transaksi shop **non-deal** → **LEAD** (2 shop; satu muncul 15×, GMV 30jt → prioritas tinggi).
- Rollup Sinta: rasio bocor 25% → **Bocor Sebagian** → alert CPM.
- Salah satu shop ber-deal ternyata dealnya **kadaluarsa 3 hari lalu** → alert BizDev untuk perpanjang; sementara transaksinya jatuh ke basis LEAD.
- **Semua tanpa LLM.** Minggu depan setelah Sinta pakai link agency & deal diperpanjang, rasio bocor turun otomatis dari data baru.

---

### 5. System Requirements

- **Ingestion**: upload **CSV-1** (`transactions_all`) & **CSV-2** (`transactions_agency_link`) mingguan → tabel raw dengan `upload_batch`. Idempotent.
  - `transactions_all`: creator_id, shop_id, product_ref, gmv, txn_ref, upload_batch
  - `transactions_agency_link`: creator_id, shop_id, product_ref, gmv, txn_ref, upload_batch (subset yang via agency link)
- **Master shop**: `cooperating_shops` (shop_id, deal_id FK DEAL-xxxxx, deal_start, deal_end, active_flag) — refresh mingguan dari platform; `active_flag` dihitung dari deal_end vs tanggal berjalan.
- **Classification engine**: server action/edge function — join CSV-1 ke Master (ber-deal aktif?) + anti-join/diff ke CSV-2 (via agency link?) → Aman/Bocor/Lead. Tanpa LLM, batch.
- **Status store**: `agency_links` (id LNK-xxxxx, creator_id FK, shop_id/product_ref, link_status pair-level read-only, source_upload_week) + rollup creator (rasio bocor GMV, status 4-level per minggu).
- **Lead store**: `bd_leads` (shop_id, frequency, total_gmv, priority_score, first_seen_week, status[baru/diambil/deal]).
- **Kadaluarsa engine**: cek `deal_end` → alert deal mendekati/lewat batas & belum diperpanjang → feed BizDev/Campaign Ops.
- **Config**: threshold rasio (default 10%/50%), window alert kadaluarsa (mis. H-7).
- **Alert & audit**: creator bocor & deal kadaluarsa → notifikasi (event, bukan approval); tiap run ter-log di `audit_logs`.
- **Frontend**: dashboard bocor (per creator, rollup, tren mingguan), daftar lead BD, panel deal kadaluarsa. Status read-only.
- **Estimasi token**: **0 token** pipeline inti. Penghematan vs tool lama = 100% biaya klasifikasi LLM per-pair. Terbesar antar module.

---

### 6. Open Assumptions

1. **Threshold 4 status — LOCKED default.** ≤10% Via Link Agency, 10–50% Bocor Sebagian, >50% Bocor Total, tanpa transaksi shop ber-deal = Belum Ada Link. Tunable; align OKR bocor TAP <50%.
2. **Basis rasio — LOCKED = nilai GMV.**
3. **Deteksi via diff dua CSV — LOCKED.** CSV-1 (all) vs CSV-2 (agency link); bocor = shop ber-deal ada di CSV-1 tapi tidak di CSV-2. Perlu final-check: kunci join antar-CSV (txn_ref atau kombinasi creator+shop+product) agar diff akurat.
   *(RESOLVED saat implementasi: data platform = AGREGAT per (product_id, shop_id, period) — join pakai (product_id, shop_id), bocor = selisih affiliate_gmv. Lihat BUILD_PLAN BLOCKER.)*
4. **Master shop — LOCKED sumber.** Dari platform, refresh mingguan, tiap deal punya durasi. Perlu pastikan `deal_end` tersedia di data platform atau di-maintain di `brand_deals` internal.
   *(RESOLVED: deal_end TIDAK ada di platform → diisi dari brand_deals.exp_date internal.)*
5. **Prioritas lead — LOCKED default** frekuensi × GMV; dimensi niche/repeat creator bisa ditambah nanti.
6. **Loop deal & kadaluarsa — LOCKED.** Deal baru → shop ber-deal minggu depan; deal kadaluarsa → alert BD/Campaign Ops untuk perpanjang, sementara transaksinya jadi LEAD. Menyambung KR "perpanjangan campaign sebelum durasi habis".
7. **Konsistensi kunci transaksi** antara CSV-1 & CSV-2 (apakah `txn_ref` sama persis) menentukan akurasi diff — perlu dicek saat implementasi. *(RESOLVED: tidak ada txn_ref; kunci = (product_id, shop_id).)*

---

*Module 4 v2 — final untuk lock. Selaras dengan Module 1 v4.*
