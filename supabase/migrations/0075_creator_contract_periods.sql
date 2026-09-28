-- PLAN_MSDPS_mcnapp.md Paket D (R5, disetujui pemilik 2026-09-28): riwayat periode
-- kontrak kreator, append-only — setiap perpanjangan menambah baris baru, tidak
-- pernah mengubah baris lama. creators.contract_end_date tetap ada sebagai cache
-- "periode terakhir" (dibaca di mana-mana sudah), tapi sejak migrasi ini SATU-SATUNYA
-- penulisnya adalah renewCreatorContract() (lib/creators/contract-renewal.ts) —
-- registerCreator's re-register path (workspace/acquisition/actions.ts) dialihkan ke
-- engine yang sama, bukan UPDATE sendiri.

create table creator_contract_periods (
  id bigserial primary key,
  creator_id text not null references creators(id),
  start_date date not null,
  end_date date not null,
  kind text not null check (kind in ('baru', 'perpanjangan')),
  notes text,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  constraint ck_ccp_dates check (end_date > start_date)
);
create index on creator_contract_periods (creator_id, start_date desc);

comment on table creator_contract_periods is
  'Append-only history of creator contract periods (PLAN_MSDPS Paket D). One row per signup (kind=baru) or renewal (kind=perpanjangan), written only via renewCreatorContract(). creators.contract_end_date/status stay the cache of the latest period — read everywhere as before, written only by that engine.';
comment on column creator_contract_periods.notes is
  'Free text (e.g. reason for a gap between periods, Q8 — gaps are allowed and recorded as-is, never rejected).';

alter table creator_contract_periods enable row level security;
create policy ccp_select on creator_contract_periods for select to authenticated using (true);
-- Not creator-facing data (internal contract history) — same restrictive-deny pattern
-- as products_tap/brand_leads (CLAUDE.md #9).
create policy ccp_creator_deny on creator_contract_periods as restrictive for select
  using (not is_creator_user());
-- writes via service role only (renewCreatorContract) — no user insert/update/delete policy.

-- Append-only at the trigger level too: writes go through the service-role client
-- (RLS is bypassed there), so only a trigger stops a future UPDATE/DELETE call from
-- silently rewriting history, whatever client issues it.
create or replace function guard_contract_period_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'creator_contract_periods is append-only — insert a new period instead of editing an existing one';
end $$;
create trigger trg_ccp_no_update before update on creator_contract_periods
  for each row execute function guard_contract_period_append_only();
create trigger trg_ccp_no_delete before delete on creator_contract_periods
  for each row execute function guard_contract_period_append_only();

-- Backfill: one 'baru' period per existing creator that has both dates and a sane
-- range. Creators missing either date, or with end_date <= join_date (dirty legacy
-- rows), get no backfilled period — D-03's countdown page already treats a creator
-- with zero periods as "no history", it does not assume one exists.
insert into creator_contract_periods (creator_id, start_date, end_date, kind, notes, created_at)
select id, join_date, contract_end_date, 'baru',
  'Backfill migrasi 0075 dari creators.join_date/contract_end_date', now()
from creators
where join_date is not null and contract_end_date is not null and contract_end_date > join_date;

-- CLAUDE.md: jangan hardcode threshold — dipakai /creators (Sisa Kontrak), report M2
-- (contract_alert), dan /workspace/acquisition/perpanjangan (bucket filter).
insert into app_config (key, value) values
  ('m8.contract_alert_days', '{"warning":60,"danger":30}'::jsonb)
on conflict (key) do nothing;
