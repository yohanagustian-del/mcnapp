-- ============================================================
-- 0066_live_report_schedule_and_report_v2.sql
-- (1) Report live stream dari Jadwal Live (M13) — memakai ENGINE & TABEL yang
--     SAMA dengan sesi live Special Project (M7 v2), pemiliknya saja yang beda.
-- (2) Report Kreator (M2) versi 2 — kolom produk tambahan di creator_top_products
--     + benchmark/aturan report di app_config (CLAUDE.md: threshold tidak di-hardcode).
--
-- Kenapa satu tabel, bukan tabel baru untuk sesi jadwal (CLAUDE.md #4):
-- file yang diupload PERSIS SAMA (export TikTok LIVE Center: Product + Trend
-- Stats), pemeriksaan V1–V7 sama, dan bentuk report sama. Yang berbeda hanya
-- "siapa pemilik sesi": project (dipantau singkat selama project) atau slot
-- jadwal live (tiap kreator live). Dua tabel = dua parser + dua report =
-- rumus yang lama-lama berbeda. Jadi `project_live_sessions.project_id`
-- dilonggarkan menjadi nullable dan ditambah `schedule_slot_id`; tepat satu
-- dari keduanya terisi — pola yang sama dengan tracking report campaign
-- (deal_id XOR project_id, lib/deals/report-actions.ts).
-- ============================================================

-- ---------- 1. Enum period_type: report per sesi live dari jadwal ----------
-- Nilai baru tidak dipakai di migrasi ini (aturan ALTER TYPE ... ADD VALUE
-- dalam satu transaksi) — sama seperti 0052 menambah 'project'.
alter type report_period_t add value if not exists 'live_session';

-- ---------- 2. project_live_sessions: pemilik = project ATAU slot jadwal ----------
alter table project_live_sessions alter column project_id drop not null;
alter table project_live_sessions
  add column schedule_slot_id bigint references live_schedule_slots(id);
alter table project_live_sessions
  add constraint ck_live_session_owner
  check (((project_id is not null)::int + (schedule_slot_id is not null)::int) = 1);
create index idx_live_sessions_schedule_slot
  on project_live_sessions (schedule_slot_id) where schedule_slot_id is not null;
-- Sesi milik kreator lintas pemilik — dipakai report M2 (semua sesi kreator dalam
-- satu periode, dari project mana pun maupun jadwal).
create index idx_live_sessions_creator_date
  on project_live_sessions (creator_id, session_date);

-- R37 untuk sesi milik jadwal: kunci alami (project_id) di 0063 tidak berlaku
-- saat project_id NULL (NULL berbeda satu sama lain di unique index), jadi
-- kuncinya ditulis eksplisit: satu (kreator, tanggal, nomor sesi) di antara
-- sesi jadwal yang masih dihitung.
create unique index project_live_sessions_slot_natural_key
  on project_live_sessions (creator_id, session_date, session_no)
  where project_id is null and attribution_status <> 'voided';

comment on column project_live_sessions.project_id is
  'Pemilik sesi bila diupload dari Special Project (M7). NULL bila sesi milik slot Jadwal Live — lihat schedule_slot_id. Tepat satu dari keduanya terisi (ck_live_session_owner).';
comment on column project_live_sessions.schedule_slot_id is
  'Pemilik sesi bila diupload dari Jadwal Live (M13, halaman /schedule/live/[slotId]). Opsional per slot: tidak semua jadwal live wajib dibuatkan report.';

-- View harian project hanya untuk sesi milik project (sesi jadwal punya
-- project_id NULL dan tidak boleh membentuk grup NULL di view ini).
create or replace view project_creator_daily_live_v with (security_invoker = on) as
select
  s.project_id, s.creator_id, s.session_date,
  count(*)::int as sessions,
  sum(s.gmv) as gmv,
  sum(s.orders) as orders,
  sum(s.items) as items,
  sum(s.customers) as customers,
  sum(s.duration_min) as duration_min,
  sum(s.views) as views,
  max(s.viewers_peak) as viewers_peak,
  sum(s.product_impressions) as product_impressions,
  sum(s.product_clicks) as product_clicks,
  sum(s.add_to_cart) as add_to_cart,
  sum(s.new_followers) as new_followers,
  sum(s.comments) as comments,
  sum(s.likes) as likes,
  sum(s.shares) as shares,
  (array_agg(s.session_no order by s.gmv desc, s.session_no))[1] as best_session_no,
  max(s.gmv) as best_session_gmv
from project_live_sessions s
where s.project_id is not null
  and s.attribution_status in ('verified', 'confirmed_manual')
group by s.project_id, s.creator_id, s.session_date;

-- ---------- 3. creator_reports: report per slot jadwal ----------
alter table creator_reports add column schedule_slot_id bigint references live_schedule_slots(id);
-- Sama seperti report project (0057): paling banyak satu draft & satu final per slot.
create unique index creator_reports_slot_final_key
  on creator_reports (schedule_slot_id) where schedule_slot_id is not null and status = 'final';
create unique index creator_reports_slot_draft_key
  on creator_reports (schedule_slot_id) where schedule_slot_id is not null and status = 'draft';
create index idx_creator_reports_creator_period on creator_reports (creator_id, period_type, period_start);

-- Suntingan tim atas TEKS report (ringkasan, insight box, rekomendasi) — override
-- per bagian di atas teks rule-based; angka tidak pernah disunting. Dikunci
-- saat status = final. Bentuk: lib/report/types.ts `ReportEdits`.
alter table creator_reports add column edits_json jsonb;
comment on column creator_reports.edits_json is
  'Override teks report oleh tim (izin reports.finalize) per bagian: {summary, insights: {key: {title, text}}, recommendations: {key: [..]}}. Null = seluruhnya otomatis (rule-based). Hanya bisa diubah saat draft.';

comment on column creator_reports.schedule_slot_id is
  'Terisi untuk report live stream dari Jadwal Live (period_type = live_session). RLS reports_creator_selfonly (0011) sudah mencakup: kreator hanya melihat report final miliknya.';

-- ---------- 4. creator_top_products: dimensi produk untuk report M2 v2 ----------
-- Semua kolom ini SUDAH ada di baris file MCN (McnRow di lib/ingest/schema.ts)
-- dan selama ini dibuang saat ingest; report "Produk terbaik untuk LIVE" vs
-- "untuk VIDEO" (beserta AOV, CTR, CTOR) tidak mungkin tanpa itu.
alter table creator_top_products
  add column live_gmv numeric not null default 0,
  add column video_gmv numeric not null default 0,
  add column items_sold int not null default 0,
  add column live_orders int not null default 0,
  add column video_orders int not null default 0,
  add column direct_gmv numeric not null default 0,
  add column ctr numeric,
  add column ctor numeric,
  add column shop_name text,
  add column level1_category text;

comment on column creator_top_products.ctr is
  'CTR produk, rata-rata berbobot GMV lintas hari dalam batch (null bila file tidak membawa kolomnya). Diisi mulai 0066; baris lama = null.';
comment on column creator_top_products.ctor is
  'CTOR produk, rata-rata berbobot GMV lintas hari dalam batch (null bila tidak ada). Diisi mulai 0066.';

-- ---------- 5. app_config: aturan & benchmark report M2 v2 ----------
-- Benchmark industri per niche (fraksi, bukan persen). `default` dipakai bila
-- niche kreator tidak ada di daftar; kunci niche dicocokkan huruf kecil dan
-- cukup mengandung kata kuncinya (mis. "Beauty & Personal Care" → beauty).
insert into app_config(key, value) values
  ('m2.live_benchmarks', '{
    "default": {"cvr": 0.03, "err": 0.02, "gpm": 3000, "ctr": 0.05, "ctor": 0.03},
    "beauty":  {"cvr": 0.053, "err": 0.02, "gpm": 5000, "ctr": 0.06, "ctor": 0.03},
    "fashion": {"cvr": 0.035, "err": 0.02, "gpm": 3500, "ctr": 0.05, "ctor": 0.025},
    "food":    {"cvr": 0.04, "err": 0.025, "gpm": 2500, "ctr": 0.06, "ctor": 0.04}
  }'),
  -- top_n: panjang tabel produk/sesi di report; live_duration_target_min: durasi
  -- sesi yang dianggap ideal (menit); long_session_min: ambang "Big Live";
  -- deep_dive_sessions: jumlah sesi terbaik yang dibedah; video_share_low:
  -- ambang kontribusi video dianggap rendah (fraksi).
  ('m2.report_rules', '{
    "top_n": 10,
    "live_duration_target_min": 300,
    "long_session_min": 240,
    "deep_dive_sessions": 2,
    "video_share_low": 0.15,
    "ctor_gap_ratio": 0.25
  }')
on conflict (key) do nothing;
