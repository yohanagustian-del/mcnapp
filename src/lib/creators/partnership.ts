import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  resolvePartnershipLabels,
  type FeeAgreementStatus,
  type PartnershipPlatform,
  type PartnershipStatus,
  type PartnershipStatusLabels,
} from "./partnership-spec";

/** One row of creator_partnership_status (migration 0083). */
export interface CreatorPartnershipRow {
  creator_id: string;
  platform: PartnershipPlatform;
  partnership_status: PartnershipStatus | null;
  fee_agreement_status: FeeAgreementStatus | null;
  source_batch_id: number | null;
  updated_at: string;
}

const COLUMNS = "creator_id, platform, partnership_status, fee_agreement_status, source_batch_id, updated_at";

/** app_config `m8.partnership_status_labels`, with per-status fallback to the constants. */
export async function loadPartnershipLabels(): Promise<PartnershipStatusLabels> {
  return getConfig<unknown>("m8.partnership_status_labels")
    .then(resolvePartnershipLabels)
    .catch(() => resolvePartnershipLabels(null));
}

// The table only exists once migration 0083 is applied; until then pages must keep
// rendering ("Belum ada data") instead of crashing.
function isMissingTable(message: string): boolean {
  return /creator_partnership_status/.test(message) && /does not exist|schema cache|Could not find/i.test(message);
}

/**
 * Current partnership status per creator, read with the CALLER's client so RLS decides
 * scope (internal staff; a CPM sees only their own creators). `creatorIds` omitted =
 * every row the caller may see (paginated). Missing key = creator not in any file yet.
 */
export async function loadPartnershipStatus(
  supabase: SupabaseClient,
  creatorIds?: string[]
): Promise<Map<string, CreatorPartnershipRow>> {
  const out = new Map<string, CreatorPartnershipRow>();
  try {
    if (creatorIds === undefined) {
      const rows = await fetchAll<CreatorPartnershipRow>(supabase, "creator_partnership_status", COLUMNS, (q) =>
        q.order("creator_id")
      );
      for (const r of rows) out.set(r.creator_id, r);
      return out;
    }
    const ids = [...new Set(creatorIds.filter(Boolean))];
    // Chunked so a long id list never blows the PostgREST URL length.
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("creator_partnership_status")
        .select(COLUMNS)
        .in("creator_id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as CreatorPartnershipRow[]) out.set(r.creator_id, r);
    }
    return out;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingTable(message)) return out;
    throw new Error(`Gagal memuat status kemitraan: ${message}`);
  }
}

export interface PartnershipUploadSummary {
  createdAt: string;
  fileName: string | null;
  /** Usernames in the file that are not registered creators — skipped (A3). */
  unknownUsernames: string[];
  /** CPM uploads: creators owned by another CM — skipped (A2). */
  outOfScopeUsernames: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Latest status upload + the creators it skipped, so the "N kreator dilewati" notice
 * stays visible on /creators after the uploader's result panel is gone (user decision
 * A3, 2026-10-01). null = no upload yet, or migration 0083 not applied.
 */
export async function loadLastPartnershipUpload(supabase: SupabaseClient): Promise<PartnershipUploadSummary | null> {
  const { data, error } = await supabase
    .from("creator_partnership_uploads")
    .select("created_at, file_name, summary")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const summary = (data.summary ?? {}) as Record<string, unknown>;
  return {
    createdAt: data.created_at as string,
    fileName: (data.file_name as string | null) ?? null,
    unknownUsernames: strings(summary.unknown_usernames),
    outOfScopeUsernames: strings(summary.out_of_scope_usernames),
  };
}
