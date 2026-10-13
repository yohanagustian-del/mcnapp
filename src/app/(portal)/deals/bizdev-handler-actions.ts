"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit, writeAuditBatch, type AuditEntry } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseSheet } from "@/lib/utils/sheet";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import {
  BIZDEV_HANDLER_REQUIRED_HEADERS,
  BIZDEV_HANDLER_TEMPLATE_FILENAME,
  buildBizdevHandlerRows,
  buildBizdevHandlerTemplate,
  validateHandlerIds,
} from "@/lib/deals/bizdev-handler-spec";
import { loadBizdevMembers, syncShopHandlers } from "@/lib/deals/bizdev-handlers";

export interface BizdevHandlerFormState {
  ok: boolean;
  message: string;
}

/**
 * Tombol "BizDev" per baris tabel Shop (tab Deal Brand): tulis keadaan akhir (maks 2)
 * handler satu brand. Izin deals.edit (Q1); anggota yang dipilih wajib aktif ber-role
 * BizDev — divalidasi ulang di server, bukan cuma dropdown.
 */
export async function setBrandBizdevHandlers(
  _prev: BizdevHandlerFormState | null,
  formData: FormData
): Promise<BizdevHandlerFormState> {
  const actor = await requirePermission("deals.edit");
  const shopKey = String(formData.get("shop_key") ?? "").trim();
  if (!shopKey) return { ok: false, message: "Shop tidak dikenali." };
  const ids = formData.getAll("member_id").map((v) => String(v).trim()).filter(Boolean);
  const invalid = validateHandlerIds(ids);
  if (invalid) return { ok: false, message: invalid };

  const admin = createAdminClient();
  const members = await loadBizdevMembers(admin);
  const allowed = new Set(members.map((m) => m.id));
  if (ids.some((id) => !allowed.has(id))) {
    return { ok: false, message: "Hanya anggota tim aktif ber-role BizDev yang bisa ditugaskan." };
  }

  try {
    const { audit } = await syncShopHandlers(admin, actor.id, shopKey, ids, "row_edit");
    if (audit) await writeAudit(audit);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal menyimpan BizDev." };
  }
  revalidatePath("/deals");
  revalidatePath("/workspace/bizdev");
  return { ok: true, message: ids.length ? "BizDev brand disimpan." : "Brand kini Non BD Handle." };
}

/** Template .xlsx (base64) — pola downloadPartnershipTemplate. */
export async function downloadBizdevHandlerTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("deals.edit");
  return {
    filename: BIZDEV_HANDLER_TEMPLATE_FILENAME,
    base64: Buffer.from(buildBizdevHandlerTemplate()).toString("base64"),
  };
}

export interface BizdevHandlerUploadReport {
  totalRows: number;
  /** Brand yang assignment-nya berubah. */
  changed: number;
  unchanged: number;
  /** Baris tanpa nama BizDev = tidak mengubah apa pun. */
  blank: number;
  /** Shop yang tidak ditemukan — dilewati, tidak dibuat baru. */
  unknownShops: string[];
  /** Nama BizDev yang tidak dikenal — baris dilewati. */
  unknownNames: string[];
  rowNotes: { rowNumber: number; message: string }[];
}

type ShopRef = { shop_key: string; shop_id: string | null; shop_name: string | null };

/**
 * Upload Excel massal BizDev handler (Q1). Shop dicocokkan lewat Shop ID dulu lalu
 * Shop Name terhadap baris view deal_shop_summary (shop_key dihasilkan SQL — ekspresinya
 * tidak disalin ke aplikasi, CLAUDE.md #4). Shop tak ditemukan / nama BizDev tak dikenal
 * → baris DILEWATI + peringatan (pola uploadPartnershipStatus). Nama yang diisi = keadaan
 * akhir brand itu; kedua sel kosong = tidak mengubah.
 */
