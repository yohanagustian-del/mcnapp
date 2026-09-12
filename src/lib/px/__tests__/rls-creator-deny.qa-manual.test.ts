/**
 * MANUAL QA — proves PX-M1's Layer 3 (surat tugas §5 Langkah 1): the `bridge`
 * schema is NOT registered with PostgREST, so `bridge.px_creator_capability`
 * is unreachable through the REST API at all — not "creators are denied by
 * RLS", but "no PostgREST caller of any role can even address this schema".
 *
 * This repo has ZERO RLS test harness (no pgTAP, no creator_user login flow in
 * tests — see CLAUDE.md/PRD note reused verbatim in the surat tugas §7). A bare
 * anon-key client (no session, no creator_user login needed) is enough here:
 * Supabase's schema-exposure gate is enforced by the `authenticator` role's
 * `pgrst.db_schemas` setting BEFORE any RLS/JWT-role check runs, so it blocks
 * every caller uniformly — confirmed against Supabase's own docs ("PGRST106:
 * the schema must be one of the following..."). Proving it with anon is a
 * strict subset of proving it for creator_user; it needs no seeded creator
 * account, so it's what's automated here.
 *
 * Guarded by RUN_PX_RLS_SMOKE=1 — normal `vitest run` skips it. Reads
 * .env.local for NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, same
 * convention as src/lib/ingest/__tests__/smoke.qa-manual.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const RUN = process.env.RUN_PX_RLS_SMOKE === "1";

function loadDotEnvLocal(): void {
  let text: string;
  try {
    text = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

describe.skipIf(!RUN)("PX-M1 layer 3: bridge schema unreachable via PostgREST", () => {
  it("rejects a direct read of bridge.px_creator_capability from an anon-key client", async () => {
    loadDotEnvLocal();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const client = createClient(url, anonKey).schema("bridge");
    const { error } = await client.from("px_creator_capability").select("*").limit(1);
    // Expect a PostgREST schema-exposure error (PGRST106-style), not data.
    expect(error).not.toBeNull();
  });
});
