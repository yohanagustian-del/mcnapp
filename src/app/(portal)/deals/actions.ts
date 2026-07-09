"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { isSummaryRow } from "@/lib/utils/csv";
import { parseSheet } from "@/lib/utils/sheet";
import { parseRupiah } from "@/lib/utils/rupiah";
import { parseCommission } from "@/lib/utils/commission";
import { parseFlexibleDate } from "@/lib/utils/date";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/**
 * Deal Registration Form schema (CLAUDE.md #6 — strict validation, no dirty data):
 * shop_id numeric & unique; exp_date from date picker; komisi = clean numbers
 * (range handled as separate min/max); Rupiah fields = pure numbers.
 */
const dealFormSchema = z.object({
  brand_name: z.string().min(1, "Nama brand wajib (sesuai display platform)"),
  shop_id: z.string().regex(/^\d+$/, "Shop ID harus angka"),
  niche: z.string().min(1, "Niche wajib diisi"),
  exp_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Exp date wajib dari date picker"),
  komisi_kreator_min: z.coerce.number().min(0).max(100),
  komisi_kreator_max: z.coerce.number().min(0).max(100).optional(),
  komisi_mea_min: z.coerce.number().min(0).max(100),
  komisi_mea_max: z.coerce.number().min(0).max(100).optional(),
  pic_tap: z.string().uuid("PIC TAP wajib dipilih"),
  campaign_name: z.string().min(1, "Campaign name wajib diisi"),
  brand_link: z.string().url().optional().or(z.literal("")),
  gmv_tap: z.coerce.number().nonnegative().optional(),
  avg_price: z.coerce.number().nonnegative().optional(),
  ads_budget: z.coerce.number().nonnegative().optional(),
  service_fee: z.coerce.number().nonnegative().optional(),
  // Campaign sample & komisi extra = non-berbayar (QA feedback BizDev)
  campaign_type: z.enum(["paid", "sample", "extra_commission"]).default("paid"),
  notes: z.string().optional(),
});

export interface DealFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

