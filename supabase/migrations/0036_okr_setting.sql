-- 0036: OKR Setting (tab Config OKR / Director) — dokumen OKR naratif.
--
-- KONTEKS: `okr_key_results` yang lama adalah definisi KR yang BISA DI-SCORE
-- otomatis (kolom `metric` dipetakan ke adapter deterministik di src/lib/m3/
-- adapters.ts). Director butuh juga menulis OKR dalam bentuk kalimat — "Objective"
-- dan "Key Result" bebas teks dengan target 3 bulan — untuk KR yang belum punya
-- metrik otomatis. Itu yang disimpan di dua tabel di bawah.
--
-- Pembagian tanggung jawab (CLAUDE.md #4, satu sumber kebenaran):
--   okr_objectives + okr_objective_key_results = NASKAH OKR (apa yang dijanjikan).
--   okr_key_results + okr_actuals              = MESIN SCORING (bagaimana diukur).
-- Naskah tidak menghitung apa pun dan tidak menduplikasi angka aktual.
--
-- Objective sengaja jadi tabel sendiri, bukan kolom teks di tabel KR:
--   1. Satu Objective punya banyak Key Result (dependensi KR → Objective).
--   2. Objective yang sudah pernah diisi muncul lagi sebagai pilihan dropdown,
--      jadi Director tidak mengetik ulang paragraf yang sama (dan tidak lahir
--      varian ejaan seperti master deal warisan yang berantakan).

create table okr_objectives (
  id bigserial primary key,
  -- "OKR divisi CM" — short text bebas, satu nama OKR memuat banyak Objective.
  okr_name text not null check (length(trim(okr_name)) between 1 and 120),
  -- Paragraf: "Meningkatkan pertumbuhan kreator ...".
  objective text not null check (length(trim(objective)) between 1 and 2000),
  active bool not null default true,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now()
);

-- Anti-duplikat: Objective yang sama di nama OKR yang sama cukup satu baris —
-- inilah yang membuat dropdown tetap bersih walau diisi berkali-kali.
create unique index okr_objectives_uniq
  on okr_objectives (okr_name, objective);
create index okr_objectives_name_idx on okr_objectives (okr_name);

create table okr_objective_key_results (
  id bigserial primary key,
  -- KR selalu milik satu Objective; Objective hilang → KR-nya ikut hilang.
  objective_id bigint not null references okr_objectives(id) on delete cascade,
  -- Paragraf: "Total GMV yang dihasilkan oleh creator baru hasil ...".
  key_result text not null check (length(trim(key_result)) between 1 and 2000),
  -- Angka murni (boleh desimal). Rupiah/persen disimpan sebagai number —
  -- formatnya urusan target_unit, bukan urusan teks (CLAUDE.md #7).
  target numeric(18, 4) not null,
  -- Cara menampilkan target: 100 (angka) vs Rp100.000.000 (rupiah) vs 15% (persen).
  target_unit text not null default 'angka'
    check (target_unit in ('angka', 'rupiah', 'persen')),
  -- Target OKR = per quartal. Disimpan eksplisit supaya label "Target (3 bulan)"
  -- ikut di data, bukan cuma di UI.
  period_months int not null default 3 check (period_months between 1 and 12),
  active bool not null default true,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index okr_okr_kr_objective_idx on okr_objective_key_results (objective_id, id);

comment on table okr_objectives is
  'Naskah OKR Director: nama OKR + Objective (paragraf). Objective jadi pilihan dropdown untuk pengisian berikutnya.';
comment on table okr_objective_key_results is
  'Key Result naratif milik satu Objective + target 3 bulan. Bukan tabel scoring — scoring tetap di okr_key_results/okr_actuals.';

-- ============ RLS ============
-- Pola baseline repo: authenticated boleh SELECT (scoping per role di server
-- action), mutasi HANYA lewat service role (server action + requirePermission
-- 'm3.set_target' → Director). Portal kreator tidak pernah melihat OKR internal.
alter table okr_objectives             enable row level security;
alter table okr_objective_key_results  enable row level security;

create policy okr_objectives_select on okr_objectives
  for select to authenticated using (true);
create policy okr_objectives_creator_deny on okr_objectives
  as restrictive for select using (not is_creator_user());

create policy okr_obj_kr_select on okr_objective_key_results
  for select to authenticated using (true);
create policy okr_obj_kr_creator_deny on okr_objective_key_results
  as restrictive for select using (not is_creator_user());
