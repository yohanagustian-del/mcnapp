/**
 * MANUAL QA SMOKE — runs uploadLeakArtifact (Lane 2, Agency Leaked Generator
 * artifact upload) against the REAL remote Supabase. Guarded by RUN_LEAK_SMOKE=1
 * so CI/vitest runs skip it. getConfig is request-scoped (Next cookies()), so it
 * is mocked here to read app_config through the admin client instead.
 */
import { describe, it, vi } from "vitest";
import { readFileSync } from "fs";

const RUN = process.env.RUN_LEAK_SMOKE === "1";

vi.mock("@/lib/config", () => ({
  getConfig: async (key: string) => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const { data, error } = await admin.from("app_config").select("value").eq("key", key).maybeSingle();
    if (error || !data) throw new Error(`app_config key tidak ditemukan: ${key}`);
    return data.value;
  },
}));

describe.skipIf(!RUN)("smoke: uploadLeakArtifact vs remote", () => {
  it("ingests the Uma W4 artifact files end-to-end", { timeout: 300_000 }, async () => {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
    const { uploadLeakArtifact } = await import("@/lib/ingest/leak-run");
    const dir = process.env.SMOKE_DIR!;
    const leakFile = new File([readFileSync(`${dir}/uma-leak-w4.xlsx`)], "uma-leak-w4.xlsx");
    const bdFile = new File([readFileSync(`${dir}/uma-bd.xlsx`)], "uma-bd.xlsx");

    const t0 = Date.now();
    const result = await uploadLeakArtifact({
      leakFile,
      bdFile,
      actorId: "11111111-1111-1111-1111-111111111111", // director@mcn.test (QA seed)
    });
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    // eslint-disable-next-line no-console
    console.log("LEAK SMOKE RESULT", JSON.stringify({ seconds, ...result }, null, 1));
  });
});
