# MCN MEA AI Platform
## Module 2: Creator Report Generator
### *(v3 — final untuk lock: Creator Support tidak generate; log aktivitas CPM; threshold 15%; insight diperluas; baseline ratchet)*

---

### 1. Background

CPM (Creator Partnership Manager) membuat **report per creator** berkala (weekly & monthly) untuk membantu creator menemukan insight akun dan naik level (L1–L6). Report mengolah data platform (Shopee/TikTok) — GMV, NMV, views, GPM, AOV, dst — jadi insight naratif actionable.

**Masalah tool lama:** generator sebelumnya **boros token** — seluruh proses (termasuk agregasi angka & tabel) dialihkan ke LLM, padahal mayoritas isi report deterministik. Melanggar Prinsip Efisiensi Token (Module 1 §2.4).

**Keputusan arsitektur: REPLACE.** Rebuild jadi pipeline hybrid — bagian deterministik (fetch, agregasi, tabel, chart, klasifikasi tren) rule-based/batch tanpa LLM; LLM hanya untuk **satu tugas**: menyusun ringkasan naratif insight dari angka yang sudah jadi. Wrap tidak menyelesaikan masalah karena pemborosan ada di arsitektur inti.

Cakupan Module 2: engine report + flow generate/review + RBAC + logging aktivitas CPM. Pengiriman ke creator via Portal eksternal menyusul; di module ini report cukup bisa di-generate, di-review CPM, di-export/kirim.

---

### 2. Rules

**2.1 Jenis & Trigger Report**

| Jenis | Periode | Trigger | Isi |
|---|---|---|---|
| Weekly report | Mingguan | Batch terjadwal (mis. Senin) + on-demand | Snapshot minggu berjalan vs minggu lalu, quick insight |
| Monthly report | Bulanan | Batch terjadwal (awal bulan) + on-demand | Analisa mendalam, tren bulanan, rekomendasi actionable, insight penuh |

**2.2 Pemisahan Deterministik vs Reasoning (inti hemat token)**

| Lapis | Isi | Diproses oleh | Pakai LLM? |
|---|---|---|---|
| **Data layer** | Semua angka & tabel (lihat §2.3) | Rule-based / SQL / server function, **batch** | ❌ |
| **Insight layer** | Ringkasan naratif "kenapa" angka bergerak, 3–5 rekomendasi, highlight peluang naik level | LLM (1 call/report), input **angka yang sudah jadi** (JSON ringkas) | ✅ minimal |

- LLM **tidak pernah** terima data mentah baris-per-baris — hanya ringkasan angka terstruktur → prompt pendek → token rendah.
- Weekly boleh **skip insight layer** bila tidak ada perubahan signifikan (lihat §2.4) → report data-only, 0 token AI.

**2.3 Isi Report (semua deterministik, di data layer)**

*Metrik inti (existing template):*
GMV, NMV, views, GPM, AOV, top produk, sumber GMV (TAP/SAP/Top Shop vs organik).

*Insight tambahan (analisa baru — tetap deterministik, 0 token AI):*

| Poin | Kegunaan |
|---|---|
| Tren durasi & frekuensi live + korelasi ke GMV | Live paling menguntungkan (brief) — lihat apakah creator cukup live |
| Funnel view→order (conversion rate) | Diagnosa "banyak view, sedikit closing" (melengkapi GPM) |
| Kontribusi Top Campaign (TAP/SAP) vs organik | Sekaligus feed data KR CPM di Module 3 |
| Posisi vs target level (jarak ke level berikutnya) | Actionable: seberapa dekat L4→L5, apa yang kurang |
| Alert kontrak & sharing komisi (dari Module 1) | Kontrak hampir habis / sharing turun → muncul di report |
| Benchmark vs peer segmen/niche (agregat & anonim) | Posisi relatif tanpa bocorkan data creator lain |

