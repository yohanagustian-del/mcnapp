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
import { commissionRaw, dealReviewFlags } from "@/lib/deals/form";
import {
  PRODUCT_CARD_FIELD_LABEL,
  productCardIssues,
  productCardSchema,
} from "@/lib/deals/product-card";
import {
  planShopCardEdit,
  shopEditSchema,
  SHOP_CARD_LIMIT,
  type ShopCardRow,
} from "@/lib/deals/shop-edit";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";
import { getConfig } from "@/lib/config";
import { priceSegmentOf, type PriceBounds } from "@/lib/projection/gmv";
import { NO_CAMPAIGN, uploadProductMasterList } from "@/lib/m10/products";
import { groupKeysByCampaign } from "@/lib/m10/product-keys";
import type { UploadReport } from "@/app/(portal)/tim/actions";

export interface DealFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Registrasi Deal = mendaftarkan KARTU PRODUK ke katalog Produk TAP.
 *
 * Pertanyaan formnya mengikuti header tabel Produk TAP (export TAP "Export link")
 * + dimensi komersial yang tidak dibawa export platform (tipe campaign, ads budget,
 * service fee, deal by, PIC TAP), dan barisnya masuk ke `products_tap` — bukan tabel
 * kartu tersendiri, supaya katalog produk tetap satu sumber (CLAUDE.md #4).
 *
 * Yang wajib hanya Product Name (plus Ads Budget & Service Fee saat tipe campaign =
 * komisi extra). Kolom yang belum diketahui sengaja boleh kosong: memaksa mengisi
 * shop_id/komisi yang belum ketemu justru memancing isian karangan — masalah persis
 * yang membuat master deal lama berantakan (CLAUDE.md #6).
 *
 * Menulis lewat admin client karena RLS products_tap = service-role only (0019);
 * izinnya tetap ditegakkan di server lewat requirePermission.
 */
export async function registerDealCard(
  _prev: DealFormState | null,
  formData: FormData
): Promise<DealFormState> {
  const actor = await requirePermission("deals.register");

  const parsed = productCardSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const d = parsed.data;

  const issues = productCardIssues(d);
  if (Object.keys(issues).length > 0) {
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors: issues };
  }

  // Product ID ikut primary key dan tidak boleh kosong, sementara form
  // membolehkannya kosong. Baris tanpa Product ID asli dapat ID internal dan
  // ditandai perlu review: tanpa Product ID platform, kartu ini tidak akan pernah
  // ketemu data TAP mingguan.
  const generatedProductId = d.product_id === undefined;
  const productId = d.product_id ?? genId("PRD");
  const campaignId = d.campaign_id ?? NO_CAMPAIGN;

  const price = d.price ?? null;
  const bounds = await getConfig<PriceBounds>("segments.price_bounds");

  const record = {
    campaign_id: campaignId,
    product_id: productId,
    product_name: d.product_name,
    price,
    // Segmen harga TIDAK diisi manual — dihitung dari harga memakai threshold
    // app_config, sama seperti jalur upload & derive (CLAUDE.md konvensi kode).
    price_segment: price !== null && price > 0 ? priceSegmentOf(price, bounds) : null,
    shop_name: d.shop_name ?? null,
    shop_id: d.shop_id ?? null,
    effective_start: d.effective_start ?? null,
    effective_end: d.effective_end ?? null,
    commission_pct: d.commission_pct ?? null,
    partner_commission_pct: d.partner_commission_pct ?? null,
    creator_shop_ads_commission_pct: d.creator_shop_ads_commission_pct ?? null,
    partner_shop_ads_commission_pct: d.partner_shop_ads_commission_pct ?? null,
    product_link: d.product_link ?? null,
    campaign_type: d.campaign_type ?? null,
    ads_budget: d.ads_budget ?? null,
    service_fee: d.service_fee ?? null,
    deal_by: d.deal_by ?? null,
    pic_tap: d.pic_tap ?? null,
    source: "deal_register",
    // Pemilik baris = akun yang mendaftarkan (kolom "Nama BD" di tabel Produk TAP).
    uploaded_by: actor.id,
    needs_review: generatedProductId,
    first_seen: new Date().toISOString().slice(0, 10),
    last_seen: new Date().toISOString().slice(0, 10),
    updated_at: new Date().toISOString(),
  };

  const admin = createAdminClient();
  // insert, BUKAN upsert: kalau (campaign_id, product_id) sudah ada, menimpanya
  // diam-diam berarti menghapus kartu milik orang lain — persis yang dicegah
  // migrasi 0040. Lebih baik ditolak dengan pesan jelas.
  const { error } = await admin.from("products_tap").insert(record);
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message:
          `Kartu untuk Product ID ${productId} di campaign ${campaignId} sudah ada. ` +
          "Isi Campaign ID kalau ini campaign yang berbeda, atau perbaiki kartunya lewat tab Produk TAP.",
        fieldErrors: { campaign_id: "Kombinasi Campaign ID + Product ID sudah terdaftar" },
      };
    }
    return { ok: false, message: `Gagal menyimpan kartu produk: ${error.message}` };
  }

  await writeAudit({
    actorId: actor.id,
    action: "products_tap.register",
    entityType: "products_tap",
    entityId: `${campaignId}|${productId}`,
    after: record,
    type: "auto", // menambah data/income → auto berlaku, tetap ter-log (CLAUDE.md #2)
  });

  revalidatePath("/products");
  const notes: string[] = [];
  if (generatedProductId) {
    notes.push(`Product ID belum diisi → dipakai ID internal ${productId} dan ditandai perlu review`);
  }
  return {
    ok: true,
    message:
      `Kartu produk "${d.product_name}" tersimpan di tab Produk TAP.` +
      (notes.length ? ` ${notes.join("; ")}.` : ""),
  };
}

