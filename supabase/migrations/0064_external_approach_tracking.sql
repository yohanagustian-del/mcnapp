-- ============================================================
-- 0064_external_approach_tracking.sql
-- External Creator Workspace (M8 §2D.1) — perluas "Catat Approach" jadi
-- pipeline scouting lengkap: brand, niche, platform, followers, kontak WA,
-- GMV, channel, dan tahapan tanggal (scouting → reachout → respon →
-- follow up 1/2/3 → using TAP) + bukti link.
--
-- `approach_date` (sudah ada sejak 0006, default current_date) dipakai
-- sebagai tanggal "Scouting" — tidak perlu kolom baru untuk itu, hindari
-- duplikasi field (CLAUDE.md #4). `status` (approach/pakai_link/batal)
-- dibiarkan apa adanya untuk data lama; jalur baru memakai using_tap_date
-- terisi sebagai sinyal konversi (dipakai scorecard "Conversion").
-- ============================================================

alter table external_approaches
  add column if not exists brand text,
  add column if not exists niche text,
  add column if not exists platform text,
  add column if not exists followers integer,
  add column if not exists wa_contact text,
  add column if not exists gmv numeric,
  add column if not exists channel text,
  add column if not exists reachout_date date,
  add column if not exists respon_date date,
  add column if not exists follow_up_1_date date,
  add column if not exists follow_up_2_date date,
  add column if not exists follow_up_3_date date,
  add column if not exists using_tap_date date,
  add column if not exists prove_link text;

alter table external_approaches
  add constraint external_approaches_niche_check
    check (niche is null or niche in (
      'BHPC','FASHION MEN','KITCHENWARE','HOME SUPPLIES','FNB','MOM N BABY','AUTOMOTIVE',
      'FASHION & ACCECORIS','FASHION WOMEN','MUSLIM FASHION','LIFESTYLE','BAG & SHOES',
      'GADGET','ELECTRONIC','KIDS FASHION'
    )),
  add constraint external_approaches_platform_check
    check (platform is null or platform in ('tiktok', 'shopee')),
  add constraint external_approaches_channel_check
    check (channel is null or channel in ('live', 'video', 'vt_live', 'product_card')),
  add constraint external_approaches_wa_contact_check
    check (wa_contact is null or wa_contact ~ '^62[0-9]{6,15}$'),
  add constraint external_approaches_followers_check
    check (followers is null or followers >= 0),
  add constraint external_approaches_gmv_check
    check (gmv is null or gmv >= 0);

comment on column external_approaches.approach_date is
  'Tanggal Scouting (tahap 1 pipeline external). Default current_date.';
comment on column external_approaches.brand is 'Brand yang dibawa creator saat di-scout. Wajib diisi di form.';