export async function registerDeal(
  _prev: DealFormState | null,
  formData: FormData
): Promise<DealFormState> {
  const actor = await requirePermission("deals.register");

  const parsed = dealFormSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const d = parsed.data;

  if (d.komisi_kreator_max != null && d.komisi_kreator_max < d.komisi_kreator_min) {
    return { ok: false, message: "Komisi kreator max < min.", fieldErrors: { komisi_kreator_max: "Max harus ≥ min" } };
  }
  if (d.komisi_mea_max != null && d.komisi_mea_max < d.komisi_mea_min) {
    return { ok: false, message: "Komisi MEA max < min.", fieldErrors: { komisi_mea_max: "Max harus ≥ min" } };
  }

  const supabase = await createClient();

  // shop_id unique among registered deals
  const { data: dupe } = await supabase
    .from("brand_deals").select("id").eq("shop_id", d.shop_id).maybeSingle();
  if (dupe) {
    return { ok: false, message: `Shop ID ${d.shop_id} sudah terdaftar di deal ${dupe.id}.`, fieldErrors: { shop_id: "Shop ID sudah dipakai" } };
  }

  const kreatorRaw = d.komisi_kreator_max != null && d.komisi_kreator_max !== d.komisi_kreator_min
    ? `${d.komisi_kreator_min}-${d.komisi_kreator_max}%` : `${d.komisi_kreator_min}%`;
  const meaRaw = d.komisi_mea_max != null && d.komisi_mea_max !== d.komisi_mea_min
    ? `${d.komisi_mea_min}-${d.komisi_mea_max}%` : `${d.komisi_mea_min}%`;

  const id = genId("DEAL");
  const record = {
    id,
    brand_name: d.brand_name.trim(),
    shop_id: d.shop_id,
    niche: d.niche.trim(),
    exp_date: d.exp_date,
    deal_end: d.exp_date, // deal_end = exp_date (BUILD_PLAN blocker resolution)
    komisi_kreator_raw: kreatorRaw,
    komisi_kreator_pct: d.komisi_kreator_min,
    komisi_mea_raw: meaRaw,
    komisi_mea_pct: d.komisi_mea_min,
    pic_tap: d.pic_tap,
    campaign_name: d.campaign_name.trim(),
    brand_link: d.brand_link || null,
    gmv_tap: d.gmv_tap ?? null,
    avg_price: d.avg_price ?? null,
    ads_budget: d.ads_budget || null,
    service_fee: d.service_fee || null,
    campaign_type: d.campaign_type,
    notes: d.notes?.trim() || null,
    created_by: actor.id,
  };

  // Insert via user-scoped client so RLS enforces the bizdev/management write rule.
  const { error } = await supabase.from("brand_deals").insert(record);
  if (error) return { ok: false, message: `Gagal menyimpan deal: ${error.message}` };

  // Sync exp_date → cooperating_shops.deal_end for the M4 expiry alert (service write).
  const admin = createAdminClient();
  const { error: shopError } = await admin.from("cooperating_shops").upsert(
    {
      shop_id: d.shop_id,
      deal_id: id,
      deal_end: d.exp_date,
      active_flag: d.exp_date >= new Date().toISOString().slice(0, 10),
    },
    { onConflict: "shop_id" }
  );

  // Daftar produk (1 brand → N produk): rows product_id[]/product_name[]/product_link[]
  const productNames = formData.getAll("product_name[]").map((v) => String(v).trim());
  const productIds = formData.getAll("product_id[]").map((v) => String(v).trim());
  const productLinks = formData.getAll("product_link[]").map((v) => String(v).trim());
  const productRows = productNames
    .map((name, i) => ({
      deal_id: id,
      product_id: productIds[i] || null,
      product_name: name,
      product_link: productLinks[i] || null,
      niche: d.niche.trim(),
      exp_date: d.exp_date,
      komisi_kreator_pct: d.komisi_kreator_min,
      komisi_mea_pct: d.komisi_mea_min,
      created_by: actor.id,
    }))
    .filter((p) => p.product_name);
  let productError: string | null = null;
  if (productRows.length > 0) {
    const { error: pErr } = await admin.from("deal_products").insert(productRows);
    if (pErr) productError = pErr.message;
  }

  await writeAudit({
    actorId: actor.id,
    action: "brand_deal.register",
    entityType: "brand_deals",
    entityId: id,
    after: { ...record, products: productRows.length },
    type: "auto", // menambah income → auto berlaku, tetap ter-log (CLAUDE.md #2)
  });

  revalidatePath("/deals");
  const extras: string[] = [];
  if (shopError) extras.push(`sync cooperating_shops gagal: ${shopError.message}`);
  if (productError) extras.push(`simpan produk gagal: ${productError}`);
  else if (productRows.length > 0) extras.push(`${productRows.length} produk terdaftar`);
  return {
    ok: true,
    message: `Deal ${id} tersimpan.${extras.length ? ` ${extras.join("; ")}.` : ""}`,
  };
}

/**
 * Bulk upload produk deal via Excel (xlsx utama, csv fallback).
 * Kolom: deal_id ATAU shop_id (resolve brand), product_id, product_name, product_link,
 * niche, exp_date, komisi_kreator, komisi_mea, ads_budget, service_fee, status.
 */