/**
 * Edit satu baris tabel "Shop dari Produk TAP" (tab Deal Brand).
 *
 * Baris itu adalah RINGKASAN kartu produk, jadi mengeditnya menulis ke seluruh
 * kartu shop tersebut di `products_tap`: Shop ID yang diisi di sini terisi ke semua
 * produk shop itu di tab Produk TAP, begitu pula Tipe Campaign. Dua kolom itu saja
 * — harga, komisi, dan masa berlaku berbeda per produk.
 *
 * Anggota grup diambil lewat kolom generated `shop_key` (migrasi 0043), yaitu kunci
 * yang SAMA dengan yang dipakai view ringkasan untuk mengelompokkan — bukan salinan
 * ekspresi group by di sisi aplikasi (CLAUDE.md #4).
 *
 * Aturan "Paid Campaign wajib Ads Budget & Service Fee" dibaca dari
 * `productCardIssues()` yang sama dengan Registrasi Deal & Edit kartu; kalau ada
 * kartu yang belum memenuhinya, SELURUH edit dibatalkan (tidak ada shop yang
 * setengah terisi) dan formnya meminta nominal untuk mengisi kartu yang kosong.
 *
 * Menulis lewat admin client karena RLS products_tap = service-role only (0019);
 * izinnya tetap ditegakkan server lewat requirePermission("products.edit").
 */
