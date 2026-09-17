-- ============================================================
-- 0061_m7_v2_live_rollup_orders_items.sql
-- M7 v2 Special Project — live session roll-up also fills orders & items_sold.
--
-- Found in production QA (2026-09-17, project #11): a verified live session with
-- GMV Rp338.887 / 10 orders / 11 items produced a creator report reading
-- "0 · 0" for Orders · Items. `recompute_creator_daily_live` (0056) wrote only
-- gmv_live_report / live_gmv / live_orders / live_sessions, but
-- `project_creator_report_v` (0057) sums `pcm.orders` and `pcm.items_sold` —
-- columns the live path never touched, so every live-only project reported zero
-- orders and zero items no matter how much was actually sold.
--
-- Fills both with the SAME R21 fallback the gmv columns already use: the product
-- export always wins; the live export only contributes for a (creator, date)
-- that has no product row yet (gmv_product is null). Replaces the function body
-- only — no schema change, and re-running it is how existing rows get corrected.
-- ============================================================

create or replace function recompute_creator_daily_live(p bigint, c text, d date) returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  total_gmv numeric;
  total_orders int;
  total_items int;
  total_sessions int;
begin
  select coalesce(sum(gmv), 0), coalesce(sum(orders), 0), coalesce(sum(items), 0), count(*)
  into total_gmv, total_orders, total_items, total_sessions
  from project_live_sessions
  where project_id = p and creator_id = c and session_date = d
    and attribution_status in ('verified', 'confirmed_manual');

  insert into project_creator_metrics
    (project_id, creator_id, date, gmv_live_report, live_gmv, live_orders, live_sessions,
     orders, items_sold, updated_at)
  values (p, c, d, total_gmv, total_gmv, total_orders, total_sessions,
          total_orders, total_items, now())
  on conflict (project_id, creator_id, date) do update set
    gmv_live_report = excluded.gmv_live_report,
    -- No product-export live/video split yet (that's Fase 1B) — for a live-only
    -- project, live_gmv defaults to the live rollup itself (§6.7 fallback rule).
    live_gmv = case when project_creator_metrics.gmv_product is null then excluded.live_gmv else project_creator_metrics.live_gmv end,
    live_orders = excluded.live_orders,
    live_sessions = excluded.live_sessions,
    -- R21, same rule as gmv_actual's generated expression: product export wins,
    -- live only fills in when there is no product row for this (creator, date).
    orders = case when project_creator_metrics.gmv_product is null then excluded.orders else project_creator_metrics.orders end,
    items_sold = case when project_creator_metrics.gmv_product is null then excluded.items_sold else project_creator_metrics.items_sold end,
    updated_at = now();
end $$;

-- Backfill every (project, creator, date) that already has live sessions, so
-- reports generated from existing uploads stop reading 0 orders / 0 items.
do $$
declare
  r record;
begin
  for r in
    select distinct project_id, creator_id, session_date
    from project_live_sessions
    where attribution_status in ('verified', 'confirmed_manual')
  loop
    perform recompute_creator_daily_live(r.project_id, r.creator_id, r.session_date);
  end loop;
end $$;
