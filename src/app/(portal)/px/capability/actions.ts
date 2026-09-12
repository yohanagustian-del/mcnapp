"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  CAPABILITY_BULK_LIMIT, capabilityRowKey, listCapabilityRows, listCoverage,
} from "@/lib/px/capability-data";
import { buildCoverageCsv } from "@/lib/px/coverage-export";

/**
 * PX-M1 server actions — Tab Registry bulk edit (slots_total) + Tab Coverage CSV
 * export. All writes/reads go through the `public.px_capability_*` RPC wrappers
 * (migration 0051); `bridge.px_creator_capability` itself is never touched
 * directly (see capability-data.ts doc).
 *
 * K4 gate (surat tugas §2/Langkah 5 — PRD §3.2 Rule 4 deviation, confirmed by
 * Lukman/Sr SPV MCN 2026-09-12): role list alone (`px.capability.write`) is not
 * enough. Management/cm_lead may touch every row; `cpm` may only touch rows
 * whose creators.owner_cpm_id is their own id. Out-of-scope rows are REJECTED
 * with an explicit Bahasa Indonesia message (never silently dropped) — the UI
 * already only offers a CPM their own creators, so this gate is a server fence,
 * not an everyday user experience (surat tugas Langkah 5).
 */

export interface CapabilityRowUpdate {
  creatorId: string;
  level2Category: string;
  priceSegment: string;
  slotsTotal: number;
}

export type CapabilityBulkState = { ok: boolean; message: string } | null;

function parseUpdates(raw: string): CapabilityRowUpdate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: CapabilityRowUpdate[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).creatorId === "string" &&
      typeof (item as Record<string, unknown>).level2Category === "string" &&
      typeof (item as Record<string, unknown>).priceSegment === "string" &&
      typeof (item as Record<string, unknown>).slotsTotal === "number"
    ) {
      out.push(item as CapabilityRowUpdate);
    }
  }
  return out;
}

/**
 * Bulk-set `slots_total` for the selected Registry rows (surat tugas Langkah 6
 * — bulk edit ≥50 rows in one save, `slots_total >= slots_committed` validated
 * server-side with a message naming the current slots_committed number).
 */
export async function bulkSetCapabilitySlots(
  _prev: CapabilityBulkState,
  formData: FormData
): Promise<CapabilityBulkState> {
  try {
    const actor = await requirePermission("px.capability.write");
    const updates = parseUpdates(String(formData.get("updates") ?? "[]"));
    if (updates.length === 0) throw new Error("Belum ada baris yang diubah");
    if (updates.length > CAPABILITY_BULK_LIMIT) {
      throw new Error(`Maksimal ${CAPABILITY_BULK_LIMIT} baris sekali simpan (terpilih ${updates.length})`);
    }
    for (const u of updates) {
      if (!Number.isInteger(u.slotsTotal) || u.slotsTotal < 0) {
        throw new Error(`Slot Total untuk ${u.creatorId} (${u.level2Category}) harus bilangan bulat ≥ 0`);
      }
    }

    const admin = createAdminClient();
    const creatorIds = [...new Set(updates.map((u) => u.creatorId))];

    // K4 per-row gate (see file doc): cpm restricted to creators.owner_cpm_id = self.
    if (actor.role === "cpm") {
      const { data: owned, error } = await admin
        .from("creators")
        .select("id, owner_cpm_id")
        .in("id", creatorIds);
      if (error) throw new Error(`Gagal memeriksa kepemilikan kreator: ${error.message}`);
      const ownerById = new Map((owned ?? []).map((c) => [c.id as string, c.owner_cpm_id as string | null]));
      const outOfScope = creatorIds.filter((id) => ownerById.get(id) !== actor.id);
      if (outOfScope.length > 0) {
        throw new Error(
          `Akses ditolak: sebagai CPM Anda hanya bisa mengubah slot kreator yang Anda pegang sendiri. ` +
            `Kreator di luar jangkauan: ${outOfScope.join(", ")}.`
        );
      }
    }

    // "Before" state (scoped to the involved creators only) — both for the
    // slots_total >= slots_committed validation and the audit before/after.
    const currentRows = await listCapabilityRows(admin, creatorIds);
    const byKey = new Map(currentRows.map((r) => [capabilityRowKey(r.creatorId, r.level2Category, r.priceSegment), r]));

    const violations: string[] = [];
    const beforeRows: unknown[] = [];
    for (const u of updates) {
      const current = byKey.get(capabilityRowKey(u.creatorId, u.level2Category, u.priceSegment));
      if (!current) {
        violations.push(`${u.creatorId} / ${u.level2Category} / ${u.priceSegment}: baris tidak ditemukan di registry`);
        continue;
      }
      beforeRows.push({ ...u, slotsTotalBefore: current.slotsTotal });
      if (u.slotsTotal < current.slotsCommitted) {
        violations.push(
          `${current.creatorName ?? u.creatorId} — ${u.level2Category} (${u.priceSegment}): Slot Total baru ` +
            `(${u.slotsTotal}) tidak boleh kurang dari slot yang sudah terisi saat ini (${current.slotsCommitted}).`
        );
      }
    }
    if (violations.length > 0) {
      throw new Error(
        `Gagal menyimpan ${violations.length} baris:\n${violations.slice(0, 10).join("\n")}` +
          (violations.length > 10 ? `\n… ${violations.length - 10} lainnya` : "")
      );
    }

    const { data: affected, error: rpcError } = await admin.rpc("px_capability_bulk_set_slots", {
      p_updates: updates.map((u) => ({
        creator_id: u.creatorId,
        level2_category: u.level2Category,
        price_segment: u.priceSegment,
        slots_total: u.slotsTotal,
      })),
      p_actor: actor.id,
    });
    if (rpcError) throw new Error(`Gagal menyimpan: ${rpcError.message}`);

    await writeAudit({
      actorId: actor.id,
      action: "px_slots_updated",
      entityType: "bridge.px_creator_capability",
      before: beforeRows,
      after: updates,
      type: "auto", // menaikkan/menurunkan slot tim sendiri tidak merugikan perusahaan (CLAUDE.md #2)
    });

    revalidatePath("/px/capability");
    return { ok: true, message: `${(affected as number | null) ?? updates.length} baris kapasitas diperbarui.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal menyimpan kapasitas" };
  }
}

/** Tab Coverage CSV export (pattern: builder string in server + Blob in client). */
export async function downloadCapabilityCoverageCsv(formData: FormData): Promise<{ filename: string; csv: string }> {
  await requirePermission("px.capability.read");
  const level2 = String(formData.get("level2") ?? "").trim() || null;
  const admin = createAdminClient();
  const rows = await listCoverage(admin, level2);
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `px-coverage-${stamp}.csv`, csv: buildCoverageCsv(rows) };
}
