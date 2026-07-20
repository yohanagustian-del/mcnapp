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
 * routeCampaignRequest (PRD M8 §2E.1 steps 1-2): satu form 3 kolom, satu submit
 * yang mem-fan-out ke campaign_requests. BizDev tidak lagi mengetik creator ID
 * manual (dulu tidak hafal) — sekarang mencentang.
 *
 *   Kolom 1 — kreator dicentang → route_type='creator', 1 baris per kreator ke
 *             CM pemilik (creators.owner_cpm_id). Inti routing §2E — never CM lain.
 *   Kolom 2 — kategori level-2 dicentang → route_type='category', 1 baris per
 *             (kategori × CM yang punya kreator gmv>0 di kategori itu). creator_id
 *             kosong; CM pilih kreatornya saat konfirmasi.
 *   Kolom 3 — teks request bebas → route_type='broadcast' ke SEMUA CM aktif bila
 *             kolom 1 & 2 kosong. Bila ada kolom lain, teks hanya nempel sebagai
 *             request_text di tiap baris (deskripsi kebutuhan BizDev).
 *
 * Deal wajib hanya bila ada kreator dicentang (kolom 1). Kolom 2 & 3 boleh tanpa
 * deal (broadcast kebutuhan/kategori). Kreator tanpa owner_cpm_id dilewati.
 */
export async function routeCampaignRequest(
  _prev: RouteActionState | null,
  formData: FormData
): Promise<RouteActionState> {
  const actor = await requirePermission("m8.route_campaign");

  const dealId = String(formData.get("deal_id") ?? "").trim() || null;
  const needsBrandAcc = formData.get("needs_brand_acc") === "on";
  // QA: BizDev mencarikan creator langsung tanpa CM → cm_confirm dilewati (auto 'mau').
  const creatorDirect = formData.get("creator_direct") === "on";
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const requestText = String(formData.get("request_text") ?? "").trim() || null;
  const creatorIds = formData.getAll("creator_ids").flatMap((v) =>
    String(v).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  );
  const categories = formData.getAll("categories")
    .map((v) => String(v).trim())
    .filter(Boolean);

  const uniqCreatorIds = [...new Set(creatorIds)];
  const uniqCategories = [...new Set(categories)];

  if (uniqCreatorIds.length === 0 && uniqCategories.length === 0 && !requestText) {
    return { ok: false, message: "Isi minimal satu: kreator, kategori, atau teks request." };
  }
  // Kolom 1 route ke campaign nyata → deal wajib. Kolom 2 & 3 boleh tanpa deal.
  if (uniqCreatorIds.length > 0 && !dealId) {
    return { ok: false, message: "Deal wajib dipilih bila ada kreator dicentang (kolom 1)." };
  }

  const admin = createAdminClient();

  let dealName: string | null = null;
  if (dealId) {
    const { data: deal } = await admin
      .from("brand_deals").select("id, brand_name").eq("id", dealId).maybeSingle();
    if (!deal) return { ok: false, message: `Deal ${dealId} tidak ditemukan` };
    dealName = deal.brand_name;
  }

  const routed: string[] = [];
  const skipped: string[] = [];

  // ===== Kolom 1: kreator dicentang → CM pemilik =====
  if (uniqCreatorIds.length > 0) {
    const { data: creators } = await admin
      .from("creators").select("id, name, owner_cpm_id").in("id", uniqCreatorIds);
    const byId = new Map((creators ?? []).map((c) => [c.id, c]));
    for (const creatorId of uniqCreatorIds) {
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
          route_type: "creator",
          request_text: requestText,
          notes,
          ...state,
        })
        .select("id")
        .single();
      if (error) return { ok: false, message: `Gagal routing ${creatorId}: ${error.message}` };
      await writeAudit({
        actorId: actor.id, action: creatorDirect ? "m8.bizdev_direct_creator" : "m8.route_campaign",
        entityType: "campaign_requests", entityId: String(req.id),
        after: { route_type: "creator", deal_id: dealId, creator_id: creatorId, owner_cpm_id: creator.owner_cpm_id, needs_brand_acc: needsBrandAcc, creator_sourced_by: creatorDirect ? "bizdev" : "cm" },
        type: "auto",
      });
      routed.push(creatorId);
    }
  }

  // ===== Kolom 2: kategori dicentang → semua CM dengan kreator gmv>0 di kategori =====
  for (const category of uniqCategories) {
    // Kreator dengan penjualan (gmv>0) di kategori ini (4.A: ambang >0).
    const { data: sales } = await admin
      .from("creator_subcat_segment_gmv")
      .select("creator_id, gmv")
      .eq("level2_category", category)
      .gt("gmv", 0);
    const salesCreatorIds = [...new Set((sales ?? []).map((s) => s.creator_id))];
    if (salesCreatorIds.length === 0) {
      skipped.push(`kategori "${category}" (belum ada kreator dengan penjualan)`);
      continue;
    }
    const { data: owners } = await admin
      .from("creators").select("owner_cpm_id").in("id", salesCreatorIds);
    const cmIds = [...new Set((owners ?? []).map((o) => o.owner_cpm_id).filter((v): v is string => Boolean(v)))];
    if (cmIds.length === 0) {
      skipped.push(`kategori "${category}" (kreator belum punya CPM owner)`);
      continue;
    }
    for (const cmId of cmIds) {
      const state = initialRequestState(needsBrandAcc);
      const { data: req, error } = await admin
        .from("campaign_requests")
        .insert({
          deal_id: dealId,
          creator_id: null, // CM pilih kreatornya saat konfirmasi
          owner_cpm_id: cmId,
          requested_by: actor.id,
          creator_sourced_by: "cm",
          route_type: "category",
          level2_category: category,
          request_text: requestText,
          notes,
          ...state,
        })
        .select("id")
        .single();
      if (error) return { ok: false, message: `Gagal routing kategori ${category}: ${error.message}` };
      await writeAudit({
        actorId: actor.id, action: "m8.route_campaign_category",
        entityType: "campaign_requests", entityId: String(req.id),
        after: { route_type: "category", deal_id: dealId, level2_category: category, owner_cpm_id: cmId, needs_brand_acc: needsBrandAcc },
        type: "auto",
      });
    }
    routed.push(`kategori "${category}" (${cmIds.length} CM)`);
  }

  // ===== Kolom 3: teks saja (tanpa kolom 1 & 2) → broadcast ke semua CM aktif =====
  if (requestText && uniqCreatorIds.length === 0 && uniqCategories.length === 0) {
    const { data: cms } = await admin
      .from("team_members").select("id").in("role", ["cpm", "cm_lead"]).eq("active", true);
    const cmIds = (cms ?? []).map((m) => m.id);
    if (cmIds.length === 0) {
      return { ok: false, message: "Tidak ada CM aktif untuk menerima broadcast." };
    }
    for (const cmId of cmIds) {
      const state = initialRequestState(needsBrandAcc);
      const { data: req, error } = await admin
        .from("campaign_requests")
        .insert({
          deal_id: dealId,
          creator_id: null,
          owner_cpm_id: cmId,
          requested_by: actor.id,
          creator_sourced_by: "cm",
          route_type: "broadcast",
          request_text: requestText,
          notes,
          ...state,
        })
        .select("id")
        .single();
      if (error) return { ok: false, message: `Gagal broadcast: ${error.message}` };
      await writeAudit({
        actorId: actor.id, action: "m8.route_campaign_broadcast",
        entityType: "campaign_requests", entityId: String(req.id),
        after: { route_type: "broadcast", deal_id: dealId, owner_cpm_id: cmId, needs_brand_acc: needsBrandAcc },
        type: "auto",
      });
    }
    routed.push(`broadcast teks (${cmIds.length} CM)`);
  }

  revalidateWorkspaces();
  if (routed.length === 0) {
    return { ok: false, message: skipped.length ? `Tidak ada yang di-route. Dilewati: ${skipped.join(", ")}.` : "Tidak ada yang di-route." };
  }
  const brandLabel = dealName ? ` (${dealName})` : "";
  const parts = [`Ter-route: ${routed.join(", ")}${brandLabel}.`];
  if (skipped.length) parts.push(`Dilewati: ${skipped.join(", ")}.`);
  return { ok: true, message: parts.join(" ") };
}