export async function uploadDealProducts(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("deals.register");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();

  // Resolve deal by deal_id or shop_id per row (cache lookups).
  const byShop = new Map<string, string>();
  const dealIds = new Set<string>();
  {
    const { data: allDeals } = await admin.from("brand_deals").select("id, shop_id");
    for (const dl of allDeals ?? []) {
      dealIds.add(dl.id);
      if (dl.shop_id) byShop.set(dl.shop_id, dl.id);
    }
  }

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw)) continue;

    const name = (raw.product_name ?? raw.nama_produk ?? "").trim();
    if (!name) {
      report.skipped.push({ row: rowNum, reason: "product_name kosong" });
      continue;
    }
    const dealRef = (raw.deal_id ?? "").trim();
    const shopRef = (raw.shop_id ?? "").trim();
    const dealId = dealRef && dealIds.has(dealRef) ? dealRef : shopRef ? byShop.get(shopRef) : undefined;
    if (!dealId) {
      report.skipped.push({ row: rowNum, reason: `deal tidak ditemukan (deal_id "${dealRef}" / shop_id "${shopRef}")` });
      continue;
    }

    const komisiKreator = parseCommission((raw.komisi_kreator ?? "").trim());
    const komisiMea = parseCommission((raw.komisi_mea ?? "").trim());
    const expDate = parseFlexibleDate((raw.exp_date ?? "").trim());

    const { error } = await admin.from("deal_products").insert({
      deal_id: dealId,
      product_id: (raw.product_id ?? "").trim() || null,
      product_name: name,
      product_link: (raw.product_link ?? raw.link_produk ?? "").trim() || null,
      niche: raw.niche?.trim() || null,
      exp_date: expDate,
      komisi_kreator_pct: komisiKreator?.min ?? null,
      komisi_mea_pct: komisiMea?.min ?? null,
      ads_budget: parseRupiah(raw.ads_budget),
      service_fee: parseRupiah(raw.service_fee),
      status: normalizeChoice(raw.status, ["running", "hold", "done"]) ?? "running",
      created_by: actor.id,
    });
    if (error) {
      report.skipped.push({ row: rowNum, reason: error.message });
      continue;
    }
    report.inserted++;
  }

  await writeAudit({
    actorId: actor.id,
    action: "deal_products.bulk_upload",
    entityType: "deal_products",
    entityId: null,
    after: { rows: report.inserted, file: file.name },
    type: "auto",
  });

  revalidatePath("/deals");
  return report;
}

/**
 * Legacy "Master Deal Internal" importer (CLAUDE.md #7 — tolerant parser, flag dirty rows):
 * mixed Rupiah separators, free-text exp dates, dirty commissions ("5-7%", "not found"),
 * "Summary" rows skipped, negative countdown → shop active_flag=false. Rows never crash;
 * problems are recorded in brand_deals.review_flags and reported back.
 */
