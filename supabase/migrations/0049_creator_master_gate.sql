-- SUSULAN DRIFT: gerbang master kreator (creator_pending_registrations + creators_merge_map).
--
-- KENAPA NOMORNYA 0049, BUKAN 0028. Migrasi ini pernah diterapkan LANGSUNG ke database
-- (production 2026-07-30, dicatat di riwayat Supabase sebagai "0028_creator_master_gate")
-- tanpa pernah ditulis sebagai file di repo. Akibatnya database punya objeknya, repo
-- tidak — environment baru yang dibangun dari folder ini kehilangan dua tabel di bawah.
-- File ini menutup lubang itu. Nomor 0028 sudah dipakai 0028_creators_delete_rls, jadi
-- urutannya menyusul di belakang; isinya tidak bergantung pada migrasi 0030–0048.
--
-- SETIAP PERNYATAAN DIBUAT AMAN DIJALANKAN ULANG (if not exists / drop-then-create):
-- production & staging sudah memuat objek ini, jadi replay harus jadi no-op, bukan error.

create table if not exists creator_pending_registrations (
  id bigserial primary key,
  username text not null,
  platform text check (platform in ('tiktok', 'shopee')),
  source text not null check (source in
    ('mcn_weekly', 'shopee_weekly', 'leak_artifact', 'leak_compute', 'deal_report')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  seen_count int not null default 1,
  rows_affected int,
  followers bigint,
  gmv_snapshot numeric,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  first_batch_id text,
  last_batch_id text,
  detected_by uuid references team_members(id),
  reviewed_by uuid references team_members(id),
  reviewed_at timestamptz,
  review_note text,
  creator_id text references creators(id)
);

create unique index if not exists creator_pending_uidx
  on creator_pending_registrations (lower(username), coalesce(platform, 'tiktok'));
create index if not exists creator_pending_status_idx
  on creator_pending_registrations (status, last_seen_at desc);

comment on table creator_pending_registrations is
  'Daftar tunggu master kreator: username yang muncul di file upload mingguan tapi belum ada di `creators`. Upload TIDAK membuat kreator lagi — Akuisisi/Management/CM Lead yang approve (permission creators.pending_review), lalu file mingguannya di-upload ulang. Ditulis service role dari jalur ingest; otorisasi di server action.';
comment on column creator_pending_registrations.source is
  'Jalur deteksi: mcn_weekly | shopee_weekly | leak_artifact | leak_compute | deal_report.';
comment on column creator_pending_registrations.seen_count is
  'Jumlah upload yang pernah menyebut username ini selagi belum terdaftar.';
comment on column creator_pending_registrations.rows_affected is
  'Jumlah baris file yang dilewati pada deteksi TERAKHIR.';
comment on column creator_pending_registrations.status is
  'pending = menunggu; approved = kreator dibuat (lihat creator_id); rejected = bukan kreator MEA / salah tulis.';
comment on column creator_pending_registrations.creator_id is
  'Kreator yang dibuat/dipakai saat approve. NULL selama pending/rejected.';

alter table creator_pending_registrations enable row level security;
drop policy if exists cpr_select on creator_pending_registrations;
create policy cpr_select on creator_pending_registrations
  for select to authenticated using (true);

create table if not exists creators_merge_map (
  loser_id text primary key,
  winner_id text not null references creators(id),
  username text,
  platform text,
  merged_at timestamptz not null default now(),
  merged_by uuid references team_members(id)
);
create index if not exists creators_merge_map_winner_idx on creators_merge_map (winner_id);

comment on table creators_merge_map is
  'Jejak merge duplikat kreator (scripts/dedupe-creators.sql): id yang DIHAPUS -> id yang dipertahankan. Read-only.';

alter table creators_merge_map enable row level security;
drop policy if exists cmm_select on creators_merge_map;
create policy cmm_select on creators_merge_map for select to authenticated using (true);

comment on column creators.username is
  'Handle TikTok/Shopee. KUNCI IDENTITAS master kreator: satu baris per (lower(username), platform) — dijaga unique index di 0050. Baris baru HANYA lewat jalur akuisisi (form registrasi, bulk upload master, approve creator_pending_registrations) — jalur upload data mingguan tidak membuat kreator.';