export async function updateShopCards(
  _prev: DealFormState | null,
  formData: FormData
): Promise<DealFormState> {
  const actor = await requirePermission("products.edit");

  const parsed = shopEditSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const { shop_key: shopKey, ...values } = parsed.data;

  if (values.shop_id === undefined && values.campaign_type === undefined) {
    return {
      ok: false,
      message: "Isi Shop ID dan/atau pilih Tipe Campaign yang mau diterapkan ke shop ini.",
    };
  }

  const admin = createAdminClient();
  const { data: rows, error: readError } = await admin
    .from("products_tap")
    .select("campaign_id, product_id, shop_id, campaign_type, ads_budget, service_fee")
    .eq("shop_key", shopKey);
  if (readError) return { ok: false, message: `Gagal membaca kartu shop: ${readError.message}` };
  if (!rows || rows.length === 0) {
    return { ok: false, message: `Tidak ada kartu produk untuk shop "${shopKey}".` };
  }
  if (rows.length > SHOP_CARD_LIMIT) {
    return {
      ok: false,
      message:
        `Shop ini punya ${rows.length} kartu — di atas batas ${SHOP_CARD_LIMIT} sekali edit. ` +
        "Perbaiki lewat pilih baris + edit massal di tab Produk TAP.",
    };
  }

  const plan = planShopCardEdit(rows as ShopCardRow[], values);
  if (plan.blocked.length > 0) {
    const fields = [...new Set(plan.blocked.flatMap((b) => b.fields))];
    const labels = fields.map((f) => PRODUCT_CARD_FIELD_LABEL[f] ?? f).join(" & ");
    return {
      ok: false,
      message:
        `${plan.blocked.length} kartu shop ini belum punya ${labels}, padahal ` +
        `${CAMPAIGN_TYPE_LABEL[values.campaign_type ?? ""]} mewajibkannya. Isi nominalnya di form ` +
        "ini — nilainya hanya diisikan ke kartu yang masih kosong, kartu yang sudah terisi tidak ditimpa.",
      fieldErrors: Object.fromEntries(fields.map((f) => [f, "Wajib diisi untuk shop ini"])),
    };
  }
  if (plan.updates.length === 0) {
    return { ok: true, message: "Tidak ada yang berubah — kartu shop ini sudah sesuai." };
  }

  // Kartu dikelompokkan per patch yang IDENTIK lalu ditulis per campaign: jumlah
  // round-trip mengikuti variasi patch (paling banyak beberapa), bukan jumlah kartu.
  const byPatch = new Map<string, { patch: Record<string, unknown>; keys: typeof plan.updates }>();
  for (const u of plan.updates) {
    const signature = JSON.stringify(u.patch);
    const group = byPatch.get(signature) ?? { patch: u.patch, keys: [] };
    group.keys.push(u);
    byPatch.set(signature, group);
  }

  const changed = new Set(plan.updates.map((u) => `${u.campaign_id}|${u.product_id}`));
  const before = rows.filter((r) => changed.has(`${r.campaign_id}|${r.product_id}`));

  const now = new Date().toISOString();
  let updated = 0;
  for (const group of byPatch.values()) {
    const byCampaign = groupKeysByCampaign(
      group.keys.map((k) => ({ campaignId: k.campaign_id, productId: k.product_id }))
    );
    for (const [campaignId, productIds] of byCampaign) {
      const { data, error } = await admin
        .from("products_tap")
        .update({ ...group.patch, updated_at: now })
        .eq("campaign_id", campaignId)
        .in("product_id", productIds)
        .select("product_id");
      if (error) {
        return {
          ok: false,
          message: `Gagal menyimpan (${updated} kartu sudah tersimpan): ${error.message}`,
        };
      }
      updated += data?.length ?? 0;
    }
  }

  // Memperbaiki data master (mengisi Shop ID, menegaskan tipe campaign) tidak
  // merugikan → auto berlaku, tetap terekam penuh before/after (CLAUDE.md #2).
  await writeAudit({
    actorId: actor.id,
    action: "products_tap.shop_update",
    entityType: "products_tap",
    entityId: shopKey,
    before,
    after: { shop_key: shopKey, values, rows: updated },
    type: "auto",
  });

  revalidatePath("/deals");
  revalidatePath("/products");

  const done: string[] = [];
  if (values.shop_id !== undefined) done.push(`Shop ID ${values.shop_id}`);
  if (values.campaign_type !== undefined) {
    done.push(`Tipe Campaign ${CAMPAIGN_TYPE_LABEL[values.campaign_type]}`);
  }
  return {
    ok: true,
    message: `${done.join(" & ")} diterapkan ke ${updated} kartu produk shop ini.`,
  };
}

/**
 * Upload massal kartu produk di halaman Registrasi Deal ("Upload Produk Deal Lama
 * via Excel").
 *
 * Parser & tabel tujuannya sama persis dengan "Upload Master Product List" di tab
 * Produk TAP (CLAUDE.md #6 — satu importer). Bedanya HANYA satu: di jalur ini Tipe
 * Campaign wajib dijawab, karena yang diunggah adalah deal — dan file export TAP
 * tidak membawa kolom itu. Jawabannya (plus Ads Budget & Service Fee untuk Paid
 * Campaign) diisikan ke setiap kartu di file.
 */
export async function uploadDealProducts(formData: FormData): Promise<UploadReport> {
  if (!String(formData.get("campaign_type") ?? "").trim()) {
    return {
      inserted: 0,
      skipped: [],
      error:
        "Tipe Campaign wajib dipilih sebelum upload — kolom itu tidak ada di file export TAP, " +
        "jadi jawabannya di form inilah yang mengisi kolom Tipe Campaign semua kartu di file.",
    };
  }

  const report = await uploadProductMasterList(formData);
  revalidatePath("/products");
  revalidatePath("/deals");
  return report;
}

