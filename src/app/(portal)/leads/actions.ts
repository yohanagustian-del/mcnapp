"use server";

import { revalidatePath } from "next/cache";
import { requireMember, requirePermission, hasPermission, MANAGEMENT_ROLES } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { genId } from "@/lib/utils/id";
import {
  brandLeadSchema,
  isEmptyBrandLeadContact,
  type BrandLeadContactInput,
  type BrandLeadInput,
} from "@/lib/leads/brand-lead";

export interface LeadFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

const MAX_CONTACT_ROWS = 5;

/** Baris-berulang "Data Prospek" — field terindeks contact_{field}_{i}, i=0..4. */
function readContacts(formData: FormData): BrandLeadContactInput[] {
  const contacts: BrandLeadContactInput[] = [];
  for (let i = 0; i < MAX_CONTACT_ROWS; i++) {
    const row = {
      lead_name: String(formData.get(`contact_name_${i}`) ?? "").trim() || undefined,
      phone: String(formData.get(`contact_phone_${i}`) ?? "").trim() || undefined,
      email: String(formData.get(`contact_email_${i}`) ?? "").trim() || undefined,
    };
    if (!isEmptyBrandLeadContact(row)) contacts.push(row);
  }
  return contacts;
}

function readFormInput(formData: FormData): Record<string, unknown> {
  return {
    source: String(formData.get("source") ?? "").trim() || undefined,
    source_other: String(formData.get("source_other") ?? "").trim() || undefined,
    shop_name: String(formData.get("shop_name") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    business_category: String(formData.get("business_category") ?? "").trim() || undefined,
    store_link: String(formData.get("store_link") ?? "").trim() || undefined,
    platforms: formData.getAll("platforms").map(String),
    marketing_budget: formData.get("marketing_budget"),
    target_roas: formData.get("target_roas"),
    brand_support: formData.getAll("brand_support").map(String),
    status: String(formData.get("status") ?? "").trim() || undefined,
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    contacts: readContacts(formData),
  };
}

function toFieldErrors(issues: { path: (string | number)[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0] ?? "form")] = issue.message;
  return out;
}

export async function createLead(_prev: LeadFormState | null, formData: FormData): Promise<LeadFormState> {
  const actor = await requirePermission("leads.create");

  const parsed = brandLeadSchema.safeParse(readFormInput(formData));
  if (!parsed.success) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  const d: BrandLeadInput = parsed.data;

  const admin = createAdminClient();

  let leadId = "";
  let lastError = "";
  for (let attempt = 0; attempt < 3 && !leadId; attempt++) {
    const id = genId("LEAD");
    const { error } = await admin.from("brand_leads").insert({
      id,
      source: d.source,
      source_other: d.source_other ?? null,
      shop_name: d.shop_name ?? null,
      city: d.city ?? null,
      business_category: d.business_category ?? null,
      store_link: d.store_link ?? null,
      platforms: d.platforms,
      marketing_budget: d.marketing_budget ?? null,
      target_roas: d.target_roas ?? null,
      brand_support: d.brand_support,
      status: d.status,
      notes: d.notes ?? null,
      created_by: actor.id,
    });
    if (!error) leadId = id;
    else if (error.code === "23505") lastError = error.message;
    else return { ok: false, message: `Gagal menyimpan lead: ${error.message}` };
  }
  if (!leadId) return { ok: false, message: `Gagal membuat ID lead unik: ${lastError}` };

  if (d.contacts.length > 0) {
    const { error: contactError } = await admin.from("brand_lead_contacts").insert(
      d.contacts.map((c, i) => ({
        lead_id: leadId,
        lead_name: c.lead_name ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        sort_order: i,
      }))
    );
    if (contactError) {
      return { ok: false, message: `Lead tersimpan tapi kontak gagal disimpan: ${contactError.message}` };
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: "lead.create",
    entityType: "brand_leads",
    entityId: leadId,
    after: { source: d.source, shop_name: d.shop_name, contacts: d.contacts.length },
    type: "auto",
  });

  revalidatePath("/leads");
  return { ok: true, message: `Lead ${leadId} tersimpan.` };
}

