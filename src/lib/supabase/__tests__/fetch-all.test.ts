import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllIn, IN_FILTER_CHUNK } from "../fetch-all";

/**
 * Mock PostgREST: rows filtered by .in()/.gte(), paginated by .range(), and —
 * like the real gateway — a request whose .in() list is too long fails with
 * "Bad Request" (the 2026-10-01 /creators outage at 2,173 creator ids).
 */
function mockClient(rows: { creator_id: string; period_start: string }[]) {
  const inSizes: number[] = [];
  const client = {
    from: () => ({
      select: () => {
        let list = rows;
        let inSize = 0;
        const q = {
          in: (col: "creator_id", values: string[]) => {
            inSize = values.length;
            inSizes.push(values.length);
            list = list.filter((r) => values.includes(r[col]));
            return q;
          },
          gte: (col: "period_start", v: string) => {
            list = list.filter((r) => r[col] >= v);
            return q;
          },
          range: (from: number, to: number) =>
            Promise.resolve(
              inSize > 1500
                ? { data: null, error: { message: "Bad Request" } }
                : { data: list.slice(from, to + 1), error: null }
            ),
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
  return { client, inSizes };
}

describe("fetchAllIn", () => {
  const ids = Array.from({ length: 2173 }, (_, i) => `CRT-${String(i).padStart(5, "0")}`);
  const rows = ids.flatMap((id) => [
    { creator_id: id, period_start: "2026-09-01" },
    { creator_id: id, period_start: "2026-08-01" },
  ]);

  it("splits a long id list into small .in() requests and returns every matching row", async () => {
    const { client, inSizes } = mockClient(rows);
    const out = await fetchAllIn<{ creator_id: string }>(
      client, "creator_period_summary", "creator_id", "creator_id", ids, (q) => q.gte("period_start", "2026-09-01")
    );
    expect(out).toHaveLength(2173);
    expect(new Set(out.map((r) => r.creator_id)).size).toBe(2173);
    expect(Math.max(...inSizes)).toBeLessThanOrEqual(IN_FILTER_CHUNK);
  });

  it("de-duplicates ids and makes no request for an empty list", async () => {
    const { client, inSizes } = mockClient(rows);
    expect(await fetchAllIn(client, "t", "creator_id", "creator_id", [])).toEqual([]);
    expect(inSizes).toEqual([]);
    const out = await fetchAllIn(client, "t", "creator_id", "creator_id", [ids[0], ids[0]]);
    expect(out).toHaveLength(2);
    expect(inSizes).toEqual([1]);
  });
});