/**
 * Angka opsional dari form: "" (input dikosongkan) → undefined, bukan 0.
 * `z.coerce.number()` mengubah "" menjadi 0, dan untuk komisi 0% adalah nilai sah
 * yang berbeda artinya dari "belum diisi".
 */
function optionalNumber(max?: number) {
  return z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    (max === undefined
      ? z.coerce.number().nonnegative()
      : z.coerce.number().min(0).max(max)
    ).optional()
  );
}

/**
 * Edit deal brand (form tervalidasi, bukan free-text) — CLAUDE.md #6.
 *
 * Dipakai untuk membereskan baris hasil `importLegacyDeals`: shop_id kosong/bukan
 * angka, exp_date teks bebas, komisi "not found"/"5-7%". Validasinya sama ketatnya
 * dengan registrasi (shop_id numeric & unik, exp_date dari date picker, komisi angka
 * %), BEDANYA kolom yang belum diketahui boleh dikosongkan → null: memaksa BizDev
 * mengisi shop_id yang belum ketemu hanya untuk memperbaiki nama brand justru
 * memancing isian karangan.
 *
 * `review_flags` DIHITUNG ULANG dari nilai yang tersimpan (bukan dipertahankan buta):
 * setelah lewat form ini satu-satunya masalah yang mungkin tersisa adalah kolom yang
 * memang masih kosong, karena format sudah dijamin oleh validasi.
 */
const dealEditSchema = z.object({
  deal_id: z.string().min(1),
  brand_name: z.string().min(1, "Nama brand wajib (sesuai display platform)"),
  shop_id: z.string().regex(/^\d*$/, "Shop ID harus angka").optional().default(""),
  niche: z.string().optional().default(""),
  exp_date: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Exp date wajib dari date picker")
    .optional()
    .default(""),
  komisi_kreator_min: optionalNumber(100),
  komisi_kreator_max: optionalNumber(100),
  komisi_mea_min: optionalNumber(100),
  komisi_mea_max: optionalNumber(100),
  campaign_name: z.string().optional().default(""),
  campaign_type: z.enum(["paid", "sample", "extra_commission"]).default("paid"),
  status: z.enum(["", "running", "hold", "done"]).default(""),
  ads_budget: optionalNumber(),
  service_fee: optionalNumber(),
  gmv_tap: optionalNumber(),
  avg_price: optionalNumber(),
  notes: z.string().optional().default(""),
});

