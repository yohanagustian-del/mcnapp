"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, fetchAllIn } from "@/lib/supabase/fetch-all";
import { writeAuditBatch, type AuditEntry } from "@/lib/audit";
import { genId } from "@/lib/utils/id";
import { parseSheet } from "@/lib/utils/sheet";
import { BRAND_LEAD_SOURCES, type BrandLeadContactInput, type BrandLeadInput, type BrandLeadSource } from "@/lib/leads/brand-lead";
import {
  BRAND_LEAD_HEADER_PROBE,
  brandLeadKey,
  buildBrandLeadUploadRows,
  isEmptyMerge,
  mergeBrandLead,
  type BrandLeadMerge,
} from "@/lib/leads/bulk-upload-spec";
import { buildBrandLeadTemplate, BRAND_LEAD_TEMPLATE_FILENAME } from "@/lib/leads/bulk-upload-template";

/** Template .xlsx as base64 (same download pattern as downloadPartnershipTemplate). */
export async function downloadBrandLeadTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("leads.create");
  return { filename: BRAND_LEAD_TEMPLATE_FILENAME, base64: Buffer.from(buildBrandLeadTemplate()).toString("base64") };
}

export interface BrandLeadUploadReport {
  /** Data rows read from the file (blank rows excluded). */
  totalRows: number;
  created: number;
  /** Existing leads (or earlier rows of this file) that received new contacts/columns. */
  merged: number;
  /** Rows of a brand that is already in the bank with nothing new to add. */
  unchanged: number;
  skipped: number;
  contactsAdded: number;
  rowNotes: { rows: string; brand: string; message: string }[];
}

type ExistingLead = {
  id: string;
  shop_name: string | null;
  bizdev_names: string | null;
  business_category: string | null;
  store_link: string | null;
  brand_group: string | null;
  ads_scheme: string | null;
  city: string | null;
  notes: string | null;
  platforms: string[] | null;
  brand_support: string[] | null;
  created_at: string;
};
type ExistingContact = { lead_id: string; lead_name: string | null; phone: string | null; email: string | null; sort_order: number };

const INSERT_CHUNK = 200;

/**
 * Upload massal Brand Lead Bank (request user 2026-10-01): one spreadsheet of
 * matchmaking leads → brand_leads + brand_lead_contacts. Every row is validated by
 * the form's own schema (brandLeadSchema via buildBrandLeadUploadRows).
 *
 * A brand already in the bank (same brandLeadKey) is NOT created twice: the row
 * is merged additively (empty columns filled, new contacts appended, nothing
 * overwritten, source/status untouched), so re-uploading the same file is a no-op
 * and old brands pick up new PICs. Audit (CLAUDE.md #2): one `auto` entry per
 * created or merged lead.
 */
