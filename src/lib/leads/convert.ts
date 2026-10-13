import type { SupabaseClient } from "@supabase/supabase-js";
import { MANAGEMENT_ROLES, type Role } from "@/lib/rbac-constants";
import type { AuditEntry } from "@/lib/audit";

/**
 * Brand Lead Bank → Deal Brand (REVISI_BIZDEV T8). Satu logika penandaan lead
 * dipakai tombol "Tandai sudah jadi Deal" (markLeadConverted, tempel ID) DAN alur
 * otomatis "Daftarkan jadi Deal Brand" (Registrasi Deal dengan ?lead_id=).
 */

export interface LeadRef {
  id: string;
  created_by: string | null;
  converted_deal_id: string | null;
  status: string;
  notes: string | null;
}

/** Gerbang edit per baris lead (sama dengan assertLeadEditable): pembuat ATAU bizdev_lead/management. */
export function canEditLead(member: { id: string; role: Role }, lead: Pick<LeadRef, "created_by">, hasLeadsEdit: boolean): boolean {
  if (!hasLeadsEdit) return false;
  if ((MANAGEMENT_ROLES as string[]).includes(member.role) || member.role === "bizdev_lead") return true;
  return lead.created_by === member.id;
}

/** Lead yang sudah tertaut ke deal / berstatus deal tidak dikonversi dua kali. */
export function isLeadConverted(lead: Pick<LeadRef, "converted_deal_id" | "status">): boolean {
  return Boolean(lead.converted_deal_id) || lead.status === "deal";
}

export type ConversionTarget =
  | { kind: "deal"; dealId: string }
  /** Jalur kartu produk: tidak ada deal_id — kunci kartu & shop_key dicatat di notes lead. */
  | { kind: "card"; cardKey: string; shopKey: string | null };

/** Teks catatan yang ditambahkan ke lead untuk konversi jalur kartu produk. */
export function conversionNote(target: ConversionTarget, today: string): string | null {
  if (target.kind !== "card") return null;
  return `[${today}] Jadi kartu Produk TAP ${target.cardKey}${target.shopKey ? ` (shop ${target.shopKey})` : ""} lewat Registrasi Deal.`;
}

/**
 * Tandai lead jadi deal: status='deal' + converted_deal_id (jalur deal shop) atau
 * catatan kunci kartu (jalur kartu produk). Service role; mengembalikan entri audit
 * `lead.convert` (type auto) untuk ditulis pemanggil.
 */
export async function applyLeadConversion(
  admin: SupabaseClient,
  actorId: string,
  lead: LeadRef,
  target: ConversionTarget,
  today: string
): Promise<AuditEntry> {
  const note = conversionNote(target, today);
  const patch: Record<string, unknown> = { status: "deal", updated_at: new Date().toISOString() };
  if (target.kind === "deal") patch.converted_deal_id = target.dealId;
  if (note) patch.notes = lead.notes ? `${lead.notes}\n${note}` : note;
  const { error } = await admin.from("brand_leads").update(patch).eq("id", lead.id);
  if (error) throw new Error(`Gagal menandai lead: ${error.message}`);
  return {
    actorId,
    action: "lead.convert",
    entityType: "brand_leads",
    entityId: lead.id,
    before: { status: lead.status, converted_deal_id: lead.converted_deal_id },
    after:
      target.kind === "deal"
        ? { converted_deal_id: target.dealId, status: "deal" }
        : { status: "deal", card: target.cardKey, shop_key: target.shopKey },
    type: "auto",
  };
}

/** Isian Registrasi Deal yang diturunkan dari lead (prefill, Q: tanpa isi ulang). */
export interface LeadDealDefaults {
  leadId: string;
  shopName: string | null;
  platform: "tiktok" | "shopee" | null;
  dealBy: string | null;
  bizdevHandlerIds: string[];
  contactPic: string | null;
  storeLink: string | null;
}

/** platforms lead ('shopee' | 'tiktok_shop') → platform deal, hanya bila tepat satu. */
export function leadPlatform(platforms: string[] | null | undefined): "tiktok" | "shopee" | null {
  const p = platforms ?? [];
  if (p.length !== 1) return null;
  return p[0] === "shopee" ? "shopee" : p[0] === "tiktok_shop" ? "tiktok" : null;
}

/**
 * `bizdev_names` lead (teks bebas, mis. "Rina, Budi" / "rina & budi") → id anggota
 * BizDev yang namanya cocok persis (tidak peka huruf besar/kecil), maks 2. Nama yang
 * tidak cocok dibiarkan (tidak ditebak).
 */
export function matchBizdevNames(raw: string | null | undefined, members: { id: string; name: string }[]): string[] {
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m.id]));
  const ids: string[] = [];
  for (const part of (raw ?? "").split(/[,;/&\n]|\bdan\b/i)) {
    const id = byName.get(part.trim().toLowerCase());
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length === 2) break;
  }
  return ids;
}

/** Kontak PIC lead → satu baris teks untuk brand_deals.contact_pic_brand. */
export function formatLeadContacts(contacts: { lead_name: string | null; phone: string | null; email: string | null }[]): string | null {
  const parts = contacts
    .map((c) => [c.lead_name, c.phone, c.email].filter((v) => v && v.trim()).join(" · "))
    .filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/**
 * Registrasi Deal yang dibuka dari lead (`?lead_id=`): setelah deal/kartu tersimpan,
 * tandai lead-nya. Tidak pernah menggagalkan registrasi — deal sudah tersimpan;
 * hambatan (bukan pemilik lead, lead sudah terkonversi, lead hilang) dikembalikan
 * sebagai catatan untuk pesan sukses, dan form "Tandai sudah jadi Deal" tetap bisa
 * dipakai belakangan.
 */
export async function convertLeadOnRegister(
  admin: SupabaseClient,
  member: { id: string; role: Role },
  hasLeadsEdit: boolean,
  leadId: string,
  target: ConversionTarget,
  today: string
): Promise<{ note: string | null; audit: AuditEntry | null }> {
  try {
    const { data: lead, error } = await admin
      .from("brand_leads")
      .select("id, created_by, converted_deal_id, status, notes")
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!lead) return { note: `Lead ${leadId} tidak ditemukan — tidak ada lead yang ditandai.`, audit: null };
    const ref = lead as LeadRef;
    if (!canEditLead(member, ref, hasLeadsEdit)) {
      return { note: `Lead ${leadId} tidak ditandai: hanya pembuat lead atau bizdev_lead/management yang boleh.`, audit: null };
    }
    if (isLeadConverted(ref)) {
      return { note: `Lead ${leadId} sudah berstatus deal${ref.converted_deal_id ? ` (${ref.converted_deal_id})` : ""} — tidak diubah.`, audit: null };
    }
    const audit = await applyLeadConversion(admin, member.id, ref, target, today);
    return { note: `Lead ${leadId} ditandai jadi deal.`, audit };
  } catch (e) {
    return { note: `Lead gagal ditandai: ${e instanceof Error ? e.message : String(e)}`, audit: null };
  }
}

/** Platform deal dari form: hanya dua nilai yang dikenal, selain itu = default kolom (tiktok). */
export function parseDealPlatform(raw: FormDataEntryValue | null): "tiktok" | "shopee" | null {
  const v = String(raw ?? "").trim();
  return v === "tiktok" || v === "shopee" ? v : null;
}
