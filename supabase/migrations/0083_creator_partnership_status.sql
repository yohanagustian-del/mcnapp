-- Improvement MCN T4 (docs/plans/IMPROVEMENT_MCN_2026-09.md, disetujui user 2026-09-30):
-- status kemitraan kreator — Management Partnership (TikTok & Shopee) dan Fee Agreement
-- (TikTok saja).
--
-- Sumbernya BUKAN data platform dan BUKAN edit manual per baris (keputusan Q2): user
-- menyiapkan file Excel (Username, Nama Kreator, Platform, kolom status) yang diunggah
-- lewat /creators (uploadPartnershipStatus, T5). Karena itu tabel ini tidak punya policy
-- tulis sama sekali — satu-satunya penulis adalah server action upload lewat service role,
-- pola sama dengan creator_contract_periods (0075).

-- ============ Log batch upload ============
create table creator_partnership_uploads (
  id bigserial primary key,
  file_name text,
  uploaded_by uuid references team_members(id),
  total_rows int not null default 0,
  matched_rows int not null default 0,
  unknown_usernames int not null default 0,
  changed_rows int not null default 0,
  alert_rows int not null default 0,
  -- Ringkasan hasil (username tak dikenal, nilai tak dikenal, dst.) untuk ditampilkan ulang.
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table creator_partnership_uploads is
  'One row per partnership-status Excel upload (Improvement MCN T5). Written only by uploadPartnershipStatus via service role.';

-- ============ Status terkini per kreator ============
create table creator_partnership_status (
  creator_id text primary key references creators(id) on delete cascade,
  platform text not null default 'tiktok' check (platform in ('tiktok', 'shopee')),
  -- null = the uploaded file had no (recognised) value for this column yet.
  partnership_status text
    check (partnership_status in ('linked', 'not_linked', 'link_req', 'unlink_req')),
  fee_agreement_status text
    check (fee_agreement_status in ('agree', 'disagree', 'agreement_req', 'cancellation_req')),
  source_batch_id bigint references creator_partnership_uploads(id) on delete set null,
  updated_by uuid references team_members(id),
  updated_at timestamptz not null default now(),
  -- Fee Agreement only exists on TikTok (dokumen "Improvement MCN": Shopee hanya punya
  -- Management Partnership).
  constraint ck_cps_fee_tiktok_only check (platform = 'tiktok' or fee_agreement_status is null)
);
create index on creator_partnership_status (partnership_status);
create index on creator_partnership_status (fee_agreement_status);

comment on table creator_partnership_status is
  'Current Management Partnership / Fee Agreement status per creator, from the user-maintained Excel file (Improvement MCN Q2) — not platform data, no manual per-row edit. Written only by uploadPartnershipStatus via service role; every change is in audit_logs (regression = platform_alert + platform_alerts.partnership_drop).';

-- ============ RLS ============
alter table creator_partnership_uploads enable row level security;
alter table creator_partnership_status enable row level security;

-- Read: internal staff (active team member). A CPM only sees their own creators,
-- same scope as CM Workspace (creators.owner_cpm_id).
create policy cps_select on creator_partnership_status for select to authenticated using (
  public.current_member_role() is not null
  and (
    public.current_member_role() <> 'cpm'
    or exists (
      select 1 from creators c
      where c.id = creator_partnership_status.creator_id and c.owner_cpm_id = auth.uid()
    )
  )
);
create policy cpu_select on creator_partnership_uploads for select to authenticated using (
  public.current_member_role() is not null
);

-- Not creator-facing data — restrictive deny is_creator_user() (pelajaran 0067/0068,
-- CLAUDE.md #9).
create policy cps_creator_deny on creator_partnership_status as restrictive for select
  using (not is_creator_user());
create policy cpu_creator_deny on creator_partnership_uploads as restrictive for select
  using (not is_creator_user());
-- No insert/update/delete policy: writes via service role only (uploadPartnershipStatus).

-- ============ Label + arti 8 status (dokumen user "Improvement MCN") ============
insert into app_config (key, value) values (
  'm8.partnership_status_labels',
  '{
    "partnership": {
      "linked":     {"label": "LINKED",     "meaning": "Binding"},
      "not_linked": {"label": "NOT LINKED", "meaning": "Sudah tidak binding"},
      "link_req":   {"label": "LINK REQ",   "meaning": "Undangan dikirim"},
      "unlink_req": {"label": "UNLINK REQ", "meaning": "Kreator request untuk berhenti binding"}
    },
    "fee_agreement": {
      "agree":            {"label": "AGREE",           "meaning": "Sharing komisi sudah disetujui kreator"},
      "disagree":         {"label": "DISAGREE",        "meaning": "Sharing komisi belum disetujui / diterima kreator"},
      "agreement_req":    {"label": "AGREEMENT REQ",   "meaning": "Sudah mengirimkan undangan sharing komisi"},
      "cancellation_req": {"label": "CANCELATION REQ", "meaning": "Kreator request untuk stop sharing komisi"}
    }
  }'::jsonb
) on conflict (key) do nothing;

-- ============ platform_alerts: tipe partnership_drop ============
-- The live constraint has drifted from the repo (production carries extra types that no
-- migration file lists), so instead of re-typing the list — which would silently drop
-- those — read the current allowed values and append partnership_drop. Idempotent.
do $$
declare
  allowed text[];
begin
  select array_agg(distinct m[1]) into allowed
  from pg_constraint c,
       regexp_matches(pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''::text', 'g') m
  where c.conname = 'platform_alerts_alert_type_check'
    and c.conrelid = 'public.platform_alerts'::regclass;

  if allowed is null or 'partnership_drop' = any(allowed) then
    return;
  end if;

  alter table platform_alerts drop constraint platform_alerts_alert_type_check;
  execute format(
    'alter table platform_alerts add constraint platform_alerts_alert_type_check check (alert_type = any (%L::text[]))',
    allowed || array['partnership_drop']
  );
end $$;
