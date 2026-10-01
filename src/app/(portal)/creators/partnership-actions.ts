"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditBatch, type AuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseSheet } from "@/lib/utils/sheet";
import {
  buildPartnershipRows,
  mergePartnershipState,
  partnershipRegressions,
  partnershipStateChanged,
  partnershipTone,
  PARTNERSHIP_REQUIRED_HEADERS,
  type PartnershipState,
} from "@/lib/creators/partnership-spec";
import { buildPartnershipTemplate, PARTNERSHIP_TEMPLATE_FILENAME } from "@/lib/creators/partnership-template";
import { loadPartnershipLabels, type CreatorPartnershipRow } from "@/lib/creators/partnership";

/** Template .xlsx as base64 (same download pattern as downloadCreatorTemplate). */
export async function downloadPartnershipTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("creators.partnership_upload");
  const buffer = buildPartnershipTemplate(await loadPartnershipLabels());
  return { filename: PARTNERSHIP_TEMPLATE_FILENAME, base64: Buffer.from(buffer).toString("base64") };
}

export interface PartnershipUploadReport {
  batchId: number;
  totalRows: number;
  matched: number;
  unchanged: number;
  changed: number;
  alerts: number;
  /** Username (platform) not registered as a creator — skipped, never created (A3). */
  unknownUsernames: string[];
  /** Row-level problems: fatal errors (row skipped) and ignored cells. */
  rowNotes: { rowNumber: number; username: string; message: string }[];
}

type CreatorRef = { id: string; name: string; owner_cpm_id: string | null };

/**
 * Upload status kemitraan (Improvement MCN T5) — the ONLY writer of
 * creator_partnership_status (no per-row edit, Q2). Rows are matched to EXISTING
 * creators by (lower(username), platform); unknown usernames are skipped and reported
 * (aturan 0049: kreator tidak lahir dari file sampingan).
 *
 * Audit (CLAUDE.md #2): every status change is logged. A regression
 * (partnership linked/link_req → unlink_req/not_linked, fee agree → disagree/
 * cancellation_req) is a platform-side event the team cannot undo here, so it is an
 * ALERT (audit type platform_alert + platform_alerts.partnership_drop for the owning CM),
 * not an approval. Other changes are `auto`.
 */
