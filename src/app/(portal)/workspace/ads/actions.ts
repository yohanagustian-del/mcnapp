"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { parseRupiah } from "@/lib/utils/rupiah";
import { initialBriefStatus } from "@/lib/m10/ads";

/**
 * M10 server actions. All mutations are RBAC-gated (od_viewer holds none of these permissions,
 * so it is rejected here — defense-in-depth beyond RLS) and audited.
 */

/** §2.2 — CM/BizDev create a brief. Over-cap budget → menunggu_approval (Director gate). */
export async function createBrief(formData: FormData): Promise<void> {
  const actor = await requirePermission("m10.brief_create");
  const admin = createAdminClient();

  const source = String(formData.get("source") ?? "");
  const creatorId = (formData.get("creator_id") as string) || null;
  const dealId = (formData.get("deal_id") as string) || null;
  const projectId = formData.get("project_id") ? Number(formData.get("project_id")) : null;
  const objective = String(formData.get("objective") ?? "").trim() || null;
  const budgetRequested = parseRupiah(formData.get("budget_requested") as string);
  if (!["cm", "bizdev"].includes(source)) throw new Error("Sumber brief tidak valid");

  // Cap check at intake (single-source cap: creator ads_budget_cap or deal ads_budget).
  let cap: number | null = null;
  if (creatorId) {
    const { data } = await admin.from("creators").select("ads_budget_cap").eq("id", creatorId).maybeSingle();
    cap = data?.ads_budget_cap ?? null;
  } else if (dealId) {
    const { data } = await admin.from("brand_deals").select("ads_budget").eq("id", dealId).maybeSingle();
    cap = data?.ads_budget ?? null;
  }
  const status = initialBriefStatus(budgetRequested, cap);

  const { data: row, error } = await admin.from("ads_briefs").insert({
    source, creator_id: creatorId, deal_id: dealId, project_id: projectId, objective,
    budget_requested: budgetRequested, status, created_by: actor.id,
  }).select("id").single();
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id, action: "m10.brief_create", entityType: "ads_briefs", entityId: String(row.id),
    after: { source, budget_requested: budgetRequested, status }, type: status === "menunggu_approval" ? "approval" : "auto",
  });
  revalidatePath("/workspace/ads");
}

/** §3.2 — Director approves/rejects an over-cap brief. */
export async function decideBriefApproval(formData: FormData): Promise<void> {
  const actor = await requirePermission("m10.budget_approve");
  const admin = createAdminClient();
  const briefId = Number(formData.get("brief_id"));
  const approve = String(formData.get("decision")) === "approve";

  const { data: brief } = await admin.from("ads_briefs").select("status, budget_requested").eq("id", briefId).maybeSingle();
  if (!brief || brief.status !== "menunggu_approval") throw new Error("Brief tidak sedang menunggu approval");

  const patch = approve
    ? { status: "dikerjakan" as const, budget_approved: brief.budget_requested }
    : { status: "batal" as const };
  const { error } = await admin.from("ads_briefs").update(patch).eq("id", briefId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id, action: "m10.budget_approve", entityType: "ads_briefs", entityId: String(briefId),
    after: { decision: approve ? "approved" : "rejected", by: `director:${actor.id}` }, type: "approval",
  });
  revalidatePath("/workspace/ads");
}

/** §2.5 — assign/claim a brief (Head/SPV assign; ads_support claims). */
export async function claimBrief(formData: FormData): Promise<void> {
  const actor = await requirePermission("m10.brief_execute");
  const admin = createAdminClient();
  const briefId = Number(formData.get("brief_id"));
  const { error } = await admin.from("ads_briefs")
    .update({ assigned_to: actor.id, status: "dikerjakan" })
    .eq("id", briefId).in("status", ["baru", "dikerjakan"]);
  if (error) throw new Error(error.message);
  await writeAudit({
    actorId: actor.id, action: "m10.brief_claim", entityType: "ads_briefs", entityId: String(briefId), type: "auto",
  });
  revalidatePath("/workspace/ads");
}

/** §2.3 — input the 6 manual result columns. ads_spent is the single source (feeds M7/M8). */
export async function inputResult(formData: FormData): Promise<void> {
  const actor = await requirePermission("m10.result_input");
  const admin = createAdminClient();

  const briefId = Number(formData.get("brief_id"));
  const period = String(formData.get("period") ?? "");
  const adsSpent = parseRupiah(formData.get("ads_spent") as string);
  const gmv = parseRupiah(formData.get("gmv") as string);
  const num = (k: string) => (formData.get(k) ? Number(formData.get(k)) : null);
  if (adsSpent == null || gmv == null || !period) throw new Error("ads_spent, gmv, dan periode wajib diisi");

  // Upsert by (brief_id, period); the trigger sets flagged from roas vs gmv/ads_spent.
  const { data: row, error } = await admin.from("ads_campaign_results").upsert({
    brief_id: briefId, period, ads_spent: adsSpent, gmv,
    cpm: num("cpm"), ctr: num("ctr"), cvr: num("cvr"), roas: num("roas"),
    status: String(formData.get("status") ?? "draft"), created_by: actor.id,
  }, { onConflict: "brief_id,period" }).select("id, flagged").single();
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id, action: "m10.result_input", entityType: "ads_campaign_results", entityId: String(row.id),
    after: { period, ads_spent: adsSpent, gmv, flagged: row.flagged }, type: "auto",
  });
  revalidatePath("/workspace/ads");
}
