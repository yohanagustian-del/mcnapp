-- ============================================================
-- 0100_ads_request_finance.sql
-- Request Ads (Jadwal Live + Special Project) + lapisan Finance.
-- Plan: docs/plans/ADS_TRACKING_FINANCE_2026-10.md · keputusan D-2026-10-31-1…7.
--
-- SATU entitas request = baris ads_briefs (0012) yang diperluas — bukan tabel baru —
-- karena ads_campaign_results.ads_spent-nya sudah menjadi sumber tunggal ads spend M7
-- (project_ads_spend_v → recompute_project_daily). Pemilik request = slot Jadwal Live
-- ATAU Special Project (pola project_live_sessions 0066).
--
-- Ditulis tanpa pernyataan penghapusan policy/trigger (K23: apply_migration menggantung). Idempoten.
-- ============================================================

-- ---------- 1. ads_briefs: pendanaan, pemilik slot, jejak ACC ----------
alter table ads_briefs
  add column if not exists schedule_slot_id bigint references live_schedule_slots(id),
  add column if not exists funding_type text,
  add column if not exists payment_method text,
  add column if not exists payer_name text,
  add column if not exists budget_month date,
  add column if not exists finance_status text not null default 'belum_dicek',
  add column if not exists finance_checked_by uuid references team_members(id),
  add column if not exists finance_checked_at timestamptz,
  add column if not exists finance_note text,
  add column if not exists cash_received_at date,
  add column if not exists executed_by uuid references team_members(id),
  add column if not exists executed_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ads_brief_funding_type') then
    alter table ads_briefs add constraint ck_ads_brief_funding_type
      check (funding_type is null or funding_type in ('mea_budget','creator_budget','brand_budget','tiktok_ads_credit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ads_brief_payment_method') then
    alter table ads_briefs add constraint ck_ads_brief_payment_method
      check (
        payment_method is null
        or (payment_method in ('cash_upfront','invoice') and funding_type in ('creator_budget','brand_budget'))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ads_brief_finance_status') then
    alter table ads_briefs add constraint ck_ads_brief_finance_status
      check (finance_status in ('belum_dicek','disetujui','ditolak'));
  end if;
  -- Tepat satu pemilik untuk request baru; baris lama 0012 (deal_id saja) boleh tanpa keduanya.
  if not exists (select 1 from pg_constraint where conname = 'ck_ads_brief_owner') then
    alter table ads_briefs add constraint ck_ads_brief_owner
      check ((schedule_slot_id is not null)::int + (project_id is not null)::int <= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ads_brief_budget_month') then
    alter table ads_briefs add constraint ck_ads_brief_budget_month
      check (budget_month is null or extract(day from budget_month) = 1);
  end if;
end $$;

-- Status: perluas daftar (nilai lama tetap sah — D-2026-10-31-7).
alter table ads_briefs drop constraint if exists ads_briefs_status_check;
alter table ads_briefs add constraint ads_briefs_status_check
  check (status in (
    'baru','menunggu_approval',                -- lama (0012)
    'diajukan','menunggu_approval_director','menunggu_finance','siap_dieksekusi',
    'dikerjakan','selesai','ditolak','batal'
  ));

create index if not exists idx_briefs_slot on ads_briefs(schedule_slot_id);
create index if not exists idx_briefs_funding_month on ads_briefs(funding_type, budget_month);
create index if not exists idx_briefs_creator_month on ads_briefs(creator_id, budget_month);

comment on column ads_briefs.schedule_slot_id is 'Pemilik request = slot Jadwal Live (M13). Tepat satu dari (schedule_slot_id, project_id) untuk request baru.';
comment on column ads_briefs.funding_type is 'mea_budget | creator_budget | brand_budget | tiktok_ads_credit (D-2026-10-31-3). NULL = brief lama 0012.';
comment on column ads_briefs.payment_method is 'cash_upfront | invoice — hanya untuk creator_budget/brand_budget.';
comment on column ads_briefs.budget_month is 'Bulan jatah MEA yang dipakai (YYYY-MM-01), = bulan tanggal live/project. Hanya mea_budget.';
comment on column ads_briefs.finance_status is 'belum_dicek | disetujui | ditolak — jejak ACC Finance/Head (status request = kolom status).';
comment on column ads_briefs.cash_received_at is 'Tanggal uang masuk untuk cash_upfront — wajib terisi sebelum ACC (Finance).';

-- ---------- 2. Jatah budget MEA per kreator per bulan (D-2026-10-31-4) ----------
create table if not exists creator_ads_monthly_budgets (
  creator_id text not null references creators(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  budget numeric not null check (budget >= 0),
  note text,
  set_by uuid references team_members(id),
  set_at timestamptz not null default now(),
  primary key (creator_id, month)
);
comment on table creator_ads_monthly_budgets is
  'Jatah budget ads MEA per kreator per bulan, ditetapkan Head (m10.mea_budget_set). Tanpa baris = 0. Sisa bulan hangus. Terpakai dihitung view creator_mea_budget_usage_v.';

alter table creator_ads_monthly_budgets enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'creator_ads_monthly_budgets' and policyname = 'camb_select') then
    create policy camb_select on creator_ads_monthly_budgets for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'creator_ads_monthly_budgets' and policyname = 'camb_creator_deny') then
    create policy camb_creator_deny on creator_ads_monthly_budgets as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

-- ---------- 3. Invoice (D-2026-10-31-6) ----------
create table if not exists ads_invoices (
  id text primary key,                                  -- INV-YYYYMM-NNNN, tidak pernah dipakai ulang
  request_id bigint not null references ads_briefs(id),
  bill_to_type text not null check (bill_to_type in ('creator','brand')),
  bill_to_name text not null,
  bill_to_detail text,                                  -- alamat/NPWP/kontak bebas
  dpp numeric not null check (dpp >= 0),
  ppn_rate numeric not null check (ppn_rate >= 0),
  ppn numeric not null check (ppn >= 0),
  total numeric not null check (total >= 0),
  issued_at date not null,
  due_date date not null,
  status text not null default 'terbit' check (status in ('terbit','lunas','batal')),
  paid_at date,
  paid_amount numeric check (paid_amount is null or paid_amount >= 0),
  proof_url text,
  note text,
  created_by uuid references team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Satu request = maksimal satu invoice aktif.
create unique index if not exists ads_invoices_request_active_uniq
  on ads_invoices (request_id) where status <> 'batal';
create index if not exists ads_invoices_status_due_idx on ads_invoices (status, due_date);

comment on table ads_invoices is
  'Invoice penagihan ads ke kreator/brand (satu per request aktif). Jatuh tempo DIHITUNG (due_date < today & belum lunas), tidak disimpan. Batal = status, bukan hapus.';

alter table ads_invoices enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ads_invoices' and policyname = 'ads_invoices_select') then
    create policy ads_invoices_select on ads_invoices for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ads_invoices' and policyname = 'ads_invoices_creator_deny') then
    create policy ads_invoices_creator_deny on ads_invoices as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

-- Riwayat invoice: append-only (CLAUDE.md: riwayat immutable).
create table if not exists ads_invoice_events (
  id bigserial primary key,
  invoice_id text not null references ads_invoices(id),
  event text not null check (event in ('dibuat','dikirim','diingatkan','dibayar','dibatalkan')),
  actor_id uuid references team_members(id),
  actor_label text,
  payload jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ads_invoice_events_invoice_idx on ads_invoice_events (invoice_id, created_at);

alter table ads_invoice_events enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ads_invoice_events' and policyname = 'aie_select') then
    create policy aie_select on ads_invoice_events for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ads_invoice_events' and policyname = 'aie_creator_deny') then
    create policy aie_creator_deny on ads_invoice_events as restrictive for select
      using (not is_creator_user());
  end if;
end $$;

create or replace function ads_invoice_events_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '[riwayat invoice tidak bisa diubah atau dihapus]';
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_ads_invoice_events_immutable') then
    create trigger trg_ads_invoice_events_immutable
      before update or delete on ads_invoice_events
      for each row execute function ads_invoice_events_immutable();
  end if;
end $$;

-- ---------- 4. View ----------
-- Terpakai jatah MEA per (kreator, bulan): request mea_budget yang tidak batal/ditolak.
create or replace view creator_mea_budget_usage_v with (security_invoker = on) as
select
  b.creator_id,
  b.budget_month,
  sum(coalesce(b.budget_approved, b.budget_requested, 0)) as used,
  count(*) as request_count
from ads_briefs b
where b.funding_type = 'mea_budget'
  and b.creator_id is not null
  and b.budget_month is not null
  and b.status not in ('batal', 'ditolak')
group by b.creator_id, b.budget_month;

-- Ads spend yang MENJADI BIAYA MEA per (project, tanggal) — D-2026-10-31-5: hanya
-- mea_budget (dan brief lama tanpa funding_type). Kolom sama dengan 0012, jadi
-- recompute_project_daily() (0054) tidak perlu diubah.
create or replace view project_ads_spend_v with (security_invoker = on) as
select b.project_id, r.period as date, sum(r.ads_spent) as ads_spend
from ads_campaign_results r join ads_briefs b on b.id = r.brief_id
where b.project_id is not null
  and (b.funding_type is null or b.funding_type = 'mea_budget')
group by b.project_id, r.period;

-- Rincian ads project per tipe pendanaan (informasi; bukan biaya MEA kecuali mea_budget).
create or replace view project_ads_spend_by_funding_v with (security_invoker = on) as
select
  b.project_id,
  coalesce(b.funding_type, 'mea_budget') as funding_type,
  count(distinct b.id) as request_count,
  sum(coalesce(b.budget_approved, b.budget_requested, 0)) as budget_total,
  coalesce(sum(r.ads_spent), 0) as ads_spend
from ads_briefs b
left join ads_campaign_results r on r.brief_id = b.id
where b.project_id is not null
  and b.status not in ('batal', 'ditolak')
group by b.project_id, coalesce(b.funding_type, 'mea_budget');

-- ---------- 5. platform_alerts: tipe baru (pola 0083: baca daftar yang ada, tambah) ----------
do $$
declare
  allowed text[];
  wanted text[] := array['ads_invoice_due','ads_invoice_overdue','ads_mea_budget_exhausted'];
  missing text[];
begin
  select array_agg(distinct m[1]) into allowed
  from pg_constraint c,
       regexp_matches(pg_get_constraintdef(c.oid), '''([a-z0-9_]+)''::text', 'g') m
  where c.conname = 'platform_alerts_alert_type_check'
    and c.conrelid = 'public.platform_alerts'::regclass;

  if allowed is null then
    return;
  end if;

  select array_agg(w) into missing from unnest(wanted) w where not (w = any(allowed));
  if missing is null then
    return;
  end if;

  alter table platform_alerts drop constraint platform_alerts_alert_type_check;
  execute format(
    'alter table platform_alerts add constraint platform_alerts_alert_type_check check (alert_type = any (%L::text[]))',
    allowed || missing
  );
end $$;

-- ---------- 6. app_config ----------
insert into app_config (key, value) values
  ('m10.invoice_ppn_rate', '0.11'::jsonb),
  ('m10.invoice_due_days', '14'::jsonb),
  ('m10.invoice_reminder_days', '3'::jsonb)
on conflict (key) do nothing;

-- ---------- 7. Pengingat penagihan harian (pola 0076) ----------
-- Idempoten per (invoice, tipe): alert tidak digandakan selama yang lama belum resolved.
create or replace function run_m10_invoice_reminders() returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  reminder_days int;
  today date := (now() at time zone 'Asia/Jakarta')::date;
  r record;
begin
  select (value #>> '{}')::int into reminder_days from app_config where key = 'm10.invoice_reminder_days';
  if reminder_days is null then reminder_days := 3; end if;

  for r in
    select i.id, i.bill_to_name, i.total, i.due_date,
           case when i.due_date < today then 'ads_invoice_overdue' else 'ads_invoice_due' end as alert_type
    from ads_invoices i
    where i.status = 'terbit'
      and i.due_date <= today + reminder_days
  loop
    if not exists (
      select 1 from platform_alerts a
      where a.alert_type = r.alert_type and a.entity_type = 'ads_invoices'
        and a.entity_id = r.id and a.resolved = false
    ) then
      insert into platform_alerts (alert_type, entity_type, entity_id, message, payload, week)
      values (
        r.alert_type, 'ads_invoices', r.id,
        case when r.alert_type = 'ads_invoice_overdue'
          then format('Invoice %s (%s) sudah lewat jatuh tempo %s — Rp%s', r.id, r.bill_to_name, to_char(r.due_date, 'DD Mon YYYY'), to_char(r.total, 'FM999G999G999G999'))
          else format('Invoice %s (%s) jatuh tempo %s — Rp%s', r.id, r.bill_to_name, to_char(r.due_date, 'DD Mon YYYY'), to_char(r.total, 'FM999G999G999G999'))
        end,
        jsonb_build_object('due_date', r.due_date, 'total', r.total),
        today
      );
      insert into ads_invoice_events (invoice_id, event, actor_label, payload)
      values (r.id, 'diingatkan', 'system:m10_invoice_reminders', jsonb_build_object('alert_type', r.alert_type, 'on', today));
    end if;
  end loop;
end $$;

comment on function run_m10_invoice_reminders() is
  'D-2026-10-31-6: alert in-app H-m10.invoice_reminder_days dan setelah lewat jatuh tempo untuk ads_invoices status terbit. Dijadwalkan pg_cron harian 06:00 WIB (23:00 UTC).';

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'm10_invoice_reminders') then
      perform cron.unschedule('m10_invoice_reminders');
    end if;
    perform cron.schedule('m10_invoice_reminders', '0 23 * * *', 'select run_m10_invoice_reminders();');
  else
    raise notice 'pg_cron schema not found — schedule run_m10_invoice_reminders() manually (daily).';
  end if;
end $$;
