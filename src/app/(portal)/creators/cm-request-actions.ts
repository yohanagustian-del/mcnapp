"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";

/**
 * Hasil aksi request CM. Dikembalikan (bukan di-throw) supaya UI bisa menampilkan
 * notifikasi berhasil/gagal di tempat tanpa memicu error boundary halaman —
 * pola yang sama dengan assignCreator di workspace/cm/actions.ts.
 */
export type CmRequestState = { ok: boolean; message: string } | null;

/**
 * CM mengajukan request untuk memegang seorang kreator.
 *
 * CPM tidak punya izin m8.assign_creator (tidak bisa assign mandiri), jadi ini
 * jalur resminya. Membuat request TIDAK mengubah kepemilikan apa pun — hanya
 * mengantre — sehingga aman dilakukan CM mana pun (CLAUDE.md #2: aksi yang tidak
 * merugikan boleh berlaku langsung, tetap tercatat di audit_logs).
 */
export async function requestCmAssignment(
  _prev: CmRequestState,
  formData: FormData
): Promise<CmRequestState> {
  try {
    const actor = await requirePermission("creators.request_cm");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const reason = String(formData.get("reason") ?? "").trim() || null;
    if (!creatorId) throw new Error("Kreator wajib dipilih");

    const admin = createAdminClient();
    const { data: creator } = await admin
      .from("creators")
      .select("id, name, username, owner_cpm_id")
      .eq("id", creatorId)
      .maybeSingle();
    if (!creator) throw new Error(`Kreator ${creatorId} tidak ditemukan`);
    if (creator.owner_cpm_id === actor.id) {
      return { ok: true, message: "Kreator ini sudah Anda pegang — tidak perlu request." };
    }

    // Satu request pending per (kreator, pengaju) — dijaga unique index parsial di
    // DB; dicek dulu di sini supaya pesannya jelas, bukan error constraint mentah.
    const { data: existing } = await admin
      .from("creator_cm_requests")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("requested_by", actor.id)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      return { ok: true, message: "Request untuk kreator ini sudah diajukan dan masih menunggu keputusan." };
    }

    const id = genId("REQ");
    const { error } = await admin.from("creator_cm_requests").insert({
      id,
      creator_id: creatorId,
      requested_by: actor.id,
      current_owner_id: creator.owner_cpm_id,
      reason,
      status: "pending",
    });
    if (error) throw new Error(`Gagal mengirim request: ${error.message}`);

    await writeAudit({
      actorId: actor.id,
      action: "creators.request_cm",
      entityType: "creator_cm_requests",
      entityId: id,
      after: { creator_id: creatorId, requested_by: actor.id, reason },
      type: "auto", // pengajuannya sendiri tidak mengubah kepemilikan; keputusannya yang 'approval'
    });

    revalidatePath("/creators");
    return {
      ok: true,
      message: `Request terkirim untuk ${creator.username || creator.name}. Menunggu keputusan CM Lead / Head.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal mengirim request" };
  }
}

/** Batas satu kali request massal — mencegah satu klik membuat ribuan baris antrean. */
const MAX_BULK_REQUEST = 100;

export interface BulkCmRequestResult {
  created: number;
  /** Sudah pernah diajukan (masih pending) atau sudah dipegang sendiri. */
  skipped: number;
  message: string;
}

/**
 * CM mencentang beberapa kreator "belum punya CM" sekaligus lalu mengajukannya.
 *
 * Sama seperti requestCmAssignment (satu baris), hanya jalur massal: TIDAK ada
 * kepemilikan yang berubah di sini — hanya antrean — dan keputusannya tetap milik
 * pemegang izin m8.assign_creator lewat decideCmRequest (CLAUDE.md #2).
 *
 * Melempar (bukan return) hanya untuk pelanggaran izin / input tidak masuk akal;
 * kegagalan per-baris dilaporkan sebagai `skipped` supaya satu kreator bermasalah
 * tidak menggagalkan seluruh centangan.
 */
export async function requestCmAssignmentBulk(
  creatorIds: string[],
  reason: string | null
): Promise<BulkCmRequestResult> {
  const actor = await requirePermission("creators.request_cm");
  const ids = [...new Set(creatorIds.map((s) => String(s).trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("Belum ada kreator yang dicentang");
  if (ids.length > MAX_BULK_REQUEST) {
    throw new Error(`Maksimal ${MAX_BULK_REQUEST} kreator per pengajuan (dicentang ${ids.length})`);
  }

  const admin = createAdminClient();
  const [{ data: creators }, { data: existing }] = await Promise.all([
    admin.from("creators").select("id, owner_cpm_id").in("id", ids),
    admin
      .from("creator_cm_requests")
      .select("creator_id")
      .eq("requested_by", actor.id)
      .eq("status", "pending")
      .in("creator_id", ids),
  ]);

  const alreadyPending = new Set((existing ?? []).map((r) => r.creator_id));
  const ownerById = new Map((creators ?? []).map((c) => [c.id, c.owner_cpm_id as string | null]));

  const toInsert = ids.filter(
    (id) => ownerById.has(id) && ownerById.get(id) !== actor.id && !alreadyPending.has(id)
  );
  const skipped = ids.length - toInsert.length;
  if (toInsert.length === 0) {
    return {
      created: 0,
      skipped,
      message: "Tidak ada request baru — semua kreator terpilih sudah diajukan atau sudah Anda pegang.",
    };
  }

  const rows = toInsert.map((creatorId) => ({
    id: genId("REQ"),
    creator_id: creatorId,
    requested_by: actor.id,
    current_owner_id: ownerById.get(creatorId) ?? null,
    reason,
    status: "pending" as const,
  }));
  const { error } = await admin.from("creator_cm_requests").insert(rows);
  if (error) throw new Error(`Gagal mengirim request: ${error.message}`);

  // Satu audit per request supaya entity_id-nya tetap menunjuk baris antrean
  // (konsisten dengan jalur satu-baris, dan keputusannya nanti bisa dilacak).
  for (const row of rows) {
    await writeAudit({
      actorId: actor.id,
      action: "creators.request_cm",
      entityType: "creator_cm_requests",
      entityId: row.id,
      after: { creator_id: row.creator_id, requested_by: actor.id, reason, bulk: true },
      type: "auto",
    });
  }

  revalidatePath("/creators");
  return {
    created: rows.length,
    skipped,
    message:
      `${rows.length} request terkirim — menunggu keputusan CM Lead / Head` +
      (skipped > 0 ? ` (${skipped} dilewati: sudah diajukan / sudah Anda pegang).` : "."),
  };
}

/**
 * Terima / tolak request penugasan CM (Director/Head/SPV/CM Lead).
 *
 * Menerima request memindahkan creators.owner_cpm_id ke CM pengaju. Itu aksi
 * MANUSIA yang berpotensi merugikan (mengambil kreator dari CM lain), jadi
 * polanya approval dan keputusannya ditulis ke audit_logs dengan type='approval'
 * (CLAUDE.md #2). Kepemilikan tetap satu sumber di creators.owner_cpm_id —
 * tabel request tidak pernah dijadikan sumber kedua.
 */
export async function decideCmRequest(
  _prev: CmRequestState,
  formData: FormData
): Promise<CmRequestState> {
  try {
    const actor = await requirePermission("creators.decide_cm_request");
    const requestId = String(formData.get("request_id") ?? "").trim();
    const decision = String(formData.get("decision") ?? "").trim();
    const note = String(formData.get("decision_note") ?? "").trim() || null;
    if (!requestId) throw new Error("Request wajib dipilih");
    if (decision !== "accepted" && decision !== "rejected") {
      throw new Error("Keputusan harus 'accepted' atau 'rejected'");
    }

    const admin = createAdminClient();
    const { data: req } = await admin
      .from("creator_cm_requests")
      .select("id, creator_id, requested_by, status")
      .eq("id", requestId)
      .maybeSingle();
    if (!req) throw new Error(`Request ${requestId} tidak ditemukan`);
    if (req.status !== "pending") {
      return { ok: false, message: `Request ini sudah diputuskan (${req.status}).` };
    }

    const [{ data: creator }, { data: requester }] = await Promise.all([
      admin.from("creators").select("id, name, username, owner_cpm_id").eq("id", req.creator_id).maybeSingle(),
      admin.from("team_members").select("id, name, role, active").eq("id", req.requested_by).maybeSingle(),
    ]);
    if (!creator) throw new Error("Kreator pada request sudah tidak ada");
    if (decision === "accepted") {
      if (!requester?.active || !["cpm", "cm_lead"].includes(requester.role)) {
        throw new Error("Pengaju bukan CPM/CM Lead aktif — request tidak bisa diterima");
      }
    }

    const decidedAt = new Date().toISOString();
    const { error: updateReqError } = await admin
      .from("creator_cm_requests")
      .update({ status: decision, decided_by: actor.id, decided_at: decidedAt, decision_note: note })
      .eq("id", requestId)
      .eq("status", "pending"); // guard balapan: dua approver menekan tombol bersamaan
    if (updateReqError) throw new Error(`Gagal menyimpan keputusan: ${updateReqError.message}`);

    if (decision === "accepted") {
      const { error } = await admin
        .from("creators")
        .update({ owner_cpm_id: req.requested_by })
        .eq("id", req.creator_id);
      if (error) throw new Error(`Keputusan tersimpan tapi gagal memindahkan kreator: ${error.message}`);

      await writeAudit({
        actorId: actor.id,
        action: "creators.cm_request_accepted",
        entityType: "creators",
        entityId: req.creator_id,
        before: { owner_cpm_id: creator.owner_cpm_id },
        after: { owner_cpm_id: req.requested_by, request_id: requestId, decision_note: note },
        type: "approval",
      });

      // Request pending LAIN untuk kreator yang sama otomatis gugur — kepemilikan
      // sudah ditentukan, menyisakannya di antrean hanya bikin approver salah klik.
      await admin
        .from("creator_cm_requests")
        .update({
          status: "rejected",
          decided_by: actor.id,
          decided_at: decidedAt,
          decision_note: `Otomatis ditutup: kreator diberikan ke ${requester?.name ?? "CM lain"} (request ${requestId}).`,
        })
        .eq("creator_id", req.creator_id)
        .eq("status", "pending");

      revalidatePath("/creators");
      revalidatePath("/workspace/cm");
      return {
        ok: true,
        message: `Request diterima — ${creator.username || creator.name} sekarang dipegang ${requester?.name ?? "pengaju"}.`,
      };
    }

    await writeAudit({
      actorId: actor.id,
      action: "creators.cm_request_rejected",
      entityType: "creator_cm_requests",
      entityId: requestId,
      before: { status: "pending" },
      after: { status: "rejected", decision_note: note },
      type: "approval",
    });

    revalidatePath("/creators");
    return { ok: true, message: "Request ditolak." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal memproses request" };
  }
}
