"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditBatch, type AuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { todayWib } from "@/lib/utils/date";
import { fetchAll } from "@/lib/supabase/fetch-all";
import {
  BULK_DEAL_EXPORT_FILENAME,
  buildBulkDealWorkbook,
  formatSupportTypes,
  parseBulkDealMatrix,
  readSheetMatrix,
  type BulkDealColumnKey,
  type BulkDealParseResult,
} from "@/lib/deals/bulk-deal-spec";
import { BULK_PLATFORM, type BulkDealPlan } from "@/lib/deals/bulk-deal-plan";
import { BULK_SELECT_COLS, loadPlanContext } from "@/lib/deals/bulk-deal-load";
import { syncShopHandlers } from "@/lib/deals/bizdev-handlers";
import { BULK_RUN_ACTION, toRunLog } from "@/lib/deals/bulk-deal-preview";
import { dealStatusLabel, writeWithDealStatusFallback } from "@/lib/deals/deal-status";

/**
 * Import Bulk Deal Brand (/deals/import) — menggantikan importer master deal lama.
 * Alur: Preview (tanpa tulis) → Simpan (upsert per (platform, shop_id, brand_name)).
 * Satu logika dengan dry-run & halaman preview (lib/deals/bulk-deal-plan.ts). Baris
 * yang tidak ada di sheet TIDAK dihapus di sini — Replace = langkah Promote terpisah
 * yang butuh persetujuan Yohan (DECISIONS D-2026-10-20-5).
 */

async function parseUpload(formData: FormData): Promise<BulkDealParseResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("File .xlsx / .csv wajib diunggah.");
  const buf = new Uint8Array(await file.arrayBuffer());
  const matrix = file.name.toLowerCase().endsWith(".csv")
    ? readSheetMatrix(new TextDecoder("utf-8").decode(buf), file.name)
    : readSheetMatrix(buf, file.name);
  return parseBulkDealMatrix(matrix);
}

export interface BulkImportResult {
  ok: boolean;
  error?: string;
  envRowCount?: number;
  plan?: BulkDealPlan;
  saved?: {
    inserted: number;
    updated: number;
    handlers: number;
    failed: { sheetRow: number; brandName: string; reason: string }[];
  };
}

export async function previewBulkDeals(formData: FormData): Promise<BulkImportResult> {
  await requirePermission("deals.import_legacy");
  try {
    const parsed = await parseUpload(formData);
    if (parsed.errors.length) return { ok: false, error: parsed.errors.join(" ") };
    const ctx = await loadPlanContext(createAdminClient(), parsed);
    return { ok: true, envRowCount: ctx.envRowCount, plan: ctx.plan };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membaca file." };
  }
}

