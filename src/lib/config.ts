import { createClient } from "@/lib/supabase/server";

/**
 * Centralized threshold/config reader (CLAUDE.md: NEVER hardcode thresholds).
 * Values live in app_config as jsonb: m2.delta_threshold, m4.bocor_sebagian,
 * m4.bocor_total, m7.live_active_min, m8.perf_drop, calendar.q3_cutoff, ...
 */
export async function getConfig<T = number>(key: string): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", key)
    .single();
  if (error || data === null) {
    throw new Error(`app_config missing key "${key}": ${error?.message ?? "not found"}`);
  }
  return data.value as T;
}
