# MCN MEA AI Platform
## Module 1: Platform Foundation & Team Portal
### *(v4 — prinsip approval difinalisasi; komisi = data platform + durasi kontrak; Agency Link read-only; SocMed/Designer dikeluarkan dari sistem)*

---

### 0. Glossary & Terminologi Baku (shared, dirujuk semua module)

Didefinisikan sekali di sini, dipakai konsisten seluruh module. Module lain merujuk, tidak mendefinisikan ulang.

**0.1 Metrik**
| Istilah | Arti |
|---|---|
| GMV | Gross Merchandise Value — total nilai transaksi kotor penjualan creator |
| NMV | Net Merchandise Value — nilai transaksi bersih (dasar target campaign) |
| ROAS | Return on Ad Spend — rasio hasil penjualan terhadap belanja iklan |
| GPM | Gross per Mille — GMV per 1.000 view |
| AOV | Average Order Value |
| CPS | Cost per Sale; "CPS tambahan/extra commission" = komisi ekstra ke MEA di atas komisi standar |
| Deal activation rate | % deal aktif tepat waktu sesuai lead time handover |

**0.2 Sharing Komisi Creator (penting — sumber profit #1)**
- Definisi: **porsi komisi yang MEA terima dari total komisi creator.** Contoh: sharing 10% = MEA mendapat 10% dari total komisi creator. **Makin besar angka = makin menguntungkan MEA.**
- **Angka sharing di-set otomatis dari backend platform (TikTok), MEA tidak mengubahnya manual.** Peran platform ini terhadap data: (a) **mencatat angka sharing** untuk perhitungan profit, (b) **mencatat durasi kontrak** creator agar tidak ada creator lepas tanpa terpantau.
- Perubahan angka sharing = **event dari platform**, bukan aksi manusia. Bila sharing turun (mis. 10%→8% = profit MEA berkurang) → sistem memunculkan **alert/flag untuk follow-up**, bukan "approval untuk mengubah" (karena MEA memang tidak bisa mengubahnya).

**0.3 Level Creator (Creator Ladder)**
- L1–L6 (juga LS1–LS6). Makin tinggi makin bernilai.
- Acuan OKR: **LS4 ≈ GMV min. 85 jt**; kenaikan level (L4→L6, →L4) = KR utama CPM.
- Segmen: **Top Creator (TC)**, **Incubation**, **Celebrity (Celeb)**.

**0.4 Program Afiliasi & Sumber GMV**
| Istilah | Arti |
|---|---|
| TAP / SAP | TikTok / Shopee Affiliate Program (link & komisi afiliasi) |
| Top Shop | Toko/brand prioritas sumber GMV komisi |
| Top Campaign | Campaign yang menghasilkan revenue ke MEA (TikTok min. 1% komisi; Shopee min. 0.01%) |
| Bocor (link) | Transaksi/komisi afiliasi yang tidak masuk ke MEA; target Avg bocor TAP < 50% |
| TikTok GO / One | Program binding TikTok; GO tak wajib join MCN (min. GMV 1jt), One min. 10.000 followers |

**0.5 Alur Handover Standar (lintas module)**
```
Business Development → Campaign Operations → CPM → Creator
      (2 hari)              (2 hari)         (7 hari)
```
Deal activation rate ≥ 80% diukur dari kepatuhan lead time. Cut-off request harian: 19.00 WIB.

**0.6 Prinsip Approval & Logging (WAJIB, lintas module)**
Menggantikan "threshold approval TBD" di versi sebelumnya. Aturan:
1. **Aksi yang menambah income / tidak merugikan** → **tidak perlu approval**, langsung berlaku. (Mis. menaikkan share MEA, menambah deal masuk.)
2. **Aksi manusia yang berpotensi merugikan perusahaan** → **perlu approval** atasan sebelum berlaku. (Mis. menurunkan nilai yang mengurangi profit MEA, membatalkan deal bernilai.)
3. **Perubahan yang berasal dari data platform (bukan aksi manusia)** → tidak bisa di-approve/diubah manual; bila merugikan (sharing turun, link makin bocor) sistem memunculkan **alert/flag untuk follow-up**.
4. **Log selalu ada.** Setiap perubahan data material tercatat di `audit_logs` immutable — baik yang auto, yang butuh approval, maupun alert dari platform.

**0.7 Model Deal & Perhitungan (ringkas; detail di module Deal/BizDev)**
- Model deal: Bulk deal, Endorsement (rate card), Ads support + extra CPS, Tap-in event/bootcamp, CPS-only.
- Pembayaran: **Lunas (di muka)** atau **Invoice (bayar belakang)** — diverifikasi Finance.
- Bobot komisi BD (tiering doc): Iklan deal 10%, Iklan invoicing 20%, project/showcase 20%, Rate Card = management fee-nya saja, service dibayar dimuka = 100% sisa profit. CPS/komisi tambahan → OKR saja, bukan tiering bonus.
- Parsing Rupiah: strip "Rp", titik = ribuan (hapus), koma = desimal (→titik).

---

### 1. Background

MCN MEA menjalankan beberapa tools terpisah (Creator-Campaign Matching Assistant, Link Leakage Detection Pipeline, BD Deal Value Predictor, Creator Report generator, dll). Logic-nya benar, tapi boros token pada volume besar. Platform menyatukannya dengan pendekatan **hybrid** (replace yang boros, wrap yang efisien) di atas fondasi role, entity, dan prinsip token yang sama.

Module 1 = fondasi: glossary (§0), struktur role & akses (Team Portal), entity inti, prinsip token. Portal mengikuti MSDPS: **Team Portal (internal)** dulu, **Portal eksternal** menyusul. Live Stream MSDPS **tidak** diintegrasikan. Struktur role mengikuti OKR resmi MCN MEA.

---

### 2. Rules

**2.1 Struktur Role (mengikuti OKR resmi)**

Tiap grup umumnya punya **Lead** (approval & agregasi) dan **staff/specialist** (eksekusi).

**A. Management**
| Role | Cakupan | Approval |
|---|---|---|
| Director | Seluruh MCN MEA | Tertinggi, override |
| Head / SPV MCN | Lintas divisi operasional; KR GMV & campaign fulfillment | Approval level divisi |

**B. Acquisition** *(= "Akuisisi", 2 level — confirmed)*
| Role | Cakupan | Approval |
|---|---|---|
| Creator Acquisition Lead | Tim akuisisi; agregasi pribadi + tim | Approve binding, propose target |
| Acquisition Specialist | Sourcing & binding creator baru (inbound/outbound/platform list) | Input creator baru, propose binding |

**C. Creator Management** *(CM = CPM, role yang sama — confirmed; tersegmentasi)*
| Role | Cakupan | Approval |
|---|---|---|
| CM Lead — TikTok | CPM segmen TikTok | Approve level-up, agregasi NMV tim |
| CM Lead — Shopee | CPM segmen Shopee | Approve level-up, agregasi NMV tim |
| CM Lead — Celeb | CPM segmen Celeb | Approve level-up, agregasi NMV tim |
| CPM — Top Creator | Handle TC (target L4→L6, komisi ≥10%) | Input & propose |
| CPM — Incubation | Handle incubation (target →L4, komisi ≥15% saat LS4) | Input & propose |
| CPM — Celeb | Handle celebrity (rate card, kolaborasi) | Input & propose |

> **CM dan CPM adalah role yang sama** (istilah resmi CPM = Creator Partnership Manager). Satu CPM handle ~30 creator (perhitungan KR) / up to 50 operasional. Pembagian creator per quartal oleh CM Lead/Head.

**D. Business Development** *(punya sub-role Admin & Campaign Ops — confirmed)*
| Role | Cakupan | Approval |
|---|---|---|
| BizDev Lead | Tim BD; agregasi revenue CPS & brand deal | Approve deal berpotensi merugikan, propose target |
| BizDev | Sourcing & closing brand deal, endorsement | Input deal, propose value |
| Campaign Operations | Eksekusi campaign pasca-handover BD; generate TAP/SAP; report campaign H+5 | Input eksekusi, update status campaign |
| BD/Campaign Administrator | Invoicing, SPK, faktur pajak, TOP tracking | Input administratif, flag pembayaran |

**E. Campaign External** *(= "External Creator" — confirmed)*
| Role | Cakupan | Approval |
|---|---|---|
| Campaign External (TAP/SAP) | Deal creator non-MCN pakai link TAP/SAP; arahkan/binding ke MEA (koordinasi Akuisisi) | Input creator eksternal, propose/binding |

**F. Creator Support**
| Role | Cakupan | Approval |
|---|---|---|
| Creator Support | Menjalankan **ads & monitoring live di luar jam kerja CPM** (petugas malam & weekend), fokus **Celeb & TC Live**; asistensi sesi live, administrasi invoicing terkait. **Tidak semua creator** dilayani. | Input & update data operasional live/ads |

**G. Finance**
| Role | Cakupan | Approval |
|---|---|---|
| Finance | Verifikasi & approval pembayaran deal (lunas/invoice); **input manual ke sistem finance existing** | Approve status pembayaran deal |

> **Di luar sistem ini:** Social Media Specialist & Graphic Designer punya OKR sendiri tapi **tidak dimasukkan ke platform** karena tidak berhubungan langsung dengan alur inti (creator/deal/campaign). Bila suatu saat perlu (mis. leads dari sosmed masuk ke funnel akuisisi), baru ditinjau ulang.

**2.2 Prinsip RBAC**
- Setiap module baru **wajib** mendefinisikan matrix akses per role (view/create/edit/approve) mengikuti role §2.1 — tidak boleh tambah role baru tanpa update Module 1.
- Lead & Management lihat cross-tim di scope-nya; staff lihat scope sendiri kecuali diberi akses eksplisit.
- Finance lihat cross-team **khusus dimensi pembayaran deal**.
- Semua aksi material tercatat di `audit_logs` immutable (§0.6).

**2.3 Entity Inti Lintas Module (shared entity)**

| Entity | Prefix ID | Deskripsi | Akses tulis |
|---|---|---|---|
| Creator | `CRT-xxxxx` | Profil, niche, follower tier, **level (L1–L6)**, segmen (TC/Incubation/Celeb), GMV, **sharing komisi (dari platform, read-only)**, **durasi kontrak**, status (Prospek/Binding/Aktif/Nonaktif), owner_cpm_id | Acquisition & Campaign External (create saat binding), Creator Support (update live/ads), CPM (update operasional & level). Sharing komisi **tidak** bisa diedit manual — sync dari platform. |
| Brand Deal | `DEAL-xxxxx` | Deal brand-creator: model, value, komponen (ads/RC/CPS), payment_terms, payment_status, handover status | BizDev (create/value), Campaign Ops (eksekusi/status), BD Admin (invoicing), Finance (payment) |
| Agency Link | `LNK-xxxxx` | Status link afiliasi creator-product (Via Link Agency / Bocor Sebagian / Bocor Total / Belum Ada Link), platform (TAP/SAP). **READ-ONLY bagi user.** Status dihitung sistem dari **data transaksi yang di-upload per minggu** — tidak bisa diubah CPM atau siapa pun secara manual. | **Sistem saja** (hasil hitung dari upload mingguan). User hanya melihat. |

**2.4 Prinsip Efisiensi Token (wajib semua module)**
- LLM hanya untuk **reasoning** (matching brand-creator, prediksi deal value, ringkasan naratif). Task deterministik (klasifikasi link, agregasi GMV/NMV, hitung OKR) **tidak** pakai LLM per-record.
- Volume besar → **batch**. Cache hasil yang tidak berubah. Tiap module cantumkan estimasi token untuk keputusan replace-vs-wrap.

---

### 3. Flow

**3.1 Login & Akses**
1. Login (email MEA) → cek role dari Team Directory.
2. Landing per role: Management lihat cross-team; Lead lihat tim; staff lihat scope sendiri; Finance lihat dashboard pembayaran.
3. Navigasi module muncul sesuai hak akses.

**3.2 Approval & Alert (§0.6)**
1. Staff input/propose.
2. Aksi menambah income/tak merugikan → **auto berlaku** (tetap ter-log).
3. Aksi manusia berpotensi merugikan → **butuh approval** Lead/Head sebelum berlaku.
4. Perubahan dari data platform yang merugikan (sharing turun, link makin bocor) → **alert/flag follow-up**, tidak bisa diubah manual.
5. Finance approve status pembayaran (jalur paralel). Director bisa override (ter-log).

**3.3 Handover Deal** (§0.5) — BizDev → Campaign Ops → CPM → Creator, tiap hop punya lead time; deal activation rate dari kepatuhan lead time.

**3.4 Binding Creator**
1. Acquisition Specialist **atau** Campaign External menemukan kandidat.
2. Creator baru `CRT-xxxxx` status `Prospek/Binding`. Campaign External bisa **binding langsung & serahkan langsung ke CPM** (koordinasi Akuisisi untuk pencatatan).
3. Binding selesai → `Aktif`, di-assign CPM, Creator Support maintain live/ads bila segmen Celeb/TC Live. Durasi kontrak dicatat.

---

### 4. Example

**Skenario A (Link bocor — read-only):** Data transaksi minggu ini di-upload. Sistem hitung: 40 creator berstatus "Bocor Sebagian". SPV lihat dashboard, assign follow-up ke tim untuk menghubungi creator. **Tidak ada yang bisa mengubah status secara manual** — status baru berubah minggu depan setelah upload data berikutnya menunjukkan transaksi bocor berkurang.

**Skenario B (Sharing komisi turun — alert):** Sync platform menunjukkan sharing komisi seorang top creator turun 10%→8%. Karena ini event platform (bukan aksi MEA), sistem tidak minta approval tapi memunculkan **alert** ke CPM & Head: profit MEA dari creator ini berkurang, perlu follow-up (cek kontrak/negosiasi). Ter-log.

**Skenario C (Handover):** BizDev closing bulk deal Femmy → Campaign Ops generate SAP & setting ads (2 hari) → CPM TC assign & brief 5 creator (dalam lead time) → creator live. Deal activation rate dihitung dari ketepatan tiap hop.

---

### 5. System Requirements

- **Auth & RBAC**: `team_members` role enum (§2.1) + `team_group` & `platform_segment`. Supabase Auth.
- **Entity schema awal**:
  - `creators`: id (CRT-xxxxx), name, niche, follower_tier, level, segment, gmv, commission_share (platform-sync, read-only), contract_end_date, status, owner_cpm_id
  - `brand_deals`: id (DEAL-xxxxx), creator_id FK, brand_name, deal_model, deal_value, components, payment_terms, payment_status, handover_status
  - `agency_links`: id (LNK-xxxxx), creator_id FK, product_ref, platform, link_status (system-computed, read-only), source_upload_week
- **Audit log**: `audit_logs` immutable (actor/system, action, entity_id, timestamp, before/after, type[auto/approval/platform-alert]).
- **Team Directory & seed**: dari sumber existing → **bulk upload** (CSV/XLSX) dulu, lalu input/edit manual.
- **Weekly upload ingestion**: pipeline upload data transaksi mingguan → hitung status link (rule-based) → update `agency_links`. Tidak ada edit manual.
- **Frontend**: Next.js 15 (App Router), role-aware navigation.
- **Backend**: Supabase (Postgres + Auth); logic deterministik di edge function/server action.
- **AI Layer**: service terpisah untuk reasoning, logging token per call.

---

### 6. Open Assumptions

1. **Batas CPM vs Creator Support — LOCKED.** CPM = operasional harian creator, campaign assignment, generate report (jam kerja). Creator Support = jalankan ads & monitoring live di luar jam kerja (malam/weekend), fokus Celeb & TC Live.
2. **Batas Acquisition vs Campaign External — LOCKED.** Acquisition = sourcing utama pool. Campaign External = creator non-MCN via TAP/SAP, bisa binding langsung & serahkan ke CPM (koordinasi Akuisisi).
3. **Finance — LOCKED.** Role penuh; input manual ke sistem finance existing.
4. **Approval — LOCKED (§0.6).** Income naik/tak merugikan = auto; aksi manusia berpotensi merugikan = approval; event platform merugikan = alert. Log selalu ada. (Angka nominal spesifik untuk "berpotensi merugikan" pada deal dikunci di module Deal bila diperlukan.)
5. **Sharing komisi = data platform read-only — LOCKED.** MEA hanya mencatat untuk profit + catat durasi kontrak. Turun = alert.
6. **Agency Link = read-only, dihitung dari upload mingguan — LOCKED.** Memperkuat arah module Link Leakage sebagai pipeline batch rule-based.
7. **Team Directory seed** via bulk upload — LOCKED arah.
8. **SocMed & Designer di luar sistem — LOCKED.** Ditinjau ulang hanya bila terhubung ke funnel inti.
9. **Roadmap module — LOCKED.** M2 = Creator Report; M3 = OKR/Performance. M4 dst = Matching / Link Leakage / Deal Predictor (assess replace-vs-wrap).

---

### Changelog v3 → v4
- §0.2 baru: sharing komisi = porsi MEA dari komisi creator, **read-only dari platform**; MEA catat profit + durasi kontrak; turun = alert.
- §0.6 baru: **Prinsip Approval & Logging** (income naik = auto; aksi manusia merugikan = approval; event platform merugikan = alert; log selalu ada). Menggantikan "threshold TBD".
- Agency Link jadi **read-only, dihitung dari upload data transaksi mingguan** — tidak bisa diedit manual (termasuk CPM). Contoh Skenario A diperbaiki.
- **Social Media Specialist & Graphic Designer dikeluarkan dari sistem** (grup G lama dihapus; dicatat "di luar sistem").
- Creator entity: tambah `commission_share` (read-only) & `contract_end_date`. Agency Link: tambah `source_upload_week`.
- Confirmations OKR (Akuisisi 2 level, CM=CPM, BizDev sub-role, Campaign External) ditandai di tabel role.

---

*Module 1 v4 — di-lock. Module 2 (Report) & Module 3 (OKR) mengikuti struktur ini.*
