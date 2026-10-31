// Alert `ads_mea_budget_exhausted` (constraint 0100, plan §7 butir 7) — SATU penulis.
// Jatah Budget MEA kreator untuk satu bulan habis → alert in-app untuk Head/Director
// (badge `/ads` + panel di `/ads/jatah`). Bukan approval: request yang melewati jatah
// sudah ditahan approval Director (D-2026-10-31-4); alert ini sekadar memberi tahu bahwa
// sisa jatah = 0 supaya Head bisa menaikkan jatah atau menahan request berikutnya.
//
// Disinkron (buka / perbarui / tutup) setiap kali terpakai atau jatah berubah:
// request mea_budget dibuat, status berubah (tolak/batal/ACC dengan nominal disetujui),
// atau Head mengubah jatah. Idempoten per (kreator, bulan) selama alert belum resolved.

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/lib/audit";
import { rupiah } from "@/lib/utils/format";
import { loadMeaBudgetContext } from "./request-data";
import { meaBudgetExhausted } from "./request";

export const MEA_BUDGET_ALERT_TYPE = "ads_mea_budget_exhausted";
export const MEA_BUDGET_ALERT_ENTITY = "creator_ads_monthly_budgets";

/** entity_id alert = kunci jatah, sama dengan entityId audit `m10.mea_budget_set`. */
export function meaBudgetAlertEntityId(creatorId: string, month: string): string {
  return `${creatorId}:${month}`;
}

export type MeaBudgetAlertResult = "opened" | "updated" | "resolved" | "unchanged";

/**
 * Buka / perbarui / tutup alert jatah habis untuk (kreator, bulan YYYY-MM-01).
 * Tidak pernah melempar ke pemanggil: kegagalan alert tidak boleh membatalkan aksi
 * utama yang sudah tersimpan (request / jatah) — dicatat ke log saja.
 */
export async function syncMeaBudgetExhaustedAlert(
  admin: SupabaseClient,
  creatorId: string,
  month: string,
  actorId: string | null
): Promise<MeaBudgetAlertResult> {
  try {
    const ctx = await loadMeaBudgetContext(creatorId, month, 0);
    const exhausted = meaBudgetExhausted(ctx);
    const entityId = meaBudgetAlertEntityId(creatorId, month);

    const { data: open, error: openErr } = await admin
      .from("platform_alerts")
      .select("id, payload")
      .eq("alert_type", MEA_BUDGET_ALERT_TYPE)
      .eq("entity_type", MEA_BUDGET_ALERT_ENTITY)
      .eq("entity_id", entityId)
      .eq("resolved", false)
      .limit(1)
      .maybeSingle();
    if (openErr) throw new Error(openErr.message);

    if (!exhausted) {
      if (!open) return "unchanged";
      const { error } = await admin.from("platform_alerts").update({ resolved: true }).eq("id", open.id);
      if (error) throw new Error(error.message);
      await writeAudit({
        actorId, action: "m10.mea_budget_exhausted_resolved", entityType: MEA_BUDGET_ALERT_ENTITY, entityId,
        before: { resolved: false }, after: { resolved: true, budget: ctx.budget, used: ctx.used }, type: "platform_alert",
      });
      return "resolved";
    }

    const { data: creator } = await admin.from("creators").select("name").eq("id", creatorId).maybeSingle();
    const name = (creator?.name as string | undefined) ?? creatorId;
    const payload = { creator_id: creatorId, month, budget: ctx.budget, used: ctx.used };
    const message =
      `Jatah Budget MEA ${name} bulan ${month.slice(0, 7)} habis — terpakai ${rupiah(ctx.used)} dari jatah ${rupiah(ctx.budget)}. ` +
      `Request Budget MEA berikutnya butuh approval Director.`;

    if (open) {
      const prev = (open.payload ?? {}) as { budget?: number; used?: number };
      if (Number(prev.budget) === ctx.budget && Number(prev.used) === ctx.used) return "unchanged";
      const { error } = await admin.from("platform_alerts").update({ message, payload }).eq("id", open.id);
      if (error) throw new Error(error.message);
      return "updated";
    }

    const { error } = await admin.from("platform_alerts").insert({
      alert_type: MEA_BUDGET_ALERT_TYPE, entity_type: MEA_BUDGET_ALERT_ENTITY, entity_id: entityId,
      message, payload, week: month,
    });
    if (error) throw new Error(error.message);
    await writeAudit({
      actorId, action: "m10.mea_budget_exhausted", entityType: MEA_BUDGET_ALERT_ENTITY, entityId,
      after: payload, type: "platform_alert",
    });
    return "opened";
  } catch (e) {
    console.error("syncMeaBudgetExhaustedAlert:", e instanceof Error ? e.message : e);
    return "unchanged";
  }
}

export interface MeaBudgetAlertRow {
  id: number;
  creatorId: string;
  month: string;
  message: string;
  createdAt: string;
}

/** Alert jatah habis yang masih terbuka (opsional: satu bulan). 0100 belum ada → []. */
export async function loadOpenMeaBudgetAlerts(admin: SupabaseClient, month?: string): Promise<MeaBudgetAlertRow[]> {
  let q = admin
    .from("platform_alerts")
    .select("id, entity_id, message, payload, created_at")
    .eq("alert_type", MEA_BUDGET_ALERT_TYPE)
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(200);
  if (month) q = q.eq("week", month);
  const { data, error } = await q;
  if (error) return [];
  return ((data ?? []) as { id: number; entity_id: string; message: string; payload: { creator_id?: string; month?: string } | null; created_at: string }[])
    .map((a) => ({
      id: a.id,
      creatorId: a.payload?.creator_id ?? a.entity_id.split(":")[0],
      month: a.payload?.month ?? a.entity_id.split(":")[1] ?? "",
      message: a.message,
      createdAt: a.created_at,
    }));
}