export async function commitBulkDeals(formData: FormData): Promise<BulkImportResult> {
  const actor = await requirePermission("deals.import_legacy");
  const admin = createAdminClient();
  let plan: BulkDealPlan;
  let envRowCount: number;
  try {
    const parsed = await parseUpload(formData);
    if (parsed.errors.length) return { ok: false, error: parsed.errors.join(" ") };
    ({ plan, envRowCount } = await loadPlanContext(admin, parsed));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal membaca file." };
  }
  const failed: NonNullable<BulkImportResult["saved"]>["failed"] = [];
  const audits: AuditEntry[] = [];

  // ---- INSERT per batch; batch gagal → ulangi per baris supaya baris lain tetap masuk.
  const inserts = plan.inserts.map((p) => ({
    src: p.row,
    rec: {
      id: genId("DEAL"),
      platform: BULK_PLATFORM,
      ...p.record,
      deal_end: p.record.exp_date,
      notes: p.row.extraNote,
      review_flags: p.row.warnings,
      created_by: actor.id,
    },
  }));
  let inserted = 0;
  const okIds: typeof inserts = [];
  for (let i = 0; i < inserts.length; i += 200) {
    const chunk = inserts.slice(i, i + 200);
    const { error } = await admin.from("brand_deals").insert(chunk.map((c) => c.rec));
    if (!error) {
      inserted += chunk.length;
      okIds.push(...chunk);
      continue;
    }
    for (const c of chunk) {
      const { error: e1 } = await writeWithDealStatusFallback(c.rec, (r) => admin.from("brand_deals").insert(r));
      if (e1) failed.push({ sheetRow: c.src.sheetRow, brandName: c.src.brandName, reason: e1.message ?? "gagal" });
      else {
        inserted++;
        okIds.push(c);
      }
    }
  }
  for (const { rec } of okIds) {
    audits.push({
      actorId: actor.id, action: "brand_deal.bulk_import", entityType: "brand_deals", entityId: rec.id,
      after: { op: "insert", brand_name: rec.brand_name, shop_id: rec.shop_id, status: rec.status }, type: "auto",
    });
  }

  // ---- UPDATE hanya field yang berubah.
  let updated = 0;
  for (const u of plan.updates) {
    const patch: Record<string, unknown> & { status?: string | null } = Object.fromEntries(
      u.diffs.map((d) => [d.field, d.after])
    );
    if ("exp_date" in patch) patch.deal_end = patch.exp_date;
    patch.review_flags = u.row.warnings;
    const { error } = await writeWithDealStatusFallback(patch, (rec) =>
      admin.from("brand_deals").update(rec).eq("id", u.existingId!)
    );
    if (error) {
      failed.push({ sheetRow: u.row.sheetRow, brandName: u.row.brandName, reason: error.message ?? "gagal" });
      continue;
    }
    updated++;
    audits.push({
      actorId: actor.id, action: "brand_deal.bulk_import", entityType: "brand_deals", entityId: u.existingId,
      before: Object.fromEntries(u.diffs.map((d) => [d.field, d.before])), after: { op: "update", ...patch }, type: "auto",
    });
  }

  // ---- shop_key (kolom generated) → BizDev handler; exp_date → cooperating_shops (alert M4).
  const shopIds = [...new Set([...plan.inserts, ...plan.updates, ...plan.unchanged].map((p) => p.row.shopId))];
  const written = await fetchAll<{ id: string; shop_id: string; shop_key: string | null; exp_date: string | null }>(
    admin, "brand_deals", "id, shop_id, shop_key, exp_date",
    (q) => q.eq("platform", BULK_PLATFORM).is("deactivated_at", null).not("shop_id", "is", null)
  );
  const wanted = new Set(shopIds);
  const keyByShop = new Map<string, string>();
  const dealByShop = new Map<string, { id: string; exp: string | null }>();
  for (const d of written) {
    if (!wanted.has(d.shop_id)) continue;
    if (d.shop_key) keyByShop.set(d.shop_id, d.shop_key);
    const cur = dealByShop.get(d.shop_id);
    // Shop bersama beberapa brand → deal_end = exp_date terjauh.
    if (!cur || (d.exp_date ?? "") > (cur.exp ?? "")) dealByShop.set(d.shop_id, { id: d.id, exp: d.exp_date });
  }
  const today = todayWib();
  const coop = [...dealByShop.entries()]
    .filter(([, d]) => d.exp)
    .map(([shop_id, d]) => ({ platform: BULK_PLATFORM, shop_id, deal_id: d.id, deal_end: d.exp, active_flag: d.exp! >= today }));
  for (let i = 0; i < coop.length; i += 300) {
    // PK cooperating_shops = (platform, shop_id).
    const { error } = await admin.from("cooperating_shops").upsert(coop.slice(i, i + 300), { onConflict: "platform,shop_id" });
    if (error) failed.push({ sheetRow: 0, brandName: "(cooperating_shops)", reason: error.message });
  }

  let handlers = 0;
  for (const h of plan.handlers.filter((x) => x.apply)) {
    const key = keyByShop.get(h.shopId);
    if (!key) continue;
    try {
      const { audit } = await syncShopHandlers(admin, actor.id, key, h.memberIds, "upload");
      if (audit) {
        audits.push(audit);
        handlers++;
      }
    } catch (e) {
      failed.push({ sheetRow: 0, brandName: h.brands.join(" / "), reason: `BizDev handler: ${e instanceof Error ? e.message : e}` });
    }
  }

  // Log run: dibaca halaman Preview (daftar perlu konfirmasi tim tidak tersimpan di brand_deals).
  audits.push({
    actorId: actor.id, action: BULK_RUN_ACTION, entityType: "brand_deals", entityId: null,
    after: { ...toRunLog(plan), saved: { inserted, updated, handlers, failed: failed.length } }, type: "auto",
  });
  await writeAuditBatch(audits);
  revalidatePath("/deals");
  revalidatePath("/deals/import");
  revalidatePath("/deals/import/preview");
  return { ok: true, envRowCount, plan, saved: { inserted, updated, handlers, failed } };
}

/** Export Deal Brand (TikTok, aktif) dengan dua baris header persis sheet sumber. */
export async function exportBulkDeals(): Promise<{ filename: string; base64: string }> {
  await requirePermission("deals.import_legacy");
  const admin = createAdminClient();
  const rows = await fetchAll<Record<string, unknown>>(
    admin, "brand_deals", `${BULK_SELECT_COLS}, team_members!brand_deals_campaign_ops_id_fkey(name)`,
    (q) => q.eq("platform", BULK_PLATFORM).is("deactivated_at", null).order("brand_name")
  );
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const records = rows.map((d): Record<BulkDealColumnKey, string | number | null> => ({
    brandName: s(d.brand_name),
    bizdev: s(d.bizdev_label),
    pipelineStage: "Deal",
    status: d.status ? dealStatusLabel(d.status as string) : null,
    niche: s(d.niche),
    brandLink: s(d.brand_link),
    shopId: s(d.shop_id),
    contactPic: s(d.contact_pic_brand),
    namaGrup: s(d.nama_grup),
    gmvTap: n(d.gmv_tap),
    avgPrice: n(d.avg_price),
    supportTypes: formatSupportTypes(d.support_types as string[] | null) || null,
    adsBrand: s(d.ads_brand),
    leadsType: s(d.leads_type),
    priority: s(d.priority),
    workingSheet: s(d.working_sheet),
    campaignOps: (d.team_members as { name?: string } | null)?.name ?? "Non Campaign Ops",
    campaignName: s(d.campaign_name),
    campaignId: s(d.campaign_id),
    expDate: s(d.exp_date),
    countdown: null, // rumus di sheet, tidak disimpan
    shopCode: s(d.shop_code),
  }));
  const buf = XLSX.write(buildBulkDealWorkbook(records), { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { filename: BULK_DEAL_EXPORT_FILENAME, base64: buf.toString("base64") };
}
