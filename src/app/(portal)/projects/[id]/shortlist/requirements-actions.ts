"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { parseRupiah } from "@/lib/utils/rupiah";
import { requirePermission } from "@/lib/rbac";

const splitList = (raw: string): string[] =>
  raw.split(",").map((s) => s.trim()).filter(Boolean);

/** Kebutuhan kreator per project (PRD §6.4) — satu baris per project, upsert. */
export async function setProjectRequirements(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  if (!projectId) throw new Error("Project tidak valid");

  const niches = splitList(String(formData.get("niches") ?? ""));
  const platform = String(formData.get("platform") ?? "all");
  const minLevelRaw = String(formData.get("min_level") ?? "").trim();
  const minLevel = minLevelRaw ? Number(minLevelRaw) : null;
  const followerTiers = splitList(String(formData.get("follower_tiers") ?? ""));
  const minGmv30d = parseRupiah(String(formData.get("min_gmv_30d") ?? ""));
  const requireLiveRoster = formData.get("require_live_roster") === "on";
  const quotaRaw = String(formData.get("quota") ?? "").trim();
  const quota = quotaRaw ? Number(quotaRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const admin = createAdminClient();
  const { error } = await admin.from("project_creator_requirements").upsert(
    {
      project_id: projectId,
      niches: niches.length ? niches : null,
      platform,
      min_level: minLevel,
      follower_tiers: followerTiers.length ? followerTiers : null,
      min_gmv_30d: minGmv30d,
      require_live_roster: requireLiveRoster,
      quota,
      notes,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  if (error) throw new Error(`Gagal menyimpan kebutuhan kreator: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.requirements_set", entityType: "project_creator_requirements",
    entityId: String(projectId),
    after: { niches, platform, minLevel, followerTiers, minGmv30d, requireLiveRoster, quota },
    type: "auto",
  });
  revalidatePath(`/projects/${projectId}/shortlist`);
}

export interface ShortlistRow {
  creatorId: string;
  name: string;
  niche: string | null;
  level: number | null;
  gmv30d: number;
  liveShare: number;
  ownerCpmId: string | null;
  score: number;
}

/** project_shortlist(project_id) — deterministik, dihitung di SQL (§6.4). */
export async function fetchShortlist(projectId: number): Promise<ShortlistRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("project_shortlist", { p_project_id: projectId });
  if (error) throw new Error(`Gagal memuat shortlist: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    creatorId: String(r.creator_id), name: String(r.name), niche: (r.niche as string | null) ?? null,
    level: (r.level as number | null) ?? null, gmv30d: Number(r.gmv_30d ?? 0),
    liveShare: Number(r.live_share ?? 0), ownerCpmId: (r.owner_cpm_id as string | null) ?? null,
    score: Number(r.score ?? 0),
  }));
}

/** Undang dari shortlist (bulk) — PRD §3.4 langkah 2, R11. */
export async function inviteCreators(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.curate");
  const projectId = Number(formData.get("project_id"));
  const creatorIds = formData.getAll("creator_ids").map(String).filter(Boolean);
  if (!projectId) throw new Error("Project tidak valid");
  if (creatorIds.length === 0) throw new Error("Pilih minimal satu kreator");

  const admin = createAdminClient();
  for (const creatorId of creatorIds) {
    const { error } = await admin.from("project_join_requests").upsert(
      { project_id: projectId, creator_id: creatorId, status: "diundang", source: "invite" },
      { onConflict: "project_id,creator_id" }
    );
    if (error) throw new Error(`Gagal mengundang ${creatorId}: ${error.message}`);
  }

  await writeAudit({
    actorId: actor.id, action: "m7.invite", entityType: "project_join_requests",
    entityId: String(projectId), after: { creator_ids: creatorIds }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}/shortlist`);
  revalidatePath("/projects");
}
