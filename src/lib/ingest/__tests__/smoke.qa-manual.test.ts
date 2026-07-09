/**
 * MANUAL QA SMOKE — runs the refactored aggregates-only runIngest against the
 * REAL remote Supabase and times it. Not part of the normal suite: guarded by
 * RUN_INGEST_SMOKE=1 so CI/vitest runs skip it. Delete-safe.
 *
 * getConfig is request-scoped (Next cookies()) — outside a request it throws,
 * so it's mocked here to read app_config through the admin client instead.
 */
import { describe, it, vi } from "vitest";
import { readFileSync } from "fs";

const RUN = process.env.RUN_INGEST_SMOKE === "1";

vi.mock("@/lib/config", () => ({
  getConfig: async (key: string) => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
    if (error || !data) throw new Error(`app_config key tidak ditemukan: ${key}`);
    return data.value;
  },
}));

describe.skipIf(!RUN)("smoke: runIngest aggregates-only vs remote", () => {
  it("processes vikahere W4 files fast and completely", { timeout: 600_000 }, async () => {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
    const { runIngest } = await import("@/lib/ingest/run");
    const scratch = process.env.SMOKE_DIR!;
    const mcnFile = new File([readFileSync(`${scratch}/vikahere-mcn-w4.csv`)], "vikahere-mcn-w4.csv", { type: "text/csv" });
    const tapFile = new File([readFileSync(`${scratch}/vikahere-tap-w4.csv`)], "vikahere-tap-w4.csv", { type: "text/csv" });

    const t0 = Date.now();
    const result = await runIngest({
      mcnFile,
      tapFile,
      actorId: "11111111-1111-1111-1111-111111111111", // director@mcn.test (QA seed)
    });
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log("SMOKE RESULT", JSON.stringify({
      seconds,
      batchId: result.batchId,
      period: `${result.periodStart}..${result.periodEnd}`,
      rowsMcn: result.rowsProcessedMcn,
      rowsTap: result.rowsProcessedTap,
      creators: result.creatorsCount,
      aggregateRows: result.aggregateRows,
      droppedRaw: result.droppedRaw,
      skippedCount: result.skipped.length,
      skippedSample: result.skipped.slice(0, 3),
    }));
  });
});