export async function uploadBrandLeads(formData: FormData): Promise<BrandLeadUploadReport> {
  const actor = await requirePermission("leads.create");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Pilih file Excel/CSV terlebih dahulu.");
  const source = String(formData.get("source") ?? "");
  if (!(BRAND_LEAD_SOURCES as readonly string[]).includes(source)) throw new Error("Pilih Asal Lead untuk file ini.");

  const { rows: sheetRows, errors, skippedRows } = await parseSheet(file, BRAND_LEAD_HEADER_PROBE);
  if (errors.length) throw new Error(errors.join("; "));
  const parsed = buildBrandLeadUploadRows(sheetRows, source as BrandLeadSource, (skippedRows ?? 0) + 1);
  if (parsed.length === 0) throw new Error("File tidak berisi baris data.");

  const report: BrandLeadUploadReport = {
    totalRows: parsed.reduce((n, p) => n + p.rowNumbers.length, 0),
    created: 0,
    merged: 0,
    unchanged: 0,
    skipped: 0,
    contactsAdded: 0,
    rowNotes: [],
  };
  const note = (rowNumbers: number[], brand: string, message: string) =>
    report.rowNotes.push({ rows: rowNumbers.join(", "), brand, message });

  const valid: { lead: BrandLeadInput; key: string | null; rowNumbers: number[] }[] = [];
  for (const p of parsed) {
    p.issues.forEach((issue) => note(p.rowNumbers, p.shopName, issue));
    if (p.rowNumbers.length > 1) note(p.rowNumbers, p.shopName, "Brand yang sama muncul di beberapa baris — digabung jadi satu lead");
    if (p.error || !p.lead) {
      report.skipped += p.rowNumbers.length;
      note(p.rowNumbers, p.shopName, p.error ?? "Baris tidak valid");
      continue;
    }
    valid.push({ lead: p.lead, key: p.key, rowNumbers: p.rowNumbers });
  }

  const admin = createAdminClient();

  // Existing leads by brand key — the oldest lead wins when the bank already holds duplicates.
  const existingLeads = await fetchAll<ExistingLead>(
    admin,
    "brand_leads",
    "id, shop_name, bizdev_names, business_category, store_link, brand_group, ads_scheme, city, notes, platforms, brand_support, created_at",
    (q) => q.not("shop_name", "is", null).order("created_at", { ascending: true })
  );
  const existingByKey = new Map<string, ExistingLead>();
  for (const l of existingLeads) {
    const k = brandLeadKey(l.shop_name);
    if (k && !existingByKey.has(k)) existingByKey.set(k, l);
  }

  const toCreate: typeof valid = [];
  const toMerge: { existing: ExistingLead; row: (typeof valid)[number] }[] = [];
  for (const v of valid) {
    const existing = v.key ? existingByKey.get(v.key) : undefined;
    if (existing) toMerge.push({ existing, row: v });
    else toCreate.push(v);
  }

  const contactsByLead = new Map<string, ExistingContact[]>();
  if (toMerge.length) {
    const contacts = await fetchAllIn<ExistingContact>(
      admin,
      "brand_lead_contacts",
      "lead_id, lead_name, phone, email, sort_order",
      "lead_id",
      toMerge.map((m) => m.existing.id)
    );
    for (const c of contacts) contactsByLead.set(c.lead_id, [...(contactsByLead.get(c.lead_id) ?? []), c]);
  }

  const audit: AuditEntry[] = [];
  const newContacts: { lead_id: string; lead_name: string | null; phone: string | null; email: string | null; sort_order: number }[] = [];
  const contactRows = (leadId: string, contacts: BrandLeadContactInput[], offset: number) =>
    contacts.map((c, i) => ({
      lead_id: leadId,
      lead_name: c.lead_name ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      sort_order: offset + i,
    }));

  // ---- merges into existing leads (additive only)
  for (const { existing, row } of toMerge) {
    const current = contactsByLead.get(existing.id) ?? [];
    const merge: BrandLeadMerge = mergeBrandLead(
      {
        ...existing,
        platforms: existing.platforms ?? [],
        brand_support: existing.brand_support ?? [],
        contacts: current.map((c) => ({ lead_name: c.lead_name ?? undefined, phone: c.phone ?? undefined, email: c.email ?? undefined })),
      },
      row.lead
    );
    if (isEmptyMerge(merge)) {
      report.unchanged += row.rowNumbers.length;
      note(row.rowNumbers, row.lead.shop_name ?? "", `Sudah ada di Brand Lead Bank (${existing.id}) — tidak ada data baru`);
      continue;
    }
    if (Object.keys(merge.patch).length) {
      const { error } = await admin
        .from("brand_leads")
        .update({ ...merge.patch, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw new Error(`Gagal memperbarui lead ${existing.id}: ${error.message}`);
    }
    const nextOrder = current.reduce((max, c) => Math.max(max, c.sort_order + 1), 0);
    newContacts.push(...contactRows(existing.id, merge.addContacts, nextOrder));
    report.merged++;
    report.contactsAdded += merge.addContacts.length;
    note(
      row.rowNumbers,
      row.lead.shop_name ?? "",
      `Sudah ada (${existing.id}) — ditambahkan ${merge.addContacts.length} kontak` +
        (Object.keys(merge.patch).length ? ` + kolom kosong: ${Object.keys(merge.patch).join(", ")}` : "")
    );
    audit.push({
      actorId: actor.id,
      action: "lead.bulk_merge",
      entityType: "brand_leads",
      entityId: existing.id,
      before: Object.fromEntries(Object.keys(merge.patch).map((k) => [k, existing[k as keyof ExistingLead] ?? null])),
      after: { ...merge.patch, contacts_added: merge.addContacts.length, file: file.name },
      type: "auto",
    });
  }

  // ---- new leads, in chunks; a chunk that hits an ID collision is retried with fresh IDs
  for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
    const chunk = toCreate.slice(i, i + INSERT_CHUNK);
    let ids: string[] = [];
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !ids.length; attempt++) {
      const attemptIds = chunk.map(() => genId("LEAD"));
      if (new Set(attemptIds).size !== attemptIds.length) continue;
      const { error } = await admin.from("brand_leads").insert(
        chunk.map(({ lead: d }, j) => ({
          id: attemptIds[j],
          source: d.source,
          source_other: d.source_other ?? null,
          shop_name: d.shop_name ?? null,
          city: d.city ?? null,
          business_category: d.business_category ?? null,
          store_link: d.store_link ?? null,
          bizdev_names: d.bizdev_names ?? null,
          brand_group: d.brand_group ?? null,
          ads_scheme: d.ads_scheme ?? null,
          platforms: d.platforms,
          marketing_budget: d.marketing_budget ?? null,
          target_roas: d.target_roas ?? null,
          brand_support: d.brand_support,
          status: d.status,
          notes: d.notes ?? null,
          created_by: actor.id,
        }))
      );
      if (!error) ids = attemptIds;
      else if (error.code === "23505") lastError = error.message;
      else throw new Error(`Gagal menyimpan lead: ${error.message}`);
    }
    if (!ids.length) throw new Error(`Gagal membuat ID lead unik: ${lastError}`);

    chunk.forEach(({ lead: d }, j) => {
      newContacts.push(...contactRows(ids[j], d.contacts, 0));
      report.contactsAdded += d.contacts.length;
      audit.push({
        actorId: actor.id,
        action: "lead.bulk_create",
        entityType: "brand_leads",
        entityId: ids[j],
        after: { source: d.source, shop_name: d.shop_name, contacts: d.contacts.length, file: file.name },
        type: "auto",
      });
    });
    report.created += chunk.length;
  }

  for (let i = 0; i < newContacts.length; i += INSERT_CHUNK) {
    const { error } = await admin.from("brand_lead_contacts").insert(newContacts.slice(i, i + INSERT_CHUNK));
    if (error) throw new Error(`Lead tersimpan tapi sebagian kontak gagal disimpan: ${error.message}`);
  }

  if (audit.length) await writeAuditBatch(audit);
  revalidatePath("/leads");
  return report;
}
