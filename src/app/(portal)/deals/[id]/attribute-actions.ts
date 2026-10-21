"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { hasPermission, requirePermission } from "@/lib/rbac";
import { loadDealOptions } from "@/lib/deals/deal-options";
import { changedAttributes, validateDealAttributes } from "@/lib/deals/deal-attributes";
import { writeWithDealStatusFallback } from "@/lib/deals/deal-status";
import { isMissingRelationError, MIGRATION_0097_MISSING } from "@/lib/db/missing-migration";

export interface AttributeFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

const ATTR_COLS = "id, status, niche, leads_type, support_types, priority, working_sheet, campaign_ops_id";

/**
 * Simpan "Status & Atribut" satu Deal Brand (status, niche, leads, support, prioritas,
 * working sheet, Campaign Ops — kolom sheet bulk load 0097). Ads Brand TIDAK di sini:
 * kolomnya read-only, ads support diatur per shop di Project BD (D-2026-10-20-2).
 * "Tambah niche baru" (izin deals.niche_manage) menambah pilihan ke app_config
 * m8.niche_options — tercatat di audit_logs.
 */
export async function updateDealAttributes(
  _prev: AttributeFormState | null,
  formData: FormData
): Promise<AttributeFormState> {
  const actor = await requirePermission("deals.edit");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return { ok: false, message: "Deal tidak dikenali." };

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: before, error: readError } = await supabase
    .from("brand_deals")
    .select(ATTR_COLS)
    .eq("id", dealId)
    .maybeSingle();
  if (isMissingRelationError(readError)) return { ok: false, message: MIGRATION_0097_MISSING };
  if (readError) return { ok: false, message: `Gagal membaca deal: ${readError.message}` };
  if (!before) return { ok: false, message: `Deal ${dealId} tidak ditemukan.` };

  const [options, { data: ops }] = await Promise.all([
    loadDealOptions(admin),
    admin.from("team_members").select("id").eq("role", "campaign_ops").eq("active", true),
  ]);
  // Campaign Ops yang sudah tercatat tetap sah walau akunnya kini nonaktif (tidak dipaksa diganti).
  const opsIds = new Set([...(ops ?? []).map((m) => m.id as string), ...(before.campaign_ops_id ? [before.campaign_ops_id as string] : [])]);
  // Niche lama di luar daftar (mis. hasil sheet sebelum dirapikan) tetap boleh dipertahankan.
  const nicheOptions = before.niche ? [...options.niche, before.niche as string] : options.niche;

  const result = validateDealAttributes(
    {
      status: String(formData.get("status") ?? ""),
      niche: String(formData.get("niche") ?? ""),
      newNiche: String(formData.get("new_niche") ?? ""),
      leadsType: String(formData.get("leads_type") ?? ""),
      supportTypes: formData.getAll("support_types").map(String),
      priority: String(formData.get("priority") ?? ""),
      workingSheet: String(formData.get("working_sheet") ?? ""),
      campaignOpsId: String(formData.get("campaign_ops_id") ?? ""),
    },
    {
      nicheOptions,
      leadsOptions: before.leads_type ? [...options.leadsType, before.leads_type as string] : options.leadsType,
      campaignOpsIds: opsIds,
      canAddNiche: hasPermission("deals.niche_manage", actor.role),
    }
  );
  if (!result.ok) return { ok: false, message: "Periksa kembali isian.", fieldErrors: result.fieldErrors };

  const changed = changedAttributes(before, result.record);
  if (!changed.length && !result.addedNiche) return { ok: true, message: "Tidak ada yang berubah." };

  if (result.addedNiche) {
    const next = [...options.niche, result.addedNiche];
    const { error } = await admin.from("app_config").upsert({ key: "m8.niche_options", value: next }, { onConflict: "key" });
    if (error) return { ok: false, message: `Gagal menambah niche: ${error.message}` };
    await writeAudit({
      actorId: actor.id, action: "app_config.niche_add", entityType: "app_config", entityId: "m8.niche_options",
      before: { value: options.niche }, after: { value: next, added: result.addedNiche }, type: "auto",
    });
  }

  if (changed.length) {
    const patch = Object.fromEntries(changed.map((k) => [k, result.record[k]]));
    // Lewat client user-scoped: RLS deals_update yang menentukan boleh/tidak.
    const { error } = await writeWithDealStatusFallback(patch, (rec) =>
      supabase.from("brand_deals").update(rec).eq("id", dealId)
    );
    if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };
    await writeAudit({
      actorId: actor.id, action: "brand_deal.attributes_update", entityType: "brand_deals", entityId: dealId,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: patch, type: "auto",
    });
  }

  revalidatePath("/deals");
  revalidatePath(`/deals/${dealId}`);
  return {
    ok: true,
    message: `Tersimpan${changed.length ? `: ${changed.join(", ")}` : ""}${result.addedNiche ? `. Niche baru "${result.addedNiche}" ditambahkan ke daftar` : ""}.`,
  };
}