export async function updateDeal(
  _prev: DealFormState | null,
  formData: FormData
): Promise<DealFormState> {
  const actor = await requirePermission("deals.edit");

  const parsed = dealEditSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const d = parsed.data;

  if (d.komisi_kreator_max != null && d.komisi_kreator_min == null) {
    return { ok: false, message: "Komisi kreator: isi min dulu.", fieldErrors: { komisi_kreator_min: "Wajib bila max diisi" } };
  }
  if (d.komisi_mea_max != null && d.komisi_mea_min == null) {
    return { ok: false, message: "Komisi MEA: isi min dulu.", fieldErrors: { komisi_mea_min: "Wajib bila max diisi" } };
  }
  if (d.komisi_kreator_max != null && d.komisi_kreator_min != null && d.komisi_kreator_max < d.komisi_kreator_min) {
    return { ok: false, message: "Komisi kreator max < min.", fieldErrors: { komisi_kreator_max: "Max harus ≥ min" } };
  }
  if (d.komisi_mea_max != null && d.komisi_mea_min != null && d.komisi_mea_max < d.komisi_mea_min) {
    return { ok: false, message: "Komisi MEA max < min.", fieldErrors: { komisi_mea_max: "Max harus ≥ min" } };
  }

  const supabase = await createClient();

  const { data: before } = await supabase
    .from("brand_deals")
    .select(
      "id, brand_name, shop_id, niche, exp_date, campaign_name, campaign_type, status, komisi_kreator_raw, komisi_kreator_pct, komisi_mea_raw, komisi_mea_pct, ads_budget, service_fee, gmv_tap, avg_price, notes, review_flags"
    )
    .eq("id", d.deal_id)
    .maybeSingle();
  if (!before) return { ok: false, message: `Deal ${d.deal_id} tidak ditemukan.` };

  const shopId = d.shop_id.trim() || null;
  const expDate = d.exp_date.trim() || null;

  // shop_id tetap unik antar deal (satu shop = satu deal aktif); baris ini sendiri
  // tentu saja tidak dihitung sebagai duplikat.
  if (shopId) {
    const { data: dupe } = await supabase
      .from("brand_deals").select("id").eq("shop_id", shopId).neq("id", d.deal_id).maybeSingle();
    if (dupe) {
      return {
        ok: false,
        message: `Shop ID ${shopId} sudah terdaftar di deal ${dupe.id}.`,
        fieldErrors: { shop_id: "Shop ID sudah dipakai deal lain" },
      };
    }
  }

  const flags = dealReviewFlags({ shopId, expDate });

  const record = {
    brand_name: d.brand_name.trim(),
    shop_id: shopId,
    niche: d.niche.trim() || null,
    exp_date: expDate,
    deal_end: expDate, // deal_end = exp_date (sama seperti registrasi)
    komisi_kreator_raw: commissionRaw(d.komisi_kreator_min, d.komisi_kreator_max),
    komisi_kreator_pct: d.komisi_kreator_min ?? null,
    komisi_mea_raw: commissionRaw(d.komisi_mea_min, d.komisi_mea_max),
    komisi_mea_pct: d.komisi_mea_min ?? null,
    campaign_name: d.campaign_name.trim() || null,
    campaign_type: d.campaign_type,
    status: d.status || null,
    ads_budget: d.ads_budget ?? null,
    service_fee: d.service_fee ?? null,
    gmv_tap: d.gmv_tap ?? null,
    avg_price: d.avg_price ?? null,
    notes: d.notes.trim() || null,
    review_flags: flags,
  };

  // Update lewat client user-scoped supaya RLS deals_update yang menentukan boleh/tidak.
  const { error } = await supabase.from("brand_deals").update(record).eq("id", d.deal_id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  // Sinkron exp_date → cooperating_shops.deal_end untuk alert kadaluarsa M4 (CLAUDE.md #5).
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const extras: string[] = [];
  // shop_id berpindah: baris shop lama tidak boleh terus mengklaim deal ini.
  if (before.shop_id && before.shop_id !== shopId) {
    await admin
      .from("cooperating_shops")
      .update({ deal_id: null, deal_end: null })
      .eq("shop_id", before.shop_id)
      .eq("deal_id", d.deal_id);
  }
  if (shopId) {
    const { error: shopError } = await admin.from("cooperating_shops").upsert(
      {
        shop_id: shopId,
        deal_id: d.deal_id,
        deal_end: expDate,
        active_flag: expDate ? expDate >= today : true,
      },
      { onConflict: "shop_id" }
    );
    if (shopError) extras.push(`sync cooperating_shops gagal: ${shopError.message}`);
  }

  // Koreksi data master (bukan aksi yang mengurangi income) → auto berlaku, tetap
  // ter-log lengkap before/after (CLAUDE.md #2).
  await writeAudit({
    actorId: actor.id,
    action: "brand_deal.update",
    entityType: "brand_deals",
    entityId: d.deal_id,
    before,
    after: { id: d.deal_id, ...record },
    type: "auto",
  });

  revalidatePath("/deals");
  revalidatePath(`/deals/${d.deal_id}`);
  return {
    ok: true,
    message:
      `Deal ${d.deal_id} tersimpan.` +
      (flags.length ? ` Masih ada ${flags.length} flag review: ${flags.join("; ")}.` : "") +
      (extras.length ? ` ${extras.join("; ")}.` : ""),
  };
}

/**
 * Catatan: upload massal produk deal TIDAK lagi punya importer sendiri.
 * "Upload Produk Deal Lama via Excel" di halaman Registrasi Deal kini memakai
 * `uploadProductMasterList` (tab Produk TAP) — satu format file export TAP, satu
 * tabel tujuan (`products_tap`), satu perilaku upsert per (campaign_id, product_id).
 * Tabel `deal_products` tetap dibaca halaman detail deal untuk data lama.
 */

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
