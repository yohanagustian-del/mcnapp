-- Deal registration form revision: brand_deals.campaign_type gets 4 new values
-- (paid_endorsement, bulking_ads_endorse, bulking_ads, cps) requested post-release,
-- replacing the 3 original choices (paid, sample, extra_commission) in the form's
-- select. Decision: existing rows keep their old campaign_type value as-is — this is
-- a UI/vocabulary change, not a data correction, so there is nothing to backfill and
-- no reliable automatic mapping from the old 3-way split to the new 4-way one. The
-- check constraint below therefore allows all 7 values (old + new) so old rows stay
-- valid and new rows can only be written with one of the two sets. UI label mapping
-- for both old and new values lives in src/app/(portal)/deals/page.tsx and
-- src/app/(portal)/deals/[id]/page.tsx.

alter table brand_deals drop constraint if exists brand_deals_campaign_type_check;

alter table brand_deals
  add constraint brand_deals_campaign_type_check
    check (campaign_type in (
      -- baru (form registrasi deal, per revisi user)
      'paid_endorsement', 'bulking_ads_endorse', 'bulking_ads', 'cps',
      -- lama (baris existing, dibiarkan tanpa migrasi data)
      'paid', 'sample', 'extra_commission'
    ));

alter table brand_deals alter column campaign_type set default 'paid_endorsement';
