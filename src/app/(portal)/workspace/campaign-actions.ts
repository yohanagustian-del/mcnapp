"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import {
  applyBrandAcc,
  applyCmConfirm,
  canHandover,
  initialRequestState,
  type CampaignReqState,
} from "@/lib/m8/routing";

export interface RouteActionState {
  ok: boolean;
  message: string;
}

const WORKSPACE_PATHS = ["/workspace/cm", "/workspace/bizdev"];

function revalidateWorkspaces() {
  for (const p of WORKSPACE_PATHS) revalidatePath(p);
}

/** CPM only acts on requests routed to them; CM Lead/management cover the team (§2F). */
function assertCmScope(actor: TeamMember, ownerCpmId: string | null) {
  if (actor.role === "cpm" && ownerCpmId !== actor.id) {
    throw new Error("Akses ditolak: req ini di-route ke CPM lain");
  }
}

/**
 * routeCampaignRequest (PRD M8 §2E.1 steps 1-2): BizDev picks a deal + creators;
 * the system routes each request to the owning CM automatically via
 * creators.owner_cpm_id — never to another CM. Creators without an owner cannot
 * be routed (there is no CM workspace to receive them).
 */
export async function routeCampaignRequest(
  _prev: RouteActionState | null,
  formData: FormData
): Promise<RouteActionState> {
  const actor = await requirePermission("m8.route_campaign");

  const dealId = String(formData.get("deal_id") ?? "").trim();
  const needsBrandAcc = formData.get("needs_brand_acc") === "on";
  // QA: BizDev mencarikan creator langsung tanpa CM → cm_confirm dilewati (auto 'mau').
  const creatorDirect = formData.get("creator_direct") === "on";
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const creatorIds = String(formData.get("creator_ids") ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!dealId) return { ok: false, message: "Deal wajib dipilih" };
  if (creatorIds.length === 0) return { ok: false, message: "Minimal satu creator ID (CRT-...)" };

  const admin = createAdminClient();
  const { data: deal } = await admin
    .from("brand_deals").select("id, brand_name").eq("id", dealId).maybeSingle();
  if (!deal) return { ok: false, message: `Deal ${dealId} tidak ditemukan` };

  const { data: creators } = await admin
    .from("creators").select("id, name, owner_cpm_id").in("id", creatorIds);
  const byId = new Map((creators ?? []).map((c) => [c.id, c]));

  const routed: string[] = [];
  const skipped: string[] = [];
  for (const creatorId of creatorIds) {
    const creator = byId.get(creatorId);
    if (!creator) { skipped.push(`${creatorId} (tidak ditemukan)`); continue; }
    if (!creator.owner_cpm_id && !creatorDirect) {
      skipped.push(`${creatorId} (belum punya CPM owner)`);
      continue;
    }

    const state = initialRequestState(needsBrandAcc);
    if (creatorDirect) state.cm_confirm_status = "mau"; // BizDev sudah amankan creator sendiri
    const { data: req, error } = await admin
      .from("campaign_requests")
      .insert({
        deal_id: dealId,
        creator_id: creatorId,
        owner_cpm_id: creator.owner_cpm_id, // auto dari creator — inti routing §2E (null bila direct tanpa CM)
        requested_by: actor.id,
        creator_sourced_by: creatorDirect ? "bizdev" : "cm",
        notes,
        ...state,
      })
      .select("id")
      .single();
    if (error) return { ok: false, message: `Gagal routing ${creatorId}: ${error.message}` };

    await writeAudit({
      actorId: actor.id, action: creatorDirect ? "m8.bizdev_direct_creator" : "m8.route_campaign",
      entityType: "campaign_requests",
      entityId: String(req.id),
      after: { deal_id: dealId, creator_id: creatorId, owner_cpm_id: creator.owner_cpm_id, needs_brand_acc: needsBrandAcc, creator_sourced_by: creatorDirect ? "bizdev" : "cm" },
      type: "auto",
    });
    routed.push(creatorId);
  }

  revalidateWorkspaces();
  const parts = [`${routed.length} req di-route ke CM pemilik (${deal.brand_name}).`];
  if (skipped.length) parts.push(`Dilewati: ${skipped.join(", ")}.`);
  return { ok: routed.length > 0, message: parts.join(" ") };
}