async function assertLeadEditable(leadId: string): Promise<{ actorId: string }> {
  const member = await requireMember();
  if (!hasPermission("leads.edit", member.role)) {
    throw new Error("Akses ditolak: role Anda tidak punya izin mengubah lead.");
  }
  if ((MANAGEMENT_ROLES as string[]).includes(member.role) || member.role === "bizdev_lead") {
    return { actorId: member.id };
  }
  // bizdev biasa: hanya pembuat lead sendiri.
  const admin = createAdminClient();
  const { data: lead, error } = await admin.from("brand_leads").select("created_by").eq("id", leadId).maybeSingle();
  if (error) throw new Error(`Gagal memeriksa lead: ${error.message}`);
  if (!lead) throw new Error("Lead tidak ditemukan.");
  if (lead.created_by !== member.id) {
    throw new Error("Akses ditolak: Anda bukan pembuat lead ini — hanya bizdev_lead/management yang boleh mengubah lead milik BD lain.");
  }
  return { actorId: member.id };
}

export async function updateLead(leadId: string, _prev: LeadFormState | null, formData: FormData): Promise<LeadFormState> {
  const { actorId } = await assertLeadEditable(leadId);

  const parsed = brandLeadSchema.safeParse(readFormInput(formData));
  if (!parsed.success) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  const d: BrandLeadInput = parsed.data;
  const admin = createAdminClient();

  const { error } = await admin
    .from("brand_leads")
    .update({
      source: d.source,
      source_other: d.source_other ?? null,
      shop_name: d.shop_name ?? null,
      city: d.city ?? null,
      business_category: d.business_category ?? null,
      store_link: d.store_link ?? null,
      platforms: d.platforms,
      marketing_budget: d.marketing_budget ?? null,
      target_roas: d.target_roas ?? null,
      brand_support: d.brand_support,
      status: d.status,
      notes: d.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  // Kontak ditulis ulang utuh (form mengirim keadaan akhir) — pola sama daftar
  // shop/produk Project BD (CLAUDE.md).
  const { error: delError } = await admin.from("brand_lead_contacts").delete().eq("lead_id", leadId);
  if (delError) return { ok: false, message: `Gagal memperbarui kontak: ${delError.message}` };
  if (d.contacts.length > 0) {
    const { error: insError } = await admin.from("brand_lead_contacts").insert(
      d.contacts.map((c, i) => ({
        lead_id: leadId,
        lead_name: c.lead_name ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        sort_order: i,
      }))
    );
    if (insError) return { ok: false, message: `Gagal menyimpan kontak: ${insError.message}` };
  }

  await writeAudit({
    actorId,
    action: "lead.update",
    entityType: "brand_leads",
    entityId: leadId,
    after: { source: d.source, status: d.status, shop_name: d.shop_name },
    type: "auto",
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: "Perubahan tersimpan." };
}

/**
 * Tombol "Tandai sudah jadi Deal" di detail lead — dipakai setelah BD membuat
 * deal-nya lewat /deals/baru (halaman itu tidak diubah supaya alur registrasi
 * deal yang sudah divalidasi ketat tidak ikut tersentuh). BD menempelkan ID
 * deal yang baru dibuat (format DEAL-xxxxx) di sini.
 */
export async function markLeadConverted(leadId: string, dealId: string): Promise<LeadFormState> {
  const { actorId } = await assertLeadEditable(leadId);
  const trimmedDealId = dealId.trim();
  if (!trimmedDealId) return { ok: false, message: "ID deal wajib diisi." };

  const admin = createAdminClient();
  const { data: deal, error: dealError } = await admin
    .from("brand_deals")
    .select("id, brand_name")
    .eq("id", trimmedDealId)
    .maybeSingle();
  if (dealError) return { ok: false, message: `Gagal memeriksa deal: ${dealError.message}` };
  if (!deal) return { ok: false, message: `Deal ${trimmedDealId} tidak ditemukan di tab Deal Brand.` };

  const { error } = await admin
    .from("brand_leads")
    .update({ converted_deal_id: trimmedDealId, status: "deal", updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) return { ok: false, message: `Gagal menandai lead: ${error.message}` };

  await writeAudit({
    actorId,
    action: "lead.convert",
    entityType: "brand_leads",
    entityId: leadId,
    after: { converted_deal_id: trimmedDealId },
    type: "auto",
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
  return { ok: true, message: `Lead ditandai sebagai deal ${deal.brand_name} (${trimmedDealId}).` };
}
