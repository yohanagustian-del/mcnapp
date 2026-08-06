-- Request penugasan CM (CPM tidak bisa assign kreator ke dirinya sendiri).
--
-- CLAUDE.md #2: memindahkan kepemilikan kreator dilakukan MANUSIA dan berpotensi
-- merugikan (CM A "mengambil" kreator CM B), jadi polanya APPROVAL — bukan auto.
-- CPM mengajukan request, pemegang izin m8.assign_creator (Director/Head/SPV/CM
-- Lead) yang memutuskan. Keputusan ditulis ke audit_logs dengan type='approval'.
--
-- Kepemilikan kreator sendiri tetap satu sumber: kolom creators.owner_cpm_id.
-- Tabel ini hanya antrean permintaan, bukan salinan kedua dari kepemilikan.

create table creator_cm_requests (
  id text primary key,                                  -- REQ-xxxxx (genId, util terpusat)
  creator_id text not null references creators(id) on delete cascade,
  -- CM pengaju = calon pemilik kreator kalau request diterima.
  requested_by uuid not null references team_members(id) on delete cascade,
  -- Pemilik saat request dibuat: dipakai untuk membedakan "kreator belum punya CM"
  -- (klaim) dari "pindah dari CM lain" (take-over) saat approver menimbang.
  current_owner_id uuid references team_members(id) on delete set null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_by uuid references team_members(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- Satu CM tidak bisa menumpuk request untuk kreator yang sama; setelah diputuskan
-- (accepted/rejected) dia boleh mengajukan lagi.
create unique index ccr_one_pending_idx
  on creator_cm_requests (creator_id, requested_by)
  where status = 'pending';

create index ccr_status_idx on creator_cm_requests (status, created_at desc);
create index ccr_requested_by_idx on creator_cm_requests (requested_by);

alter table creator_cm_requests enable row level security;

-- Baseline 0016/0019: select untuk authenticated (scoping di server action),
-- tulis lewat service role saja (server action + requirePermission).
create policy ccr_select on creator_cm_requests for select to authenticated using (true);
-- Portal kreator (principal eksternal) tidak pernah melihat antrean internal ini.
create policy ccr_creator_deny on creator_cm_requests as restrictive for select
  using (not is_creator_user());