export async function uploadBrandBizdevHandlers(formData: FormData): Promise<BizdevHandlerUploadReport> {
  const actor = await requirePermission("deals.edit");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Excel terlebih dahulu.");

  const { rows: sheetRows, errors } = await parseSheet(file, BIZDEV_HANDLER_REQUIRED_HEADERS);
  if (errors.length) throw new Error(errors.join("; "));
  const parsed = buildBizdevHandlerRows(sheetRows);
  if (parsed.length === 0) throw new Error("File tidak berisi baris data.");

  const admin = createAdminClient();
  const probe = await admin.from("brand_bizdev_handlers").select("shop_key").limit(1);
  if (probe.error && isMissingRelationError(probe.error)) throw new Error(MIGRATION_0087_MISSING);

  const shops = await fetchAll<ShopRef>(admin, "deal_shop_summary", "shop_key, shop_id, shop_name", (q) => q);
  const byShopId = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  for (const s of shops) {
    const id = s.shop_id?.trim();
    if (id) byShopId.set(id, [...(byShopId.get(id) ?? []), s.shop_key]);
    const name = s.shop_name?.trim().toLowerCase();
    if (name) byName.set(name, [...(byName.get(name) ?? []), s.shop_key]);
  }
  const members = await loadBizdevMembers(admin);
  const memberByName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m.id]));

  const report: BizdevHandlerUploadReport = {
    totalRows: parsed.length, changed: 0, unchanged: 0, blank: 0,
    unknownShops: [], unknownNames: [], rowNotes: [],
  };
  const audits: AuditEntry[] = [];
  const done = new Set<string>();

  for (const row of parsed) {
    if (row.error) {
      report.rowNotes.push({ rowNumber: row.rowNumber, message: row.error });
      continue;
    }
    if (row.names.length === 0) {
      report.blank++;
      continue;
    }
    const keys =
      (row.shopId ? byShopId.get(row.shopId) : undefined) ??
      (row.shopName ? byName.get(row.shopName.toLowerCase()) : undefined);
    const label = row.shopName ?? row.shopId ?? "?";
    if (!keys || keys.length === 0) {
      report.unknownShops.push(label);
      continue;
    }
    const ids: string[] = [];
    const unknown: string[] = [];
    for (const n of row.names) {
      const id = memberByName.get(n.toLowerCase());
      if (id) ids.push(id);
      else unknown.push(n);
    }
    if (unknown.length > 0) {
      report.unknownNames.push(...unknown.filter((n) => !report.unknownNames.includes(n)));
      report.rowNotes.push({ rowNumber: row.rowNumber, message: `BizDev tidak dikenal: ${unknown.join(", ")} — baris dilewati.` });
      continue;
    }
    const invalid = validateHandlerIds(ids);
    if (invalid) {
      report.rowNotes.push({ rowNumber: row.rowNumber, message: invalid });
      continue;
    }
    for (const shopKey of keys) {
      if (done.has(shopKey)) {
        report.rowNotes.push({ rowNumber: row.rowNumber, message: `Shop "${label}" muncul lebih dari sekali — baris pertama yang dipakai.` });
        continue;
      }
      done.add(shopKey);
      try {
        const { audit } = await syncShopHandlers(admin, actor.id, shopKey, ids, "upload");
        if (audit) {
          audits.push(audit);
          report.changed++;
        } else {
          report.unchanged++;
        }
      } catch (e) {
        report.rowNotes.push({ rowNumber: row.rowNumber, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  await writeAuditBatch(audits);
  await writeAudit({
    actorId: actor.id,
    action: "deals.bizdev_handler_upload",
    entityType: "brand_bizdev_handlers",
    entityId: file.name,
    after: {
      total_rows: report.totalRows, changed: report.changed, unchanged: report.unchanged,
      blank: report.blank, unknown_shops: report.unknownShops.length, unknown_names: report.unknownNames.length,
    },
    type: "auto",
  });
  revalidatePath("/deals");
  revalidatePath("/workspace/bizdev");
  return report;
}