**2.4 Gate Skip-LLM (weekly) — Threshold ±15%**
- Sistem hitung delta metrik utama minggu ini vs minggu lalu (GMV & views sebagai pemicu utama).
- **Jika |delta| ≤ 15%** untuk semua pemicu → perubahan dianggap noise → **report data-only, AI tidak dipanggil.** Creator tetap dapat tabel angka lengkap.
- **Jika |delta| > 15%** pada salah satu pemicu → **AI dipanggil** untuk jelaskan penyebab & rekomendasi.
- **Contoh:** GMV 10jt→10,3jt (naik 3%) → skip AI, data-only. GMV 10jt→15jt (naik 50%) → panggil AI.
- Threshold **tunable** di config (bisa diubah per metrik nanti); 15% adalah titik awal.
- Monthly report selalu ber-insight (tidak kena gate), kecuali creator nonaktif.

**2.5 RBAC Report**

| Aksi | Director | Head/SPV | CM Lead | CPM | Creator Support | Lainnya |
|---|---|---|---|---|---|---|
| Generate report | ✔ any | ✔ divisi | ✔ tim | ✔ creator sendiri | ✖ | ✖ |
| View report | ✔ semua | ✔ divisi | ✔ tim | ✔ creator sendiri | ✖ | ✖ |
| Edit insight sebelum kirim | ✖ | ✔ | ✔ | ✔ | ✖ | ✖ |
| Kirim/export ke creator | ✖ | ✔ | ✔ | ✔ | ✖ | ✖ |

- **CPM adalah satu-satunya pemilik & pembuat report** (jam kerja). **Creator Support TIDAK boleh generate report** — perannya terbatas pada ads & monitoring live di luar jam kerja (Module 1 §2.1.F).
- CPM boleh **edit draft insight** sebelum kirim (human-in-the-loop). Semua generate & kirim tercatat.

**2.6 Log Aktivitas CPM (bukti fungsi CM berjalan)**
- Setiap generate report dicatat: **CPM mana, untuk creator mana (`CRT-xxxxx`), kapan, jenis (weekly/monthly), apakah ber-insight atau data-only.**
- Agregasi per CPM: **berapa kali buat report, untuk berapa creator, coverage** (creator yang di-handle vs yang benar-benar dibuatkan report).
- Dashboard CM Lead/Head: lihat CPM yang jarang/tidak membuat report untuk creator-nya → indikasi fungsi CM tidak berjalan. Feed langsung ke Module 3 (metrik hands-on CPM).
- Log ini masuk `audit_logs` + tabel ringkasan `cpm_report_activity`.

**2.7 Token Budget & Baseline (prinsip ratchet)**
- Tiap report catat `token_used` (0 bila insight di-skip).
- **Belum ada baseline dari tool lama.** Baseline dibangun dengan prinsip **"best achievement today becomes bare minimum tomorrow"**: sistem mencatat efisiensi terbaik yang pernah dicapai (mis. token per report terendah pada kualitas insight yang diterima), lalu menjadikannya **batas minimum** untuk periode berikutnya. Regresi di atas baseline (boros mendadak) memunculkan flag.
- Dashboard SPV/Head: token per report (rata-rata, terbaik, tren) + rasio report yang skip-LLM → memantau ratchet terus turun/stabil, tidak naik.

---

### 3. Flow

**3.1 Batch Generate Terjadwal**
1. Scheduler jalan (Senin/awal bulan).
2. Per CPM → ambil creator aktif yang di-handle.
3. **Data layer (batch, no LLM):** load data dari upload CSV platform (§5) → agregasi metrik inti + insight tambahan (§2.3) → delta vs periode lalu → tabel & chart.
4. **Gate (weekly):** cek delta vs threshold 15% (§2.4). Di bawah → data-only, lewati langkah 5.
5. **Insight layer (1 LLM call/creator):** kirim ringkasan angka terstruktur → draft insight + rekomendasi.
6. Report tersimpan `Draft`, catat log aktivitas CPM (§2.6), notifikasi CPM.

**3.2 Review & Kirim (human-in-the-loop)**
1. CPM buka report `Draft`.
2. Baca angka final + edit draft insight bila perlu.
3. "Finalisasi" → status `Final`, ter-log.
4. Export/kirim ke creator (Portal creator menyusul; sementara export PDF/link).

