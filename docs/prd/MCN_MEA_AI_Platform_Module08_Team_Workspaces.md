# MCN MEA AI Platform
## Module 8: Team Workspaces (CM / BizDev / Acquisition / External Creator)

---

### 1. Background

Module ini mengikat operasional harian tiga fungsi inti menjadi **workspace** per role. Sebagian besar bukan tool baru dari nol, melainkan **mengagregasi** yang sudah dibangun (M2 Report, M4 Link Leakage/Lead, M5 Matching, M6 Predictor) + menambah alur yang belum ada — terutama **routing req campaign lintas-workspace** (BizDev → CM pemilik creator → creator), yang selama ini manual dan rawan salah alamat.

Tiga sub-workspace dalam satu module karena **alur req campaign menyambungkan ketiganya**; memisah jadi tiga file akan memecah flow yang sama.

**Efisiensi token:** semua = dashboard, agregasi, tracking, routing = **0 token AI.** LLM opsional hanya untuk ringkasan naratif report brand (mengikuti pola M2). E-sign kontrak tidak pakai AI.

---

### 2. Rules

## 2A. CM Workspace

**2A.1 Pembagian Creator per CM**
- Tiap creator punya `owner_cpm_id` (Module 1). Assignment dilakukan **CM Lead/Head**: assign otomatis saat akuisisi, re-assign per quartal bila ada perpindahan.
- Satu CPM handle ~30 (perhitungan KR) / up to 50 (operasional) creator.
- Perubahan owner tercatat di `audit_logs`.

**2A.2 Dashboard Inkubasi & Growth per Creator**
- Per creator yang di-handle: growth GMV, level (L1–L6) & jarak ke level berikutnya, tren mingguan (data dari M2).
- **Alert performa turun:** bila GMV/level creator turun melewati ambang → alert ke CPM (event, bukan approval).

**2A.3 Report (dari M2)**
- CM Workspace men-*surface* report M2 (generate, review, kirim) — tidak membuat ulang. Log aktivitas CPM (M2 §2.6) tampil di sini.

**2A.4 Daftar Req Creator (sample, ads, HSL)**
- CPM catat kebutuhan creator: **sample produk, ads support, harga special live (HSL)**. Tiap req: creator, jenis, status (diajukan/diproses/selesai), tujuan brand.
- Sample & HSL → req ke brand (via BizDev/langsung). Ads support → cek terhadap ads budget cap deal creator.

**2A.5 Tracker Shop Potensial (CM → BizDev)**
- CPM temukan shop potensial (dari interaksi creator) → catat sebagai lead → masuk pipeline BizDev (nyambung dengan lead otomatis M4). Jalur manual CM→BizDev ini pelengkap lead otomatis.

**2A.6 Dashboard Campaign dari BizDev (yang perlu dikerjakan CM)**
- Menampilkan **req campaign** yang di-route ke CPM ini (lihat §2D routing).
- CPM update: apakah creator **mau join** campaign; status brand-acc bila diperlukan.

**2A.7 Kontrak Tertulis TC/Celebrity (E-Sign)**
- Untuk **Top Creator & Celebrity**, ada kontrak tertulis (berbeda dari binding TikTok). Saat ini fisik + TTD → module sediakan **e-sign**.
- Alur e-sign: CPM/CM Lead buat draft kontrak → kirim ke creator → creator tanda tangan digital → tersimpan + audit. Status: draft/terkirim/ter-sign/kadaluarsa.
- Berlaku khusus segmen TC & Celeb; creator lain tidak wajib.

## 2B. BizDev Workspace

**2B.1 Dashboard Tracker Req dari Semua CM**
- Agregasi semua req (sample, ads, HSL, shop potensial) dari seluruh CM → BizDev lihat & tindak lanjuti ke brand.

**2B.2 Pipeline Deal Brand**
- Deal yang sedang dikerjakan per tahap (mis. prospek → nego → closing → aktif), terhubung `DEAL-xxxxx`. Bisa pakai M6 (Deal Predictor) untuk proyeksi GMV saat menilai deal.

**2B.3 List Campaign & Hasil**
- Campaign yang dibuat BizDev + hasilnya (GMV, ROAS, video, view) — digabung dengan hasil dari external creator.

**2B.4 Report Brand Deals**
- Report performa per brand: agregat hasil campaign (GMV, ROAS, total video, total view) **+** bahan **upgrade service** ke brand (rekomendasi naikkan investasi/scope).
- Data layer rule-based (agregasi); ringkasan naratif opsional 1 LLM call (pola M2). Dipakai untuk pitch balik ke brand.

## 2C. Acquisition Workspace

