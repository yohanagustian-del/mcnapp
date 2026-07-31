import { createAdminClient } from "@/lib/supabase/admin";
import { CM_ROLES, MANAGEMENT_ROLES } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";

/** Roles that may own a creator (creators.owner_cpm_id) — same set as the import flow. */
export const CM_OWNER_ROLES = [...CM_ROLES, ...MANAGEMENT_ROLES];

/** Assignment target must be an active CPM / CM Lead (mirrors assignCreator). */
export const CM_ASSIGNABLE_ROLES = ["cpm", "cm_lead"] as const;

export interface CreatorWithoutCm {
  id: string;
  name: string;
  username: string | null;
  platform: string | null;
  status: string;
  created_at: string | null;
}

export interface CmOption {
  id: string;
  name: string;
  role: string;
}

export interface CreatorsWithoutCmData {
  /** Total creators with no CM — the headline number on the alert card. */
  total: number;
  /** Newest first (auto-created from the weekly upload land at the top). */
  rows: CreatorWithoutCm[];
  /** Active CPM / CM Lead the creators can be assigned to. */
  cmOptions: CmOption[];
}

/**
 * Creators with no CM (`owner_cpm_id is null`), for the "Kreator belum punya CM"
 * alert card.
 *
 * Weekly platform uploads create any unknown username as a new creator WITHOUT a
 * CM on purpose (the uploader is not necessarily the creator's manager — see
 * resolveCreators in platform-csv.ts). A creator with no CM is invisible to the
 * CM workspace scope and to OKR aggregation, so it must be assigned by hand;
 * this card is what makes that backlog visible instead of silent.
 *
 * Read-only aggregation of existing data — no LLM, no recomputation (CLAUDE.md #1/#4).
 */
export async function loadCreatorsWithoutCm(): Promise<CreatorsWithoutCmData> {
  const admin = createAdminClient();

  const [{ count }, rows, members] = await Promise.all([
    admin
      .from("creators")
      .select("id", { count: "exact", head: true })
      .is("owner_cpm_id", null),
    fetchAll<CreatorWithoutCm>(
      admin,
      "creators",
      "id, name, username, platform, status, created_at",
      (q) => q.is("owner_cpm_id", null).order("created_at", { ascending: false })
    ),
    admin
      .from("team_members")
      .select("id, name, role")
      .in("role", CM_ASSIGNABLE_ROLES)
      .eq("active", true)
      .order("name"),
  ]);

  const cmOptions: CmOption[] = (members.data ?? [])
    .filter((m): m is { id: string; name: string; role: string } => Boolean(m.name))
    .map((m) => ({ id: m.id, name: m.name, role: m.role }));

  return { total: count ?? rows.length, rows, cmOptions };
}