async function loadRequest(reqId: number) {
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("campaign_requests")
    .select("id, deal_id, creator_id, owner_cpm_id, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handed_over_at")
    .eq("id", reqId)
    .maybeSingle();
  if (!req) throw new Error(`Req campaign #${reqId} tidak ditemukan`);
  return { admin, req };
}

function reqState(req: {
  cm_confirm_status: string; needs_brand_acc: boolean | null;
  brand_acc_status: string; final_status: string;
}): CampaignReqState {
  return {
    cm_confirm_status: req.cm_confirm_status as CampaignReqState["cm_confirm_status"],
    needs_brand_acc: Boolean(req.needs_brand_acc),
    brand_acc_status: req.brand_acc_status as CampaignReqState["brand_acc_status"],
    final_status: req.final_status as CampaignReqState["final_status"],
  };
}

async function persistTransition(
  admin: ReturnType<typeof createAdminClient>,
  reqId: number,
  before: CampaignReqState,
  after: CampaignReqState,
  actorId: string,
  action: string
) {
  const { error } = await admin
    .from("campaign_requests")
    .update({ ...after, updated_at: new Date().toISOString() })
    .eq("id", reqId);
  if (error) throw new Error(`Gagal update req: ${error.message}`);
  // Semua transisi ter-log (§2E.2).
  await writeAudit({
    actorId, action, entityType: "campaign_requests", entityId: String(reqId),
    before, after, type: "auto",
  });
  revalidateWorkspaces();
}

/** CM konfirmasi creator mau/tidak join (§2E.1 step 3). */
export async function cmConfirmCampaign(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.cm_confirm");
  const reqId = Number(formData.get("req_id"));
  const decision = String(formData.get("decision"));
  if (!reqId || (decision !== "mau" && decision !== "tidak")) {
    throw new Error("Keputusan konfirmasi tidak valid");
  }

  const { admin, req } = await loadRequest(reqId);
  assertCmScope(actor, req.owner_cpm_id);
  const before = reqState(req);
  const after = applyCmConfirm(before, decision);
  await persistTransition(admin, reqId, before, after, actor.id, "m8.cm_confirm");
}

/** BizDev catat hasil acc brand (§2E.1 step 4 — hanya campaign ber-needs_brand_acc). */
export async function brandAccCampaign(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.brand_acc");
  const reqId = Number(formData.get("req_id"));
  const decision = String(formData.get("decision"));
  if (!reqId || (decision !== "approved" && decision !== "ditolak")) {
    throw new Error("Keputusan acc brand tidak valid");
  }

  const { admin, req } = await loadRequest(reqId);
  const before = reqState(req);
  const after = applyBrandAcc(before, decision);
  await persistTransition(admin, reqId, before, after, actor.id, "m8.brand_acc");
}

/** Fix → handover ke Campaign Ops (§2E.1 step 5; Module 1 §0.5). */
export async function handoverCampaign(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.handover");
  const reqId = Number(formData.get("req_id"));
  if (!reqId) throw new Error("req_id tidak valid");

  const { admin, req } = await loadRequest(reqId);
  if (!canHandover(reqState(req))) throw new Error("Handover hanya untuk req berstatus fix");
  if (req.handed_over_at) throw new Error("Req sudah di-handover");

  const handedOverAt = new Date().toISOString();
  const { error } = await admin
    .from("campaign_requests")
    .update({ handed_over_at: handedOverAt, updated_at: handedOverAt })
    .eq("id", reqId);
  if (error) throw new Error(`Gagal handover: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.handover", entityType: "campaign_requests",
    entityId: String(reqId), after: { handed_over_at: handedOverAt, deal_id: req.deal_id, creator_id: req.creator_id },
    type: "auto",
  });
  revalidateWorkspaces();
}
