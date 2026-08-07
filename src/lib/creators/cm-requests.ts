import { createAdminClient } from "@/lib/supabase/admin";

export type CmRequestStatus = "pending" | "accepted" | "rejected";

/** Satu baris antrean request penugasan CM, sudah di-resolve ke nama-nama. */
export interface CmRequestRow {
  id: string;
  creator_id: string;
  creatorLabel: string;
  creatorUsername: string | null;
  requested_by: string;
  requesterName: string;
  current_owner_id: string | null;
  currentOwnerName: string | null;
  reason: string | null;
  status: CmRequestStatus;
  decided_by: string | null;
  deciderName: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

export interface CmRequestsData {
  /** Antrean yang masih menunggu keputusan (terlama dulu — FIFO, tidak ada yang tertinggal). */
  pending: CmRequestRow[];
  /** 20 keputusan terakhir, supaya CM tahu request-nya diterima/ditolak. */
  recent: CmRequestRow[];
  /** creator_id yang sudah punya request pending dari CM yang sedang login. */
  myPendingCreatorIds: string[];
  /**
   * Jumlah request pending per creator_id — penanda antrean di daftar "Kreator
   * belum punya CM" supaya approver melihat siapa yang sudah diminta CM.
   */
  pendingCountByCreator: Record<string, number>;
}

/**
 * Jumlah request penugasan CM yang masih menunggu keputusan — dipakai badge
 * notifikasi di menu "Kreator" untuk role yang boleh memutuskan
 * (creators.decide_cm_request). Head-only count, tidak menarik baris.
 */
export async function countPendingCmRequests(): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("creator_cm_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

interface RawRequest {
  id: string;
  creator_id: string;
  requested_by: string;
  current_owner_id: string | null;
  reason: string | null;
  status: CmRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

/**
 * Antrean request penugasan CM untuk halaman Kreator.
 *
 * Baca-saja & deterministik: menggabungkan `creator_cm_requests` dengan nama
 * kreator + nama anggota tim lewat dua SELECT `.in(...)` (bukan N+1 per baris,
 * dan bukan embed PostgREST — `requested_by`/`decided_by`/`current_owner_id`
 * menunjuk tabel yang sama sehingga embed-nya ambigu).
 *
 * Kepemilikan kreator TETAP satu sumber (creators.owner_cpm_id); tabel request
 * hanya antrean. `currentOwnerName` diambil dari kepemilikan LIVE, bukan dari
 * snapshot saat request dibuat, supaya approver melihat keadaan sekarang.
 */
export async function loadCmRequests(viewerId: string): Promise<CmRequestsData> {
  const admin = createAdminClient();

  const [{ data: pendingRaw }, { data: recentRaw }] = await Promise.all([
    admin
      .from("creator_cm_requests")
      .select("id, creator_id, requested_by, current_owner_id, reason, status, decided_by, decided_at, decision_note, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(200),
    admin
      .from("creator_cm_requests")
      .select("id, creator_id, requested_by, current_owner_id, reason, status, decided_by, decided_at, decision_note, created_at")
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(20),
  ]);

  const all = [...((pendingRaw ?? []) as RawRequest[]), ...((recentRaw ?? []) as RawRequest[])];
  if (all.length === 0) {
    return { pending: [], recent: [], myPendingCreatorIds: [], pendingCountByCreator: {} };
  }

  const creatorIds = [...new Set(all.map((r) => r.creator_id))];
  const memberIds = [
    ...new Set(
      all.flatMap((r) => [r.requested_by, r.current_owner_id, r.decided_by].filter(Boolean) as string[])
    ),
  ];

  const [{ data: creators }, { data: members }] = await Promise.all([
    admin.from("creators").select("id, name, username, owner_cpm_id").in("id", creatorIds),
    memberIds.length > 0
      ? admin.from("team_members").select("id, name").in("id", memberIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const creatorById = new Map((creators ?? []).map((c) => [c.id, c]));
  const memberNameById = new Map((members ?? []).map((m) => [m.id, m.name]));

  // Pemilik LIVE juga perlu nama; owner bisa berubah setelah request dibuat.
  const liveOwnerIds = [
    ...new Set(
      (creators ?? []).map((c) => c.owner_cpm_id as string | null).filter((v): v is string => Boolean(v))
    ),
  ].filter((id) => !memberNameById.has(id));
  if (liveOwnerIds.length > 0) {
    const { data: extra } = await admin.from("team_members").select("id, name").in("id", liveOwnerIds);
    for (const m of extra ?? []) memberNameById.set(m.id, m.name);
  }

  const toRow = (r: RawRequest): CmRequestRow => {
    const creator = creatorById.get(r.creator_id);
    const liveOwnerId = (creator?.owner_cpm_id as string | null) ?? null;
    return {
      id: r.id,
      creator_id: r.creator_id,
      creatorLabel: creator?.username || creator?.name || r.creator_id,
      creatorUsername: (creator?.username as string | null) ?? null,
      requested_by: r.requested_by,
      requesterName: memberNameById.get(r.requested_by) ?? "—",
      current_owner_id: liveOwnerId,
      currentOwnerName: liveOwnerId ? (memberNameById.get(liveOwnerId) ?? "—") : null,
      reason: r.reason,
      status: r.status,
      decided_by: r.decided_by,
      deciderName: r.decided_by ? (memberNameById.get(r.decided_by) ?? "—") : null,
      decided_at: r.decided_at,
      decision_note: r.decision_note,
      created_at: r.created_at,
    };
  };

  const pending = ((pendingRaw ?? []) as RawRequest[]).map(toRow);
  const pendingCountByCreator: Record<string, number> = {};
  for (const r of pending) {
    pendingCountByCreator[r.creator_id] = (pendingCountByCreator[r.creator_id] ?? 0) + 1;
  }
  return {
    pending,
    recent: ((recentRaw ?? []) as RawRequest[]).map(toRow),
    myPendingCreatorIds: pending.filter((r) => r.requested_by === viewerId).map((r) => r.creator_id),
    pendingCountByCreator,
  };
}
