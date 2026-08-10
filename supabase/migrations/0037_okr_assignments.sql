-- 0037: Assign OKR — nama OKR ditugaskan ke anggota tim.
--
-- Naskah OKR (0036) menjawab "apa yang dijanjikan"; tabel ini menjawab "siapa
-- yang memegangnya". Sengaja per ANGGOTA, bukan per role: satu divisi bisa
-- memakai beberapa OKR sekaligus dan ada anggota yang ikut OKR divisi lain,
-- jadi penugasan per orang adalah satu-satunya bentuk yang tidak memaksa
-- Director memakai role sebagai proxy tim.
--
-- Referensi ke naskah OKR memakai `okr_name` (teks), bukan FK — nama OKR bukan
-- entitas sendiri di 0036, melainkan kolom pengelompokan di okr_objectives.
-- Konsekuensinya: penugasan bisa menunjuk nama OKR yang seluruh Objective-nya
-- sudah dihapus. UI Config OKR menandai penugasan seperti itu supaya kelihatan,
-- daripada menghapusnya diam-diam (nama OKR bisa saja diisi ulang).

create table okr_assignments (
  id bigserial primary key,
  okr_name text not null check (length(trim(okr_name)) between 1 and 120),
  member_id uuid not null references team_members(id) on delete cascade,
  assigned_by uuid references team_members(id),
  created_at timestamptz not null default now()
);

-- Satu anggota tidak bisa dapat OKR yang sama dua kali (bulk assign idempoten).
create unique index okr_assignments_uniq on okr_assignments (okr_name, member_id);
create index okr_assignments_member_idx on okr_assignments (member_id);

comment on table okr_assignments is
  'Penugasan nama OKR (dari okr_objectives.okr_name) ke anggota tim. Diisi Director lewat section Assign OKR di Config OKR.';

-- ============ RLS ============
-- Sama seperti 0036: authenticated boleh SELECT (anggota perlu tahu OKR yang
-- dipegangnya), mutasi hanya lewat service role di server action dengan
-- permission m3.set_target. Portal kreator tidak pernah melihat data internal.
alter table okr_assignments enable row level security;

create policy okr_assignments_select on okr_assignments
  for select to authenticated using (true);
create policy okr_assignments_creator_deny on okr_assignments
  as restrictive for select using (not is_creator_user());
