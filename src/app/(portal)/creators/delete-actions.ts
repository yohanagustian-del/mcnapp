"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import {
  DERIVED_CHILDREN,
  MATERIAL_CHILDREN,
  MAX_BULK_DELETE,
  blockReason,
  type DeleteOutcome,
  type DeleteReport,
  type MaterialCounts,
} from "@/lib/creators/delete";

/**
 * Hapus kreator dari master data — satu baris atau banyak baris tercentang.
 *
 * Permanen dan tidak bisa di-undo dari UI, jadi tiga pengaman berlapis:
 *  1. RBAC server-side: `creators.delete` (management saja — lihat lib/rbac.ts),
 *     bukan cuma tombolnya disembunyikan. Dicermin oleh RLS di migration 0028.
 *  2. Preflight dependensi: kreator yang masih punya data MATERIAL (kontrak,
 *     report, komisi, request, akun portal, dst) DITOLAK — pakai status
 *     `nonaktif`. Lihat lib/creators/delete.ts untuk klasifikasinya.
 *  3. audit_logs menyimpan SELURUH baris creators di `before`, jadi data masih
 *     bisa direkonstruksi dari log kalau ternyata salah hapus.
 *
 * Per-kreator, bukan all-or-nothing: yang lolos dihapus, yang terblokir
 * dilaporkan dengan alasannya supaya bulk delete tidak batal total gara-gara
 * satu baris.
 */
export async function deleteCreators(ids: string[]): Promise<DeleteReport> {
  const actor = await requirePermission("creators.delete");

  // Dedup + buang yang kosong; kalau kosong, tidak ada yang perlu dikerjakan.
  const targets = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (targets.length === 0) return { deleted: [], blocked: [] };
  if (targets.length > MAX_BULK_DELETE) {
    throw new Error(
      `Maksimal ${MAX_BULK_DELETE} kreator per sekali hapus (dipilih ${targets.length}). Hapus bertahap.`
    );
  }

  const admin = createAdminClient();

  // Snapshot seluruh baris yang akan dihapus — dipakai untuk audit `before` dan
  // untuk label di laporan hasil.
  const { data: rows, error: readErr } = await admin
    .from("creators")
    .select("*")
    .in("id", targets);
  if (readErr) throw new Error(`Gagal membaca data kreator: ${readErr.message}`);

  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows ?? []) byId.set(String(r.id), r as Record<string, unknown>);

  const deleted: DeleteOutcome[] = [];
  const blocked: DeleteOutcome[] = [];

  for (const id of targets) {
    const row = byId.get(id);
    if (!row) {
      blocked.push({ id, label: id, ok: false, reason: "kreator tidak ditemukan (mungkin sudah dihapus)" });
      continue;
    }
    const label = String(row.username || row.name || id);

    // --- Preflight: data material memblokir penghapusan ---
    const counts: MaterialCounts = {};
    let countFailed: string | null = null;
    for (const child of MATERIAL_CHILDREN) {
      const { count, error } = await admin
        .from(child.table)
        .select("*", { count: "exact", head: true })
        .eq(child.column, id);
      if (error) {
        // Gagal memeriksa = tidak boleh lanjut menghapus (fail closed).
        countFailed = `gagal memeriksa ${child.label}: ${error.message}`;
        break;
      }
      if (count && count > 0) counts[child.label] = (counts[child.label] ?? 0) + count;
    }
    if (countFailed) {
      blocked.push({ id, label, ok: false, reason: countFailed });
      continue;
    }

    const reason = blockReason(counts);
    if (reason) {
      blocked.push({
        id,
        label,
        ok: false,
        reason: `${reason} — set status "nonaktif" saja, jangan dihapus`,
      });
      continue;
    }

    // --- Hapus data turunan lebih dulu, baru baris kreatornya ---
    let derivedError: string | null = null;
    for (const child of DERIVED_CHILDREN) {
      const { error } = await admin.from(child.table).delete().eq(child.column, id);
      if (error) {
        derivedError = `gagal menghapus ${child.label}: ${error.message}`;
        break;
      }
    }
    if (derivedError) {
      blocked.push({ id, label, ok: false, reason: derivedError });
      continue;
    }

    const { error: delErr } = await admin.from("creators").delete().eq("id", id);
    if (delErr) {
      blocked.push({ id, label, ok: false, reason: `gagal menghapus kreator: ${delErr.message}` });
      continue;
    }

    // Snapshot penuh di `before` = satu-satunya jalan pulih kalau salah hapus.
    await writeAudit({
      actorId: actor.id,
      action: "creator.delete",
      entityType: "creators",
      entityId: id,
      before: row,
      after: null,
      type: "auto",
    });
    deleted.push({ id, label, ok: true });
  }

  if (deleted.length > 0) revalidatePath("/creators");
  return { deleted, blocked };
}
