# MCN MEA AI Platform
## Module 7: Special Project Management

---

### 1. Background

Per quartal MEA menjalankan **special project platform** (mis. China trip/showcase, bootcamp TikTok, program grooming top creator). Karakternya: **berdurasi** (2 minggu–1 bulan), punya **target GMV**, melibatkan creator **internal + external** (external wajib sign kontrak kerjasama), didukung ads, dan mengambil **man power** dari beberapa tim.

Module ini bukan tool analitik seperti M4–M6, tapi **manajemen proyek berdurasi**: memantau progres GMV harian vs target, mengelola daftar creator peserta, menghitung profitabilitas (ads vs komisi agar tidak rugi) secara real-time, dan mencatat siapa in-charge agar performa tim termonitor.

**Prioritas fungsi (dari PM):** (1) tracking GMV harian vs target, (2) cari/kelola creator peserta, (3) profitabilitas real-time dengan alert anti-rugi, (4) assign & monitor man power.

**Efisiensi token:** semua inti = tracking angka & agregasi = **deterministik, 0 token AI.** LLM opsional hanya untuk ringkasan naratif hasil project di akhir (1 call atas angka jadi) — tidak wajib.

---

### 2. Rules

**2.1 Entity Special Project**
- Project punya: nama, tipe (China trip/bootcamp/showcase/dll), **periode (start–end)**, **target GMV**, ads budget cap, daftar creator peserta, daftar man power in-charge, status (Planning/Aktif/Selesai).
- Creator peserta: internal (`CRT-xxxxx`) atau external (wajib flag **kontrak kerjasama** ter-sign sebelum aktif).

**2.2 Tracking GMV Harian vs Target (fungsi utama)**
- Target GMV project dipecah jadi **target harian bertipe ramp-up**: idealnya progres naik mengikuti tiap hari, tapi realnya achievement besar sering terjadi di hari-hari tertentu (mis. puncak campaign). Kurva ramp-up dipakai sebagai acuan, bukan patokan kaku harian.
- Tiap hari sistem tarik GMV aktual peserta (dari data platform/upload) → bandingkan ke target kumulatif → tampilkan **progres harian, gap ke target, proyeksi akhir** (run-rate).
- Status visual: on-track / behind / ahead. Deterministik, 0 token.

**2.3 Pemilihan Creator Peserta (manual + bantuan filter)**
- Pemilihan **manual** oleh PM (sementara ini). Sistem membantu dengan **filter**: karena special project biasanya menargetkan creator yang **sudah live stream**, sistem sediakan filter cepat **"live-active"** = creator dengan **GMV live minimal 65jt/bulan** (window tunable).
- **Flag live sendiri vs co-host:** creator ditandai apakah live sendiri atau pakai **co-host**. Live co-host biasanya **lebih lama scale up**, jadi perlu **cek manual** & flag khusus agar ekspektasi target/timeline disesuaikan. Flag ini muncul di daftar peserta.
- PM pilih dari hasil filter (internal) + tambah external manual (dengan binding sistem TikTok).
- (Kelak, bila diminta: bisa disambungkan ke engine matching M5/M6 untuk saran otomatis — tidak sekarang.)

**2.4 Profitabilitas Real-Time (alert anti-rugi)**
- Sistem hitung real-time selama project berjalan:
  - **GMV masuk** (agregat peserta)
  - **Ads spend** (akumulasi belanja iklan project)
  - **Komisi creator** (yang dibayar ke creator)
  - **Komisi/revenue MEA** (yang masuk ke MEA)
- **Margin project = revenue MEA − (ads spend + biaya lain project).**
- **Alert anti-rugi (LOCKED):** picu alert bila **ads spend > 100% dari komisi/revenue MEA** (bukan terhadap GMV creator). Artinya begitu belanja iklan melebihi komisi yang MEA terima, project mulai rugi di sisi MEA → **alert** ke PM/in-charge (event, bukan approval — Module 1 §0.6).
- Ads budget cap per project (dan per creator, mengikuti deal creator) tetap dijaga; over-cap juga memicu alert.

**2.5 Man Power (assign & monitor)**
- Tiap project mencatat **siapa in-charge** (dari role mana: CPM, Campaign Ops, Acquisition, dll) dan porsi keterlibatannya.
- Dashboard menunjukkan man power yang teralokasi ke project vs tugas rutin → Head/SPV bisa lihat beban tim tetap termonitor (project tidak menggerus performa rutin diam-diam).

**2.6 Keberhasilan Project (post-project)**
- Di akhir: **achievement = GMV aktual / target GMV**, margin akhir, jumlah creator aktif vs target, kontribusi live.
- Hasil disimpan sebagai riwayat project → bahan evaluasi & (nanti) feed ke OKR Module 3 (mis. KR special project Acquisition/Campaign External).

**2.7 RBAC**
| Aksi | Director | Head/SPV | Lead terkait | PM/In-charge | Staff peserta | Finance |
|---|---|---|---|---|---|---|
| Buat/edit project | ✔ | ✔ | (propose) | ✔ (bila ditunjuk) | ✖ | ✖ |
| Kelola creator peserta | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ |
| Lihat tracking GMV & profitabilitas | ✔ all | ✔ divisi | ✔ project | ✔ project | (view terbatas) | ✔ (dimensi biaya/ads) |
| Assign man power | ✔ | ✔ | ✔ | ✔ | ✖ | ✖ |
| Verifikasi biaya/ads/pembayaran | ✔ | ✔ | ✖ | ✖ | ✖ | ✔ |