**2C.1 Tracking Kinerja Closing**
- Catat creator yang berhasil di-**binding** per Acquisition Specialist & Lead (pribadi + tim), dengan **sumber leads**:
  - **Inbound** (creator cari MEA: event, social media, SEO)
  - **Outbound** (Akuisisi outreach creator)
  - **Platform list** (dari Shopee/TikTok — sedikit tapi level bagus, jarang respon)
- Metrik: jumlah binding per sumber, GMV creator hasil binding (diukur mengikuti KR: GMV 3 bulan setelah join), kategori (Health/Beauty/Fashion), level (LS4/GMV≥85jt), komisi ≥20%.

**2C.2 Referral (program ajak teman)**
- Bila creator baru datang dari **referral creator lain**, catat: siapa creator perujuk (`CRT-xxxxx`), creator baru, status komisi referral.
- MEA punya **program ajak teman berkomisi** → sistem hitung komisi referral yang jatuh ke creator perujuk.
- **Cek referral platform:** tandai juga bila referral berasal dari program referral platform (TikTok/Shopee), bukan antar-creator — karena mekanisme/komisinya berbeda. Flag sumber referral: `antar-creator` / `platform`.

**2C.3 Handoff ke CM**
- Creator ter-binding → status `Aktif` → di-assign ke CPM (Module 1 §3.4). Acquisition Workspace menandai handoff selesai.

## 2D. External Creator Workspace

**2D.1 Metrik Approach**
- **Jumlah creator di-approach**, **success rate** (deal pakai link TAP / total approach), **total GMV** yang dihasilkan creator-creator tersebut.
- Nyambung ke KR Campaign External (OKR): revenue CPS, jumlah creator pakai link TAP, conversion rate, binding LS4/LS2-3.

**2D.2 Binding ke MEA**
- Creator external yang perform → kandidat binding (koordinasi Akuisisi). External bisa binding langsung & serahkan ke CPM (Module 1 §3.4).

## 2E. Routing Req Campaign (alur lintas-workspace — inti module)

**2E.1 Aturan Routing**
1. BizDev pilih creator untuk campaign (bisa dibantu M5/M6).
2. Sistem cek `owner_cpm_id` creator itu → **req otomatis muncul di CM Workspace pemilik creator** (bukan CM lain). *Contoh: BizDev pilih creator A yang di-handle CM B → req ada di CM B.*
3. **CM konfirmasi:** creator mau join / tidak.
4. **Brand-acc (opsional, per brand):** sebagian brand ingin **acc creator dulu** sebelum fix — tidak semua. Bila brand tsb butuh acc → status tambahan "menunggu acc brand"; brand approve/tolak creator.
5. Bila creator mau + (brand acc bila perlu) → creator masuk campaign → handover ke Campaign Ops (Module 1 §0.5).

**2E.2 Status Req Campaign**
`diajukan BizDev → di CM (menunggu konfirmasi) → creator mau/tidak → [menunggu acc brand bila perlu] → fix/batal`. Semua transisi ter-log.

**2F. RBAC (ringkas)**
| Aksi | Director/Head | CM Lead | CPM | BizDev/Lead | Akuisisi | External |
|---|---|---|---|---|---|---|
| Assign/re-assign creator ke CPM | ✔ | ✔ | ✖ | ✖ | (handoff) | ✖ |
| Kelola req creator (sample/ads/HSL) | ✔ | ✔ | ✔ (sendiri) | (terima) | ✖ | ✖ |
| E-sign kontrak TC/Celeb | ✔ | ✔ | ✔ (sendiri) | ✖ | ✖ | ✖ |
| Kelola pipeline deal & report brand | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ |
| Route req campaign ke CM | ✔ | ✖ | ✖ | ✔ | ✖ | ✖ |
| Konfirmasi creator join campaign | ✔ | ✔ | ✔ (creator sendiri) | ✖ | ✖ | ✖ |
| Tracking closing & referral | ✔ | ✖ | ✖ | ✖ | ✔ | ✖ |
| Metrik approach external | ✔ | ✖ | ✖ | (view) | ✖ | ✔ |

**2F. Efisiensi Token**
- Semua dashboard/tracking/routing/e-sign = **0 token AI**.
- LLM opsional: ringkasan naratif report brand (§2B.4), 1 call atas angka jadi.

---

### 3. Flow

**3.1 Routing Req Campaign (utama)**
1. BizDev buat req campaign + pilih creator.
2. Sistem route ke CM pemilik tiap creator.
3. CPM konfirmasi creator mau join.
4. Bila brand butuh acc → tunggu acc brand.
5. Fix → handover Campaign Ops.

**3.2 Req Creator (sample/ads/HSL)**
1. CPM ajukan req di CM Workspace.
2. Muncul di tracker BizDev.
3. BizDev proses ke brand → update status → CPM lihat hasil.