export async function uploadPartnershipStatus(formData: FormData): Promise<PartnershipUploadReport> {
  const actor = await requirePermission("creators.partnership_upload");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Excel terlebih dahulu.");

  const { rows: sheetRows, errors } = await parseSheet(file, PARTNERSHIP_REQUIRED_HEADERS);
  if (errors.length) throw new Error(errors.join("; "));
  const parsed = buildPartnershipRows(sheetRows);
  if (parsed.length === 0) throw new Error("File tidak berisi baris data.");

  const admin = createAdminClient();

  // Paginated: PostgREST caps a select at 1000 rows.
  const creators = await fetchAll<CreatorRef & { username: string | null; platform: string | null }>(
    admin, "creators", "id, name, username, platform, owner_cpm_id", (q) => q.not("username", "is", null)
  );
  const byKey = new Map<string, CreatorRef>();
  for (const c of creators) {
    const u = String(c.username ?? "").trim().toLowerCase();
    if (u) byKey.set(`${c.platform ?? "tiktok"}:${u}`, c);
  }

  const report: PartnershipUploadReport = {
    batchId: 0, totalRows: parsed.length, matched: 0, unchanged: 0, changed: 0, alerts: 0,
    unknownUsernames: [], rowNotes: [],
  };

  const matched: { row: (typeof parsed)[number]; creator: CreatorRef }[] = [];
  for (const row of parsed) {
    if (row.error) {
      report.rowNotes.push({ rowNumber: row.rowNumber, username: row.username, message: row.error });
      continue;
    }
    for (const issue of row.issues) {
      report.rowNotes.push({ rowNumber: row.rowNumber, username: row.username, message: issue });
    }
    const creator = byKey.get(`${row.platform}:${row.username.toLowerCase()}`);
    if (!creator) {
      report.unknownUsernames.push(`@${row.username} (${row.platform})`);
      continue;
    }
    matched.push({ row, creator });
  }
  report.matched = matched.length;

  // Current state of the matched creators.
  const oldById = new Map<string, CreatorPartnershipRow>();
  const ids = matched.map((m) => m.creator.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("creator_partnership_status")
      .select("creator_id, platform, partnership_status, fee_agreement_status, source_batch_id, updated_at")
      .in("creator_id", ids.slice(i, i + 200));
    if (error) throw new Error(`Gagal memuat status kemitraan: ${error.message}`);
    for (const r of (data ?? []) as CreatorPartnershipRow[]) oldById.set(r.creator_id, r);
  }

  const changes: {
    creator: CreatorRef;
    platform: "tiktok" | "shopee";
    before: PartnershipState | null;
    after: PartnershipState;
    regression: { partnership: boolean; fee: boolean };
  }[] = [];
  for (const { row, creator } of matched) {
    const prev = oldById.get(creator.id);
    const before: PartnershipState | null = prev
      ? { partnership: prev.partnership_status, fee: prev.fee_agreement_status }
      : null;
    const after = mergePartnershipState(before, row);
    if (!partnershipStateChanged(before, after) && prev?.platform === row.platform) {
      report.unchanged++;
      continue;
    }
    changes.push({ creator, platform: row.platform, before, after, regression: partnershipRegressions(before, after) });
  }

  // Batch log first: every written row points back to it (source_batch_id).
  const { data: batch, error: batchError } = await admin
    .from("creator_partnership_uploads")
    .insert({
      file_name: file.name, uploaded_by: actor.id, total_rows: report.totalRows,
      matched_rows: report.matched, unknown_usernames: report.unknownUsernames.length,
      changed_rows: changes.length,
      alert_rows: changes.filter((c) => c.regression.partnership || c.regression.fee).length,
      summary: { unknown_usernames: report.unknownUsernames, row_notes: report.rowNotes },
    })
    .select("id")
    .single();
  if (batchError || !batch) throw new Error(`Gagal mencatat batch upload: ${batchError?.message ?? "tanpa id"}`);
  report.batchId = Number(batch.id);

  const now = new Date().toISOString();
  for (let i = 0; i < changes.length; i += 500) {
    const { error } = await admin.from("creator_partnership_status").upsert(
      changes.slice(i, i + 500).map((c) => ({
        creator_id: c.creator.id, platform: c.platform,
        partnership_status: c.after.partnership, fee_agreement_status: c.after.fee,
        source_batch_id: report.batchId, updated_by: actor.id, updated_at: now,
      })),
      { onConflict: "creator_id" }
    );
    if (error) throw new Error(`Gagal menyimpan status kemitraan: ${error.message}`);
  }

  // Alerts: one open partnership_drop per creator. A new regression refreshes the open
  // alert; a creator whose statuses are no longer red gets theirs resolved.
  const touchedIds = changes.map((c) => c.creator.id);
  const openByCreator = new Map<string, number>();
  for (let i = 0; i < touchedIds.length; i += 200) {
    const { data, error } = await admin
      .from("platform_alerts").select("id, entity_id")
      .eq("alert_type", "partnership_drop").eq("resolved", false)
      .in("entity_id", touchedIds.slice(i, i + 200));
    if (error) throw new Error(`Gagal memuat alert kemitraan: ${error.message}`);
    for (const a of data ?? []) openByCreator.set(String(a.entity_id), Number(a.id));
  }

  const audits: AuditEntry[] = [];
  for (const c of changes) {
    const isDrop = c.regression.partnership || c.regression.fee;
    if (isDrop) {
      report.alerts++;
      const parts = [
        c.regression.partnership ? `Management Partnership ${c.before?.partnership} → ${c.after.partnership}` : null,
        c.regression.fee ? `Fee Agreement ${c.before?.fee} → ${c.after.fee}` : null,
      ].filter(Boolean);
      const alert = {
        message: `Status kemitraan ${c.creator.name} turun: ${parts.join(", ")} — hubungi kreator`,
        payload: {
          owner_cpm_id: c.creator.owner_cpm_id, platform: c.platform,
          before: c.before, after: c.after, batch_id: report.batchId,
        },
      };
      const openId = openByCreator.get(c.creator.id);
      const { error } = openId
        ? await admin.from("platform_alerts").update(alert).eq("id", openId)
        : await admin.from("platform_alerts").insert({
            alert_type: "partnership_drop", entity_type: "creators", entity_id: c.creator.id, ...alert,
          });
      if (error) throw new Error(`Gagal menulis alert kemitraan: ${error.message}`);
    } else {
      const openId = openByCreator.get(c.creator.id);
      const stillRed = partnershipTone(c.after.partnership) === "red" || partnershipTone(c.after.fee) === "red";
      if (openId && !stillRed) {
        const { error } = await admin.from("platform_alerts").update({ resolved: true }).eq("id", openId);
        if (error) throw new Error(`Gagal menutup alert kemitraan: ${error.message}`);
      }
    }
    audits.push({
      actorId: actor.id, action: isDrop ? "creators.partnership_drop" : "creators.partnership_update",
      entityType: "creators", entityId: c.creator.id,
      before: c.before, after: { ...c.after, platform: c.platform, batch_id: report.batchId },
      type: isDrop ? "platform_alert" : "auto",
    });
  }
  audits.push({
    actorId: actor.id, action: "creators.partnership_upload", entityType: "creator_partnership_uploads",
    entityId: String(report.batchId),
    after: {
      file_name: file.name, total: report.totalRows, matched: report.matched, changed: changes.length,
      alerts: report.alerts, unknown: report.unknownUsernames.length,
    },
    type: "auto",
  });
  await writeAuditBatch(audits);

  report.changed = changes.length;
  revalidatePath("/creators");
  revalidatePath("/workspace/cm");
  return report;
}