- External creator harus punya **kontrak ter-sign** sebelum diaktifkan sebagai peserta (dicatat & di-audit).

**2.8 Efisiensi Token**
- Tracking, profitabilitas, man power = **0 token AI** (agregasi & rumus, batch harian + real-time update).
- LLM opsional 1 call untuk ringkasan naratif hasil akhir project — tidak wajib.

---

### 3. Flow

**3.1 Setup Project (Planning)**
1. PM buat project: periode, target GMV (→ pecah harian), ads budget cap, tipe.
2. Filter & pilih creator peserta (internal live-active + external ter-binding TikTok).
3. Assign man power in-charge.
4. Aktifkan project.

**3.2 Selama Project (Aktif)**
1. Harian: tarik GMV aktual peserta → progres vs target kumulatif → status on-track/behind/ahead.
2. Real-time: update ads spend, komisi creator, revenue MEA → margin → alert bila menuju rugi/over-cap.
3. PM/in-charge tindak lanjut alert (tambah/kurangi ads, dorong creator, dsb).

**3.3 Penutupan (Selesai)**
1. Hitung achievement GMV, margin akhir, kontribusi live, creator aktif.
2. Simpan riwayat project.
3. (Opsional) ringkasan naratif hasil (1 LLM call) + feed ke OKR Module 3.

---

### 4. Example

**Skenario:** Project "Showcase Ramadan", periode 3 minggu, target GMV 5M, ads cap 300jt.
- PM filter creator live-active kategori fashion/beauty → pilih 20 internal + 5 external (binding TikTok).
- Assign 2 Campaign Ops + 3 CPM sebagai in-charge.
- Target harian ~238jt. Hari ke-5: GMV kumulatif 1,0M vs target 1,19M → status **behind**, proyeksi akhir 4,2M (di bawah target) → PM dorong tambah sesi live.
- Real-time profitabilitas: ads spend 90jt, komisi MEA 110jt → ads masih < komisi MEA, aman. Hari ke-12 ads spend menembus 115jt sementara komisi MEA 108jt → **ads > komisi MEA → alert anti-rugi** ke PM → PM rem ads di creator ber-ROAS rendah.
- Akhir project: GMV 4,8M (96% target), margin positif, 78% GMV dari live. Riwayat disimpan, feed ke OKR.
- **Semua tracking tanpa LLM.**

---

### 5. System Requirements

- **Schema**:
  - `special_projects`: id, name, type, start_date, end_date, target_gmv, daily_target_curve, ads_budget_cap, status
  - `project_participants`: project_id, creator_id (FK CRT-xxxxx), is_external, tiktok_binding_status, live_type[solo/cohost], joined_at
  - `project_manpower`: project_id, member_id (FK team_members), role, involvement
  - `project_daily_metrics`: project_id, date, gmv_actual, ads_spend, creator_commission, mea_revenue (agregat harian)
- **Tracking engine**: batch harian tarik GMV peserta (dari `platform_metrics_raw`/upload) → progres vs target kumulatif & run-rate. Deterministik.
- **Profitability engine**: real-time/near-real-time hitung margin = mea_revenue − (ads_spend + biaya lain); alert bila margin menuju negatif atau ads > cap (event, bukan approval).
- **Creator filter**: query creator "live-active" (histori live + GMV live) untuk bantu pemilihan manual. External input manual + kontrak.
- **Frontend**: dashboard project (kurva GMV vs target, status, profitabilitas & alert, daftar peserta, man power). Panel setup & penutupan.
- **Config**: bentuk kurva target (flat/ramp), ambang alert rugi, ads cap.
- **Audit**: binding TikTok external, perubahan peserta/man power, alert → `audit_logs`.
- **AI Layer**: opsional `summarize_project` (1 call atas angka akhir) — tidak untuk tracking.
- **Estimasi token**: **0 token** untuk tracking/profitabilitas/man power. Hanya ringkasan akhir opsional yang pakai LLM.

---

### 6. Open Assumptions

1. **Sumber GMV harian — LOCKED.** Dari data platform yang di-upload (harian).
2. **Kurva target — LOCKED = ramp-up.** Target harian bertipe ramp-up sebagai acuan; achievement besar sering di hari tertentu, jadi kurva bukan patokan kaku.
3. **Live-active — LOCKED.** Min. **GMV live 65jt/bulan** (window tunable). **Flag live solo vs co-host** (co-host lebih lama scale up) — perlu cek manual, disesuaikan ekspektasi target/timeline.
4. **Update harian — LOCKED.** Ads spend & GMV sama-sama update harian → tracking & alert berbasis data harian.
5. **Ambang alert anti-rugi — LOCKED.** Alert bila **ads spend > 100% komisi/revenue MEA** (bukan terhadap GMV creator).
6. **Binding external — LOCKED.** "Kontrak" untuk peserta external special project = **binding via sistem TikTok** (bukan dokumen fisik/e-sign). Dicatat sebagai flag binding + audit. *(Kontrak tertulis Top Creator/Celebrity yang butuh e-sign ada di domain CM — lihat Module 8, bukan di sini.)*
7. **Feed ke OKR (Module 3) — CONFIRMED.** Hasil project jadi sumber KR special project (Acquisition/Campaign External); dikunci saat Module 3 dibangun.

---

*Module 7 — draft untuk direview & di-lock. Selaras dengan Module 1 v4.*
