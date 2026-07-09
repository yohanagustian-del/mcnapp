-- M13 "Penjadwalan Live Streaming" — replaces the BizDev/CM live-scheduling Google Sheet.
-- CMs (creator managers) schedule daily live-streaming slots for the celebrity &
-- livestream creators they handle; BizDev inputs slots for brand-deal lives. Creator
-- Support verifies slots that ran outside CM working hours, CMs verify during their
-- hours. This migration is the persistence layer only — authorization (which role may
-- mutate which creator's slots, CPM-owns-own-creators scope) is enforced in the
-- server actions (src/app/(portal)/schedule/actions.ts), NOT in RLS.

-- ============ creators.live_roster: opt a creator into the schedule calendar ============
-- Manual flag toggled by CM lead / CPM / management (permission "schedule.roster").
-- Only flagged creators appear in the weekly schedule matrix — keeps the calendar to
-- the celeb/livestream roster instead of the entire creator base.
alter table creators add column if not exists live_roster boolean not null default false;
comment on column creators.live_roster is
  'True = creator appears in the M13 live-schedule calendar. Manual flag (CM lead/CPM/management via schedule.roster). Not synced from platform.';

-- ============ live_schedule_slots: one row per live slot per creator per day ============
-- No unique (creator_id, schedule_date): a creator can have multiple slots in one day
-- (e.g. two brand lives + an organik live). OFF slots carry no times, just off_reason.
create table live_schedule_slots (
  id bigserial primary key,
  creator_id text not null references creators(id),
  schedule_date date not null,
  start_time time,                        -- null for status='off'
  end_time time,                          -- null for status='off'
  status text not null default 'scheduled'
    check (status in ('scheduled','tentative','off','done')),
  off_reason text,                        -- free text when status='off' (e.g. "pulang kampung")
  brand_name text,                        -- free text (sheet has values like "MIX Brand")
  deal_id text references brand_deals(id),-- OPTIONAL link to a registered deal
  deals_by text check (deals_by in ('bd','cm','creator')),
  ads_payer text check (ads_payer in ('brand','mea','invoicing_mea','organik')),
  ads_note text,                          -- ads nominal & details, free text
  pk_ready boolean not null default false,-- Product Knowledge prepared
  product_set_title text,
  product_connected_tap boolean not null default false,
  fokus_produk text,                      -- focus product + promo notes
  actual_start time,                      -- filled at verification
  actual_end time,                        -- filled at verification
  verified_by uuid references team_members(id),
  verified_at timestamptz,
  created_by uuid not null references team_members(id),
  updated_by uuid references team_members(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on live_schedule_slots (schedule_date);
create index on live_schedule_slots (creator_id, schedule_date);

comment on table live_schedule_slots is
  'M13 live-streaming schedule slots. One row per creator per slot per day (no daily uniqueness — multiple lives/day allowed). Written only via service role inside schedule server actions; scope authorization (CPM owns own creators) enforced there.';
comment on column live_schedule_slots.status is
  'scheduled = planned; tentative = not yet confirmed; off = creator not live that day (see off_reason); done = verified after the fact (locked from edit/delete).';
comment on column live_schedule_slots.off_reason is 'Free text reason when status=''off'' (e.g. "pulang kampung"). Null otherwise.';
comment on column live_schedule_slots.deal_id is 'Optional FK to a registered brand_deals row; brand_name may be present without a deal_id (free-text brand).';
comment on column live_schedule_slots.deals_by is 'Who sourced the deal for this live: bd | cm | creator.';
comment on column live_schedule_slots.ads_payer is 'Who pays the ads for this live: brand | mea | invoicing_mea | organik.';
comment on column live_schedule_slots.pk_ready is 'Product Knowledge prepared for the live.';
comment on column live_schedule_slots.product_connected_tap is 'Product set connected in TAP.';
comment on column live_schedule_slots.actual_start is 'Actual live start time, filled at verification (schedule.verify).';
comment on column live_schedule_slots.actual_end is 'Actual live end time, filled at verification (schedule.verify).';
comment on column live_schedule_slots.verified_by is 'team_member who verified the slot (CM during work hours, Creator Support outside them).';

alter table live_schedule_slots enable row level security;
create policy lss_select on live_schedule_slots for select to authenticated using (true);
-- writes via service role only (schedule server actions) — no user insert/update/delete policy.
-- Fine-grained authorization (schedule.edit/verify/roster + CPM-owns-own-creators scope) is
-- enforced in src/app/(portal)/schedule/actions.ts, not in RLS.