**3.3 On-Demand Generate**
- CPM/CM Lead/SPV pilih creator + periode → jalankan pipeline 3.1 langkah 3–6 untuk satu creator. Tetap dicatat di log aktivitas.

---

### 4. Example

**Skenario:** Senin pagi, scheduler generate weekly report untuk 42 creator yang di-handle CPM Dina.
- Data layer proses 42 creator dalam satu batch: metrik inti + tren live + funnel + kontribusi Top Campaign + posisi vs target level + alert kontrak — **0 token AI**.
- 30 creator delta ≤ 15% → report data-only, tanpa LLM.
- 12 creator delta > 15% → 12 LLM call kecil (bukan 42), input JSON ringkas ±300 token each.
- Dina buka 12 report ber-insight, edit 3 draft, finalisasi, export.
- Sistem catat: Dina buat 42 report minggu ini (12 ber-insight, 30 data-only), coverage 42/45 creator (3 creator belum dibuatkan → muncul di dashboard CM Lead).
- Token minggu ini jadi baseline "terbaik"; minggu depan tidak boleh lebih boros pada kualitas setara.

---

### 5. System Requirements

- **Data ingestion (CSV upload)**: CPM/admin upload **file CSV dari platform** (Shopee/TikTok) → parser → `platform_metrics_raw` (creator_id, period, metric, value, source[TAP/SAP/TopShop/other], upload_batch, uploaded_at). Idempotent per upload_batch; parsing Rupiah per Module 1 §0.7.
- **Aggregation engine**: server action/edge function menghitung semua metrik §2.3 (agregasi, delta, ranking, funnel, kontribusi campaign, posisi level, benchmark peer, alert kontrak/sharing) — **tanpa LLM**. Threshold gate di config table (default 15%, tunable).
- **Report store**: `creator_reports` (id, creator_id FK CRT-xxxxx, period_type, period_start, data_json, insight_draft, insight_final, status[Draft/Final], token_used, generated_by, finalized_by, generated_at).
- **CPM activity log**: `cpm_report_activity` (cpm_id, creator_id, period_type, generated_at, has_insight) + agregasi coverage. Juga tercermin di `audit_logs`.
- **AI Layer**: endpoint `generate_insight` — input JSON ringkas, output draft naratif + rekomendasi. Log `token_used`. Model reasoning ringan cukup.
- **Gate logic**: fungsi deterministik skip-LLM bila |delta| ≤ threshold (weekly).
- **Baseline/ratchet**: `token_baseline` menyimpan efisiensi terbaik per jenis report; regresi memicu flag. Prinsip: best-today = minimum-tomorrow.
- **Batch runner**: scheduler per CPM.
- **Frontend**: halaman report (tabel + chart dari data_json, editor insight), export PDF/link, mengikuti template existing; dashboard aktivitas CPM & token.

---

### 6. Open Assumptions

1. **Akses data platform — LOCKED.** Via **upload file CSV dari platform** (bukan API). Reliabilitas & kesegaran data bergantung pada kedisiplinan upload; pipeline idempotent per batch.
2. **Isi template — LOCKED + diperluas.** Metrik inti existing (GMV, NMV, GPM, AOV, top produk, sumber GMV) + insight tambahan §2.3 (tren live, funnel view→order, Top Campaign vs organik, posisi vs target level, alert kontrak/sharing, benchmark peer). Perlu final-check pemetaan field CSV → metrik saat implementasi.
3. **Threshold gate — LOCKED.** ±15% titik awal, tunable per metrik. (Contoh di §2.4.)
4. **Baseline — LOCKED (ratchet).** Belum ada baseline lama; dibangun sendiri dengan prinsip best-today = minimum-tomorrow. Angka konkret muncul setelah beberapa periode berjalan.
5. **Hands-on CPM — LOCKED.** Dihitung di Module 3; log aktivitas CPM (§2.6) & data report jadi sumbernya.

---

*Module 2 v3 — final, siap di-lock. Selaras dengan Module 1 v4.*
