-- ============================================================
-- 0028_user_management.sql
-- Manajemen user dari Dashboard Director + usulan dari OD.
--
-- Menambah:
--   1. team_members.must_change_password  → user baru dibuat dengan password sementara
--      oleh Director dan WAJIB menggantinya sebelum bisa memakai portal.
--   2. Policy DELETE pada team_members (Director only) — sebelumnya tidak ada policy
--      delete sama sekali, jadi hapus permanen mustahil bahkan bagi Director.
--   3. guard_last_director diperluas: sebelumnya hanya menjaga active=false & DELETE,
--      TIDAK menjaga perubahan role. Fitur "ganti jabatan" membuka celah itu (Director
--      terakhir mengubah role dirinya sendiri → 0 Director). Sekarang ikut dijaga.
--   4. Perilaku ON DELETE untuk semua FK yang menunjuk team_members:
--        - tool_usage_logs  → CASCADE  (telemetri page-view, bukan catatan bisnis)
--        - kolom NULLABLE   → SET NULL (jejak bisnis tetap ada, pelakunya jadi null;
--                                       identitas pelaku diselamatkan ke audit_logs.actor_label
--                                       oleh server action sebelum baris dihapus)
--        - kolom NOT NULL   → dibiarkan RESTRICT dengan sengaja. Ini catatan bisnis yang
--          wajib punya pelaku (metric_upload_batches.uploaded_by, live_schedule_slots.created_by),
--          jadi hapus permanen DITOLAK dan Director diarahkan menonaktifkan user.
--   5. member_change_requests → antrean usulan OD (od_viewer read-only: usulan tidak
--      berefek apa pun sampai Director menyetujui; eksekusi tetap di bawah m11.manage_accounts).
-- ============================================================

-- ---------- 1. Password sementara: wajib ganti saat login pertama ----------
alter table team_members
  add column if not exists must_change_password boolean not null default false;

comment on column team_members.must_change_password is
  'true = akun dibuat Director dengan password sementara; portal memblokir semua halaman sampai user mengganti passwordnya sendiri (di-reset oleh changePassword).';

-- ---------- 2. Hapus permanen: Director only ----------
drop policy if exists tm_delete_director on team_members;
create policy tm_delete_director on team_members for delete to authenticated
  using (public.current_member_role() = 'director');

-- ---------- 3. Guard Director terakhir: tambah proteksi perubahan role ----------
-- Versi 0010 hanya menutup deaktivasi & delete. Ganti jabatan lolos begitu saja.
create or replace function guard_last_director() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare active_dirs int;
begin
  if old.role = 'director'
     and ( (tg_op = 'DELETE')
        or (tg_op = 'UPDATE' and old.active = true
            and (new.active = false or new.role <> 'director')) ) then
    select count(*) into active_dirs
    from team_members
    where role = 'director' and active = true and id <> old.id;
    if active_dirs < 1 then
      raise exception 'cannot remove the last active Director (at least 1 required)';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ---------- 4. Perilaku ON DELETE seluruh FK → team_members ----------
-- Dijalankan dinamis atas pg_constraint supaya tidak ada FK yang terlewat dan
-- migrasi ini tetap benar walau nama constraint berbeda di environment lain.
-- Dijalankan SEBELUM member_change_requests dibuat; tabel itu mendeklarasikan
-- perilaku ON DELETE-nya sendiri secara eksplisit di bawah.
do $$
declare c record;
begin
  for c in
    select con.conname, rel.relname as tbl, att.attname as col, att.attnotnull as notnull
    from pg_constraint con
    join pg_class rel      on rel.oid = con.conrelid
    join pg_class frel     on frel.oid = con.confrelid
    join pg_attribute att  on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f'
      and frel.relname = 'team_members'
      and frel.relnamespace = 'public'::regnamespace
      and rel.relnamespace  = 'public'::regnamespace
      and array_length(con.conkey, 1) = 1
  loop
    if c.tbl = 'tool_usage_logs' then
      -- Telemetri adopsi sistem: ikut terhapus bersama usernya.
      execute format('alter table public.%I drop constraint %I', c.tbl, c.conname);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.team_members(id) on delete cascade',
        c.tbl, c.conname, c.col);
    elsif not c.notnull then
      -- Jejak bisnis tetap ada; kolom pelaku jadi null.
      execute format('alter table public.%I drop constraint %I', c.tbl, c.conname);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references public.team_members(id) on delete set null',
        c.tbl, c.conname, c.col);
    end if;
    -- NOT NULL → sengaja dibiarkan RESTRICT (lihat header).
  end loop;
end $$;

-- ---------- 5. Antrean usulan perubahan user (OD → Director) ----------
create table if not exists member_change_requests (
  id bigserial primary key,
  kind text not null check (kind in ('create','update','deactivate','delete')),
  -- Target jadi null kalau usernya benar-benar dihapus; target_label menyimpan
  -- snapshot teks supaya riwayat usulan tetap terbaca setelah itu.
  target_member_id uuid references team_members(id) on delete set null,
  target_label text not null,
  payload jsonb not null default '{}'::jsonb,   -- field yang diusulkan (create/update)
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references team_members(id) on delete set null,
  requested_by_label text not null,
  requested_at timestamptz not null default now(),
  decided_by uuid references team_members(id) on delete set null,
  decided_at timestamptz,
  decision_note text
);
create index if not exists mcr_status_time on member_change_requests (status, requested_at desc);
create index if not exists mcr_target on member_change_requests (target_member_id);

comment on table member_change_requests is
  'Usulan perubahan akun tim dari OD (od_viewer). Baris di sini TIDAK mengubah apa pun: eksekusi hanya terjadi saat Director menyetujui lewat server action ber-permission m11.manage_accounts.';

alter table member_change_requests enable row level security;

-- Baca: management + OD (OD perlu melihat status usulannya sendiri).
create policy mcr_select on member_change_requests for select to authenticated
  using (public.is_management() or public.current_member_role() = 'od_viewer');

-- Ajukan: OD saja, dan hanya atas namanya sendiri.
create policy mcr_insert_od on member_change_requests for insert to authenticated
  with check (
    public.current_member_role() = 'od_viewer'
    and requested_by = auth.uid()
    and status = 'pending'
  );

-- Putuskan: Director saja.
create policy mcr_decide_director on member_change_requests for update to authenticated
  using (public.current_member_role() = 'director')
  with check (public.current_member_role() = 'director');
