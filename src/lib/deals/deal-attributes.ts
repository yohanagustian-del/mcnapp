import { normalizeDealStatus, type DealStatus } from "@/lib/deals/deal-status";
import { SUPPORT_TYPES, type SupportType } from "@/lib/deals/bulk-deal-spec";

/**
 * Validasi form "Status & Atribut" di detail Deal Brand (migrasi 0097, DECISIONS
 * D-2026-10-20-1..3/7). Murni (tanpa I/O) supaya server action & test memakai aturan
 * yang sama. Daftar pilihan dikirim dari app_config (`loadDealOptions`) — tidak
 * di-hardcode di sini.
 */
export interface DealAttributeInput {
  status: string;
  niche: string;
  /** Diisi bila pengguna memilih "Tambah niche baru". */
  newNiche: string;
  leadsType: string;
  supportTypes: string[];
  priority: string;
  workingSheet: string;
  campaignOpsId: string;
}

export interface DealAttributeRecord {
  status: DealStatus | null;
  niche: string | null;
  leads_type: string | null;
  support_types: SupportType[] | null;
  priority: string | null;
  working_sheet: string | null;
  campaign_ops_id: string | null;
}

export const NEW_NICHE_VALUE = "__new__";

export type DealAttributeResult =
  | { ok: true; record: DealAttributeRecord; addedNiche: string | null }
  | { ok: false; fieldErrors: Record<string, string> };

const clean = (v: string) => v.trim().replace(/\s+/g, " ");

export function validateDealAttributes(
  input: DealAttributeInput,
  opts: {
    nicheOptions: string[];
    leadsOptions: string[];
    campaignOpsIds: Set<string>;
    canAddNiche: boolean;
  }
): DealAttributeResult {
  const fieldErrors: Record<string, string> = {};

  const statusRaw = clean(input.status);
  const status = statusRaw ? normalizeDealStatus(statusRaw) : null;
  if (statusRaw && !status) fieldErrors.status = "Status tidak dikenal";

  let niche: string | null = clean(input.niche) || null;
  let addedNiche: string | null = null;
  if (niche === NEW_NICHE_VALUE) {
    const fresh = clean(input.newNiche);
    if (!opts.canAddNiche) fieldErrors.niche = "Anda tidak berhak menambah niche baru";
    else if (!fresh) fieldErrors.new_niche = "Tulis nama niche baru";
    else if (fresh.length > 60) fieldErrors.new_niche = "Maksimal 60 karakter";
    else {
      // Ejaan yang sama (beda huruf besar/kecil) = niche yang sudah ada, bukan niche baru.
      const existing = opts.nicheOptions.find((n) => n.toLowerCase() === fresh.toLowerCase());
      niche = existing ?? fresh;
      addedNiche = existing ? null : fresh;
    }
  } else if (niche && !opts.nicheOptions.includes(niche)) {
    fieldErrors.niche = "Niche di luar daftar — pilih \"Tambah niche baru\"";
  }

  const leads = clean(input.leadsType) || null;
  if (leads && !opts.leadsOptions.includes(leads)) fieldErrors.leads_type = "Leads di luar daftar";

  const unknownSupport = input.supportTypes.filter((s) => !(SUPPORT_TYPES as readonly string[]).includes(s));
  if (unknownSupport.length) fieldErrors.support_types = `Support tidak dikenal: ${unknownSupport.join(", ")}`;
  // Urutan tetap (sample, flash_sale, ads) = sama dengan parser sheet.
  const support = SUPPORT_TYPES.filter((s) => input.supportTypes.includes(s));

  const opsId = clean(input.campaignOpsId) || null;
  if (opsId && !opts.campaignOpsIds.has(opsId)) fieldErrors.campaign_ops_id = "Bukan anggota Campaign Ops aktif";

  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  return {
    ok: true,
    addedNiche,
    record: {
      status,
      niche,
      leads_type: leads,
      support_types: support.length ? support : null,
      priority: clean(input.priority) || null,
      working_sheet: clean(input.workingSheet) || null,
      campaign_ops_id: opsId,
    },
  };
}

/** Field yang berubah (untuk audit before/after & pesan "tidak ada yang berubah"). */
export function changedAttributes(
  before: Partial<Record<keyof DealAttributeRecord, unknown>>,
  after: DealAttributeRecord
): (keyof DealAttributeRecord)[] {
  const norm = (v: unknown) => JSON.stringify(Array.isArray(v) && v.length === 0 ? null : v ?? null);
  return (Object.keys(after) as (keyof DealAttributeRecord)[]).filter((k) => {
    const b = k === "status" ? normalizeDealStatus((before.status as string | null) ?? null) : before[k];
    return norm(b) !== norm(after[k]);
  });
}

/** Ads support per (project × shop): kosong = hapus pilihan; selain itu wajib dari daftar app_config. */
export function validateAdsSupport(raw: string, options: string[]): { ok: true; value: string | null } | { ok: false; message: string } {
  const v = clean(raw);
  if (!v) return { ok: true, value: null };
  return options.includes(v) ? { ok: true, value: v } : { ok: false, message: `"${v}" bukan pilihan Ads Support` };
}
