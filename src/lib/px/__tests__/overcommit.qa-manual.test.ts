/**
 * MANUAL QA (documentation-only, always skipped) — the over-commit CHECK
 * constraint (ck_pxcc_no_overcommit, migration 0051) genuinely CANNOT be
 * exercised through this app's own Supabase client, by design: `bridge` is
 * deliberately not registered with PostgREST (Layer 3), so even
 * createAdminClient() (service role) cannot reach bridge.px_creator_capability
 * directly to set slots_committed — there is no application code path that
 * writes that column at all (no px_match/M5 trigger exists yet, surat tugas §3a).
 *
 * This is the one check in the PX-M1 test matrix (§7) that requires a genuine
 * direct Postgres connection (Supabase SQL editor, `psql`, or an MCP-style
 * execute_sql tool) — this repo has no `pg`/raw-connection dependency and none
 * is being added just for one manual check. Run the steps below BY HAND against
 * the target project after applying migration 0051, then clean up the test row:
 *
 *   -- 1. Pick any existing 'aktif' creator id, e.g.:
 *   select id from creators where status = 'aktif' limit 1;
 *
 *   -- 2. Insert a throwaway capability row with slots_total=5:
 *   insert into bridge.px_creator_capability
 *     (creator_id, level2_category, price_segment, slots_total)
 *   values ('<creator id from step 1>', '__qa_overcommit_test__', 'low', 5);
 *
 *   -- 3. Simulate a committed match (service-role SQL only — no app path does this today):
 *   update bridge.px_creator_capability set slots_committed = 3
 *   where level2_category = '__qa_overcommit_test__';
 *
 *   -- 4. Attempt to lower slots_total below slots_committed — MUST fail:
 *   update bridge.px_creator_capability set slots_total = 2
 *   where level2_category = '__qa_overcommit_test__';
 *   -- Expected: ERROR — new row for relation "px_creator_capability" violates
 *   -- check constraint "ck_pxcc_no_overcommit"
 *
 *   -- 5. Clean up:
 *   delete from bridge.px_creator_capability where level2_category = '__qa_overcommit_test__';
 *
 * Verified this way once during the PX-M1 rollout (see HANDOFF.md) — recorded
 * here as a skipped test (not a passing no-op) so it stays visible in the
 * suite listing as "needs a human/direct-SQL run", instead of silently
 * vanishing from the test matrix.
 */
import { describe, it } from "vitest";

describe.skip("PX-M1: slots_committed <= slots_total CHECK rejects over-commit at the DB level", () => {
  it("requires a direct Postgres connection — see file header for the exact SQL steps", () => {
    // Intentionally empty: cannot run via createAdminClient() (bridge is not
    // PostgREST-exposed — Layer 3, migration 0051). Run by hand / via MCP.
  });
});
