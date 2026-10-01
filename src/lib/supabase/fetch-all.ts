import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000; // PostgREST caps a single select at 1000 rows

/**
 * Paginates through an entire result set (weekly CSV batches can exceed the
 * 1000-row PostgREST page). Engine/aggregation code must use this instead of
 * a bare select, or it will silently compute on a truncated dataset.
 */
export async function fetchAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  filter: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => typeof q
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page++) {
    const query = filter(client.from(table).select(columns)).range(
      page * PAGE_SIZE,
      (page + 1) * PAGE_SIZE - 1
    );
    const { data, error } = await query;
    if (error) throw new Error(`fetchAll(${table}) failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Max values per `.in()` filter. PostgREST carries the list in the URL
 * (`?creator_id=in.(CRT-…,CRT-…)`); past ~1,500 creator ids (~16KB) the gateway
 * answers "Bad Request" — which took /creators down once the creators table
 * passed 2,000 rows (2026-10-01). 150 ids keeps each URL around 2KB.
 */
export const IN_FILTER_CHUNK = 150;

/**
 * fetchAll for "rows whose `column` is one of `values`", with the value list
 * split into IN_FILTER_CHUNK-sized requests (run concurrently) and the rows
 * concatenated. Use this whenever the list can grow with the data (all
 * creators, all shops…) instead of `fetchAll(…, q => q.in(column, values))`.
 * Rows come back grouped per chunk, so callers needing a global order must
 * sort the result themselves.
 */
export async function fetchAllIn<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  values: readonly string[],
  filter: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => typeof q = (q) => q
): Promise<T[]> {
  const unique = [...new Set(values)];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += IN_FILTER_CHUNK) chunks.push(unique.slice(i, i + IN_FILTER_CHUNK));
  const parts = await Promise.all(
    chunks.map((chunk) => fetchAll<T>(client, table, columns, (q) => filter(q.in(column, chunk))))
  );
  return parts.flat();
}