async function loadRequest(reqId: number) {
  const admin = createAdminClient();
  const { data: req } = await admin
    .from("campaign_requests")
    .select("id, deal_id, creator_id, owner_cpm_id, route_type, level2_category, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handed_over_at")
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

/**
 * CM konfirmasi req kategori/broadcast (route_type category|broadcast) yang
 * creator_id-nya masih kosong. "mau" → CM memilih salah satu kreatornya dulu
 * (creator_id di-set) lalu masuk alur konfirmasi normal; "tidak" → batal tanpa
 * perlu pilih kreator. Scope creator ke CM yang bersangkutan (§2F).
 */
export async function cmClaimBroadcastRequest(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.cm_confirm");
  const reqId = Number(formData.get("req_id"));
  const decision = String(formData.get("decision"));
  const creatorId = String(formData.get("creator_id") ?? "").trim() || null;
  if (!reqId || (decision !== "mau" && decision !== "tidak")) {
    throw new Error("Keputusan konfirmasi tidak valid");
  }

  const { admin, req } = await loadRequest(reqId);
  assertCmScope(actor, req.owner_cpm_id);
  if (req.route_type === "creator") {
    throw new Error("Req ini sudah terikat kreator — pakai konfirmasi biasa");
  }
  if (req.creator_id) {
    throw new Error("Req ini sudah dipilih kreatornya");
  }

  if (decision === "mau") {
    if (!creatorId) throw new Error("Pilih kreator dulu sebelum konfirmasi 'mau'");
    // Kreator harus milik CM ini (kecuali CM Lead/management lintas tim §2F).
    const { data: creator } = await admin
      .from("creators").select("id, owner_cpm_id").eq("id", creatorId).maybeSingle();
    if (!creator) throw new Error(`Creator ${creatorId} tidak ditemukan`);
    if (actor.role === "cpm" && creator.owner_cpm_id !== actor.id) {
      throw new Error("Kreator yang dipilih bukan milik Anda");
    }
    const { error: setErr } = await admin
      .from("campaign_requests")
      .update({ creator_id: creatorId, updated_at: new Date().toISOString() })
      .eq("id", reqId);
    if (setErr) throw new Error(`Gagal set kreator: ${setErr.message}`);
    req.creator_id = creatorId;
  }

  const before = reqState(req);
  const after = applyCmConfirm(before, decision);
  await persistTransition(admin, reqId, before, after, actor.id, "m8.cm_confirm_broadcast");
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
