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
