/**
 * MANUAL QA (documentation-only, always skipped) — verifies the coverage-push
 * exporter (coverage-push.ts, PX-M3-A) against a REAL CDPS staging deployment
 * end-to-end. This cannot be exercised in the normal test suite: it requires a
 * live CDPS `/api/v1/internal/bridge/px-coverage` endpoint reachable over the
 * network plus the SHARED `BRIDGE_PX_SECRET` value (agreed with the CDPS side
 * out-of-band, never committed — same precedent as BRIDGE_INGEST_SECRET on
 * that side, D-12), neither of which exists in this sandbox/CI.
 *
 * Run the steps below BY HAND once per staging environment change:
 *
 *   1. Get a CDPS staging base URL + BRIDGE_PX_SECRET from the CDPS side
 *      (out-of-band — never committed to either repo).
 *   2. Set env locally (NOT in .env.example, NOT committed):
 *        CDPS_BRIDGE_URL=https://<cdps-staging-host>
 *        BRIDGE_PX_SECRET=<shared secret>
 *   3. Either (a) push the real, current coverage snapshot:
 *        node -e "
 *          const { createAdminClient } = require('./src/lib/supabase/admin');
 *          const { pushCoverageSnapshot } = require('./src/lib/px/coverage-push');
 *          pushCoverageSnapshot(createAdminClient()).then(r => console.log(JSON.stringify(r)));
 *        "
 *      (adjust for this repo's TS/ESM loader — a ts-node/tsx one-liner works
 *      too), or (b) POST the shared fixture directly to isolate the exporter
 *      from this repo's own coverage state:
 *        BODY=$(cat docs/fixtures/px_coverage_v1.json)
 *        HASH=$(echo -n "$BODY" | sha256sum | cut -c1-12)
 *        curl -i -X POST "$CDPS_BRIDGE_URL/api/v1/internal/bridge/px-coverage" \
 *          -H "Authorization: Bearer $BRIDGE_PX_SECRET" \
 *          -H "Idempotency-Key: px-coverage-$(date +%Y%m%d)-$HASH" \
 *          -H "Content-Type: application/json" \
 *          -d "$BODY"
 *   4. Expected: HTTP 200, body `{"batch_key": "...", "rows_received": N, "duplicate": false}`.
 *   5. Repeat the SAME request (same Idempotency-Key) — expected: HTTP 200,
 *      SAME batch_key, `"duplicate": true`, rows_received reflects the ORIGINAL
 *      accepted count (not re-parsed), per contract §Non-negotiables #6.
 *   6. Negative check (K-2, contract §Non-negotiables #3): POST a payload with
 *      an added `creator_id` field on one row — expected: HTTP 422,
 *      `[payload coverage tidak sesuai kontrak: kolom 'creator_id' tidak dikenal]`.
 *   7. On the CDPS side, confirm `px_coverage_snapshot` gained the expected rows
 *      and `px_coverage_push` recorded the raw payload (CDPS-side check, not
 *      this repo's to run directly — ask the CDPS session, or query if you
 *      have access to that Supabase project).
 *
 * Recorded here as a skipped test (not a passing no-op) so it stays visible in
 * the suite listing as "needs a human/real-network run" — same convention as
 * overcommit.qa-manual.test.ts.
 */
import { describe, it } from "vitest";

describe.skip("PX-M3-A: coverage-push against a real CDPS staging endpoint", () => {
  it("requires CDPS_BRIDGE_URL + BRIDGE_PX_SECRET and network access — see file header for the exact steps", () => {
    // Intentionally empty: no live CDPS endpoint/secret exists in this sandbox.
  });
});