export async function importLegacyDeals(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("deals.import_legacy");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  // Legacy BD master sheets (incl. Apple Numbers exports) prepend an index row
  // and/or a merged super-header before the real column header — skip until a
  // recognizable brand/shop column appears.
  const { rows, errors } = await parseSheet(file, [
    "nama_brand", "brand_name", "brand", "shop_id",
  ]);
  if (rows.length === 0 && errors.length === 0) {
    errors.push(
      'Header tidak dikenali — pastikan ada kolom "Nama Brand" / "Brand" / "SHOP ID". ' +
        "Sheet lama dengan baris judul di atas header tetap didukung (baris judul dilewati otomatis)."
    );
  }
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw)) continue; // platform export artifact
    // Numbers/Excel exports pad trailing empty rows — skip them silently.
    if (Object.values(raw).every((v) => !String(v).trim())) continue;

    const brandName = (raw.nama_brand ?? raw.brand_name ?? raw.brand ?? "").trim();
    if (!brandName) {
      report.skipped.push({ row: rowNum, reason: "nama brand kosong — dilewati" });
      continue;
    }

    const flags: string[] = [];

    const shopIdRaw = (raw.shop_id ?? raw["shop_id"] ?? "").trim();
    const shopId = /^\d+$/.test(shopIdRaw) ? shopIdRaw : null;
    if (shopIdRaw && !shopId) flags.push(`shop_id tidak numeric: "${shopIdRaw}"`);
    if (!shopIdRaw) flags.push("shop_id kosong");

    const gmvTap = parseRupiah(raw.gmv_tap);
    if (raw.gmv_tap?.trim() && gmvTap === null) flags.push(`gmv_tap tidak terbaca: "${raw.gmv_tap}"`);
    const avgPrice = parseRupiah(raw.avg_harga ?? raw.avg_price);
    if ((raw.avg_harga ?? raw.avg_price)?.trim() && avgPrice === null) {
      flags.push(`avg_harga tidak terbaca: "${raw.avg_harga ?? raw.avg_price}"`);
    }

    const expRaw = (raw.exp_date ?? "").trim();
    const expDate = parseFlexibleDate(expRaw);
    if (expRaw && !expDate) flags.push(`exp_date tidak terbaca: "${expRaw}"`);

    const komisiKreatorRaw = (raw.komisi_kreator ?? "").trim();
    const komisiKreator = parseCommission(komisiKreatorRaw);
    if (komisiKreatorRaw && !komisiKreator) flags.push(`komisi kreator kotor: "${komisiKreatorRaw}"`);
    if (komisiKreator?.isRange) flags.push(`komisi kreator range: "${komisiKreatorRaw}"`);

    const komisiMeaRaw = (raw.komisi_mea ?? "").trim();
    const komisiMea = parseCommission(komisiMeaRaw);
    if (komisiMeaRaw && !komisiMea) flags.push(`komisi MEA kotor: "${komisiMeaRaw}"`);
    if (komisiMea?.isRange) flags.push(`komisi MEA range: "${komisiMeaRaw}"`);

    // Negative countdown (deal past exp_date) → shop inactive.
    const countdown = Number((raw.countdown ?? "").trim());
    const expired =
      (Number.isFinite(countdown) && countdown < 0) || (expDate !== null && expDate < today);

    const id = genId("DEAL");
    const { error } = await admin.from("brand_deals").insert({
      id,
      brand_name: brandName,
      shop_id: shopId,
      niche: raw.niche?.trim() || null,
      gmv_tap: gmvTap,
      avg_price: avgPrice,
      // "Nama BD" in BD master tracker → handler; "Ads" (Rp) → ads budget.
      tim_handler: (raw.tim_handler ?? raw.nama_bd ?? raw.nama_campaign_ops)?.trim() || null,
      ads_brand: raw.ads_brand?.trim() || null,
      ads_budget: parseRupiah(raw.ads_budget ?? raw.ads),
      leads_type: (raw.leads ?? raw.leads_type)?.trim() || null,
      bobot_leads: (raw.bobot ?? raw.bobot_leads)?.trim() || null,
      diterima_ditolak: normalizeChoice(raw["diterima/ditolak"] ?? raw.diterima_ditolak, ["diterima", "ditolak"]),
      priority: raw.priority?.trim() || null,
      status: normalizeChoice(raw.status, ["running", "hold", "done"]),
      // "Nama Campiagn" (sic) is the header in the BD master tracker.
      campaign_name: (raw.campaign_name ?? raw.nama_campaign ?? raw.nama_campiagn)?.trim() || null,
      campaign_id: raw.campaign_id?.trim() || null,
      exp_date: expDate,
      deal_end: expDate,
      link_tap: raw.link_tap?.trim() || null,
      contact_pic_brand: (raw.contact_pic ?? raw.contact_pic_brand)?.trim() || null,
      nama_grup: raw.nama_grup?.trim() || null,
      komisi_kreator_raw: komisiKreatorRaw || null,
      komisi_kreator_pct: komisiKreator?.min ?? null,
      komisi_mea_raw: komisiMeaRaw || null,
      komisi_mea_pct: komisiMea?.min ?? null,
      openplan: raw.openplan?.trim() || null,
      action: raw.action?.trim() || null,
      notes: raw.notes?.trim() || null,
      shop_code: raw.shop_code?.trim() || null,
      review_flags: flags,
      created_by: actor.id,
    });
    if (error) {
      report.skipped.push({ row: rowNum, reason: error.message });
      continue;
    }

    if (shopId && expDate) {
      await admin.from("cooperating_shops").upsert(
        { shop_id: shopId, deal_id: id, deal_end: expDate, active_flag: !expired },
        { onConflict: "shop_id" }
      );
    }

    await writeAudit({
      actorId: actor.id,
      action: "brand_deal.import_legacy",
      entityType: "brand_deals",
      entityId: id,
      after: { brand_name: brandName, shop_id: shopId, exp_date: expDate, review_flags: flags },
      type: "auto",
    });

    report.inserted++;
    if (flags.length > 0) {
      report.skipped.push({ row: rowNum, reason: `${id} tersimpan DENGAN flag review: ${flags.join("; ")}` });
    }
  }

  revalidatePath("/deals");
  return report;
}

function normalizeChoice(value: string | undefined, allowed: string[]): string | null {
  const v = value?.trim().toLowerCase();
  return v && allowed.includes(v) ? v : null;
}
