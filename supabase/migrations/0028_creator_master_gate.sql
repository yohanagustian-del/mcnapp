-- 0028 — GERBANG MASTER KREATOR: upload data mingguan TIDAK LAGI membuat kreator.
--
-- Masalah yang diperbaiki (produksi, 2026-07-30): tabel `creators` berisi 3.269 baris
-- untuk hanya 1.140 username unik — satu username sampai 18 baris. Dua sebab:
--
--   1. BUG LOOKUP (akar masalah): resolveCreatorNames() mencari kreator existing dengan
--      menarik SELURUH tabel ke memori (`.select(...).limit(5000)`) lalu mencocokkan di
--      JS. Supabase/PostgREST memotong response di `db-max-rows` (1.000 baris), jadi
--      setiap kreator di luar 1.000 baris pertama dianggap "belum ada" → dibuat lagi
--      setiap upload. Duplikat memang mulai muncul tepat saat tabel melewati 1.000
--      baris (21 Jul 2026, 1.168 baris). Diperbaiki di kode dengan lookup berpaginasi
--      (src/lib/creators/registry.ts) — bukan di migration ini.
--
--   2. KEBIJAKAN: jalur upload mingguan (MCN/Shopee/leak/report deal) boleh MEMBUAT
--      master kreator (`creator.auto_prospect_from_upload` = 3.258 baris audit). Dua CM
--      yang meng-upload kreator yang sama otomatis menambah master. Keputusan user:
--      master kreator HANYA boleh dibuat lewat jalur akuisisi (form registrasi /
--      bulk upload / approve daftar tunggu) oleh Akuisisi + Management + CM Lead.
--
-- Migration ini menambah satu tabel penampung: username kreator yang muncul di file
-- upload tapi BELUM terdaftar di master tidak lagi dibuat otomatis dan tidak hilang
-- tanpa jejak — ia masuk DAFTAR TUNGGU di sini, lalu di-approve/ditolak di Acquisition
-- Workspace. Baris data mingguan milik username itu dilewati (dilaporkan di hasil
-- upload); setelah di-approve, file mingguannya di-upload ulang.
--
-- Unique index anti-duplikat di `creators` ada di migration 0029 — jalankan
-- scripts/dedupe-creators.sql (merge duplikat) DULU, baru 0029.

-- ============ creator_pending_registrations: daftar tunggu username belum terdaftar ============
create table if not exists creator_pending_registrations (
  id bigserial primary key,
  username text not null,
  -- Platform asal deteksi. NULL = tidak diketahui (dianggap 'tiktok' oleh kunci unik,
  -- sesuai kenyataan data: seluruh baris platform NULL di produksi berasal dari ingest TikTok).
  platform text check (platform in ('tiktok', 'shopee')),
  -- Jalur upload yang mendeteksi username ini.
  source text not null check (source in
    ('mcn_weekly', 'shopee_weekly', 'leak_artifact', 'leak_compute', 'deal_report')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- Berapa kali username ini muncul lagi di upload berikutnya (bukti "ini nyata, bukan typo").
  seen_count int not null default 1,
  rows_affected int,                                  -- baris file yang dilewati saat deteksi terakhir
  followers bigint,                                   -- snapshot dari file (bantu akuisisi menilai)
  gmv_snapshot numeric,                                -- snapshot GMV periode deteksi, informasi saja
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_batch_id text,
  last_batch_id text,
  detected_by uuid references team_members(id),        -- pengunggah file saat pertama terdeteksi
  reviewed_by uuid references team_members(id),
  reviewed_at timestamptz,
  review_note text,
  creator_id text references creators(id)              -- diisi saat approve
);

-- Satu baris per (username, platform) — deteksi berulang meng-update baris yang sama
-- (seen_count/last_seen_at), tidak menumpuk. NULL platform disatukan dengan 'tiktok'
-- supaya file tanpa info platform tidak membuat baris kembar.
create unique index if not exists creator_pending_uidx
  on creator_pending_registrations (lower(username), coalesce(platform, 'tiktok'));
create index if not exists creator_pending_status_idx
  on creator_pending_registrations (status, last_seen_at desc);

comment on table creator_pending_registrations is
  'Daftar tunggu master kreator (0028): username yang muncul di file upload mingguan tapi belum ada di `creators`. Upload TIDAK membuat kreator lagi — Akuisisi/Management/CM Lead yang approve (permission creators.pending_review), lalu file mingguannya di-upload ulang. Ditulis service role dari jalur ingest; otorisasi di server action.';
comment on column creator_pending_registrations.source is
  'Jalur deteksi: mcn_weekly (/ingest TikTok) | shopee_weekly (/ingest Shopee) | leak_artifact (upload Excel artifak) | leak_compute (analisa kebocoran in-platform) | deal_report (report sesi live deal).';
comment on column creator_pending_registrations.seen_count is
  'Jumlah upload yang pernah menyebut username ini selagi belum terdaftar. Tinggi = kreator nyata yang perlu segera didaftarkan; 1 = bisa jadi salah tulis.';
comment on column creator_pending_registrations.rows_affected is
  'Jumlah baris file yang dilewati pada deteksi TERAKHIR (data mingguan yang belum masuk karena kreator belum terdaftar).';
comment on column creator_pending_registrations.status is
  'pending = menunggu keputusan; approved = kreator sudah dibuat (lihat creator_id) — upload ulang file mingguannya; rejected = bukan kreator MEA / salah tulis, tidak dibuat.';
comment on column creator_pending_registrations.creator_id is
  'Kreator yang dibuat/dipakai saat approve. NULL selama pending/rejected.';

alter table creator_pending_registrations enable row level security;
-- Baseline pola tabel operasional di repo ini (0002/0004/0005/0016/0023): baca untuk
-- semua user login, tulis HANYA service role (server action) — otorisasi peran
-- (creators.pending_review / creators.create) di-enforce di
-- src/app/(portal)/workspace/acquisition/pending-actions.ts.
create policy cpr_select on creator_pending_registrations
  for select to authenticated using (true);

-- ============ creators_merge_map: jejak permanen hasil merge duplikat ============
-- Diisi oleh scripts/dedupe-creators.sql. Dipertahankan (bukan tabel temporer) supaya
-- id kreator lama yang sudah dihapus masih bisa dilacak ke id penggantinya — mis. saat
-- ada screenshot/laporan lama yang menyebut CRT- yang tidak ada lagi.
create table if not exists creators_merge_map (
  loser_id text primary key,
  winner_id text not null references creators(id),
  username text,
  platform text,
  merged_at timestamptz not null default now(),
  merged_by uuid references team_members(id)          -- NULL = dijalankan lewat SQL script
);
create index if not exists creators_merge_map_winner_idx on creators_merge_map (winner_id);

comment on table creators_merge_map is
  'Jejak merge duplikat kreator (scripts/dedupe-creators.sql): id yang DIHAPUS → id yang dipertahankan. Read-only, jangan dipakai sebagai FK oleh fitur baru.';

alter table creators_merge_map enable row level security;
create policy cmm_select on creators_merge_map for select to authenticated using (true);

-- ============ Dokumentasi gerbang di tabel creators ============
comment on column creators.username is
  'Handle TikTok/Shopee. KUNCI IDENTITAS master kreator: satu baris per (lower(username), platform) — dijaga unique index di 0029. Baris baru HANYA boleh dibuat lewat jalur akuisisi (form registrasi, bulk upload master, approve creator_pending_registrations) — jalur upload data mingguan tidak lagi membuat kreator (0028).';
