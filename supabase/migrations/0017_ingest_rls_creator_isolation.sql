-- Restrictive creator_user isolation for Module 0.5 aggregate tables, mirroring
-- 0011 §8 (pmr_creator_selfonly): internal roles unaffected (is_creator_user()=false),
-- creator portal principals see only their own rows. upload_batches has no creator
-- dimension → hard deny for creator_user (matches transactions_* deny pattern).

create policy cps_creator_selfonly on creator_period_summary as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());

create policy cssg_creator_selfonly on creator_subcat_segment_gmv as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());

create policy ctp_creator_selfonly on creator_top_products as restrictive for select
  using (not is_creator_user() or creator_id = auth_creator_id());

create policy ub_deny_creator on upload_batches as restrictive for select
  using (not is_creator_user());