**3.3 E-Sign Kontrak TC/Celeb**
1. CPM/CM Lead buat draft → kirim ke creator → creator TTD digital → tersimpan + audit.

**3.4 Report Brand (BizDev)**
1. BizDev pilih brand/periode → agregasi hasil campaign → (opsional) ringkasan naratif → export untuk pitch/upgrade service.

---

### 4. Example

**Skenario routing:** BizDev closing deal brand skincare, ingin libatkan creator `CRT-00789` (di-handle CPM Sari).
- Req otomatis muncul di **CM Workspace Sari** (bukan CM lain).
- Sari konfirmasi ke creator → creator mau join.
- Brand skincare ini termasuk yang **minta acc creator** → status "menunggu acc brand" → brand approve.
- Fix → handover ke Campaign Ops. Semua transisi ter-log.

**Skenario CM:** CPM Sari buka workspace: 30 creator-nya, satu (`CRT-00790`) GMV turun 20% minggu ini → **alert performa**. Sari generate report M2 untuk creator itu, ajukan req sample ke brand via tracker, dan kirim e-sign kontrak untuk satu creator Celeb baru.

---

### 5. System Requirements

- **Creator assignment**: `creators.owner_cpm_id` (Module 1) + histori re-assignment (audit). UI assign untuk CM Lead.
- **Req creator**: `creator_requests` (creator_id, type[sample/ads/hsl], target_brand, status, requested_by, created_at).
- **Campaign req routing**: `campaign_requests` (id, deal_id/campaign_id, creator_id, owner_cpm_id [auto dari creator], cm_confirm_status, needs_brand_acc, brand_acc_status, final_status). Semua transisi → `audit_logs`.
- **Shop lead (CM→BizDev)**: nyambung ke `bd_leads` (M4), dengan source[auto-M4/manual-CM].
- **E-sign**: `creator_contracts` (creator_id, segment[TC/Celeb], contract_doc, esign_status[draft/sent/signed/expired], signed_at). Integrasi provider e-sign.
- **BizDev pipeline**: `deals` (M1) + stage tracking; report brand = agregasi hasil campaign per brand.
- **External metrics**: agregasi approach/success-rate/GMV dari data external creator + `agency_links` (M4).
- **Acquisition tracking**: `acquisitions` (creator_id, specialist_id, lead_source[inbound/outbound/platform], binding_date, gmv_post_join) + `referrals` (new_creator_id, referrer_creator_id, referral_source[antar-creator/platform], commission_status).
- **Dashboards**: CM (creator, growth, alert, report, req, campaign masuk), BizDev (tracker req, pipeline, campaign+hasil, report brand), External (approach/success/GMV).
- **AI Layer**: opsional ringkasan report brand (1 call).
- **Estimasi token**: **0 token** untuk seluruh workspace; hanya ringkasan report brand opsional.

---

### 6. Open Assumptions

1. **Ambang alert performa turun — LOCKED.** GMV turun **>15% minggu-ke-minggu** → alert ke CPM.
2. **Brand approval — LOCKED.** BizDev isi kolom **`needs_brand_acc`** saat membuat campaign (per campaign, tidak semua brand). Bila ya → req campaign lewat gate acc brand (§2E).
3. **Provider e-sign — rekomendasi.** Untuk konteks Indonesia (butuh keabsahan hukum lokal + API): **Privy** atau **Mekari Sign** — keduanya PSrE terdaftar Kominfo, patuh UU ITE, punya eSignature API & e-Meterai, tanda tangan sah di pengadilan. Untuk volume kecil TC/Celeb, mulai dari plan personal/entry lalu naik ke API enterprise saat volume bertambah. (Sign.com lebih murah tapi tanpa kepatuhan lokal Indonesia — kurang cocok untuk kontrak yang harus kuat secara hukum di sini.) Harga berubah — konfirmasi langsung ke sales; kontrak fisik lama tetap diarsip.
4. **Req sample & HSL & ads — LOCKED.** Req sample **tidak terbatas**; HSL bisa req **per sesi** (acc ada di brand). Ads cap diisi bersamaan **database creator yang di-upload**. Bila req melewati ads cap (berpotensi merugikan, §0.6) → butuh approval, dengan **approval tambahan Director**.
5. **Rekomendasi upgrade service — LOCKED.** Trigger: **ROAS tinggi + GMV tinggi** pada brand → sistem sarankan upgrade service/naikkan investasi. Ambang angka tunable.
6. **Sumber data — LOCKED.** Semua metrik workspace dari **data platform pada periode yang sama** — konsisten dengan module lain; satu sumber kebenaran.

---

*Module 8 — draft untuk direview & di-lock. Selaras dengan Module 1 v4; mengikat M2/M4/M5/M6/M7.*
