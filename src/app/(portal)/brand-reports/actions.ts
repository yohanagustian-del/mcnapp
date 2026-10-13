"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { parseRupiah } from "@/lib/utils/rupiah";
import { todayWib } from "@/lib/utils/date";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import { parsePeriodParam } from "@/lib/m8/period";
import { buildBrandReportData } from "@/lib/brand-report/build";
import { loadBrandReportSource, reportPeriodRange } from "@/lib/brand-report/data";
import {
  BRAND_REPORT_TEXT_KEYS,
  brandReportTexts,
  sanitizeEdits,
  type BrandReportRules,
  type BrandReportTexts,
} from "@/lib/brand-report/rules";

export interface BrandReportActionState {
  ok: boolean;
  message: string;
}

/**
 * Report Brand v2 (REVISI_BIZDEV T9): shop + periode → angka dari view 0087 + kalimat
 * aturan app_config. 0 LLM (`token_used = 0`), tanpa upload file. Ads spend opsional
 * (tidak ada di data platform) → ROAS & saran upgrade memakai ambang
 * m8.upgrade_roas_min / m8.upgrade_gmv_min apa adanya.
 */
export async function generateBrandReportV2(
  _prev: BrandReportActionState | null,
  formData: FormData
): Promise<BrandReportActionState> {
  const actor = await requirePermission("m8.brand_report");
  const platform = String(formData.get("platform") ?? "");
  const shopId = String(formData.get("shop_id") ?? "").trim();
  if (platform !== "tiktok" && platform !== "shopee") return { ok: false, message: "Platform tidak dikenal." };
  if (!/^\d+$/.test(shopId)) return { ok: false, message: "Shop ID harus angka." };
  const todayIso = todayWib();
  const period = parsePeriodParam(String(formData.get("period") ?? ""), todayIso);
  const adsRaw = String(formData.get("ads_spend") ?? "").trim();
  const adsSpend = adsRaw ? parseRupiah(adsRaw) : null;
  if (adsRaw && (adsSpend === null || adsSpend < 0)) return { ok: false, message: "Ads spend harus nominal Rupiah." };

  const admin = createAdminClient();
  const source = await loadBrandReportSource(admin, platform, shopId, period, todayIso);
  if (!source.ok) return { ok: false, message: source.message };
  // Report Brand = brand ber-deal: shop_key dibaca dari shop_key_map (SQL), tidak pernah
  // disusun di aplikasi (CLAUDE.md #4/#6). Shop tanpa kartu/deal belum punya kunci.
  if (!source.input.shop.shopKey) {
    return {
      ok: false,
      message:
        `Shop ${shopId} belum terdaftar sebagai Deal Brand (belum ada kartu Produk TAP / deal dengan Shop ID ini). ` +
        "Daftarkan dulu lewat Registrasi Deal — cukup Shop Name + Shop ID — lalu generate ulang.",
    };
  }

  const [rules, roasMin, gmvMin] = await Promise.all([
    getConfig<BrandReportRules>("m8.brand_report_rules"),
    getConfig<number>("m8.upgrade_roas_min"),
    getConfig<number>("m8.upgrade_gmv_min"),
  ]);
  const data = buildBrandReportData({
    ...source.input,
    adsSpend,
    upgrade: { roasMin: Number(roasMin), gmvMin: Number(gmvMin) },
    topCreators: Number(rules.top_creators),
    untappedCreatorGmvMin: Number(rules.untapped_creator_gmv_min),
  });
  const texts = brandReportTexts(data, rules);
  const range = reportPeriodRange(period);

  const { data: report, error } = await admin
    .from("brand_reports")
    .insert({
      deal_id: null,
      shop_key: data.shop.shop_key,
      platform,
      schema_version: 2,
      period_start: range.start,
      period_end: range.endExclusive,
      // Kalimat aturan disimpan saat generate: report tidak berubah diam-diam bila
      // ambang app_config diubah belakangan. Suntingan tim terpisah di edits_json.
      data_json: { ...data, texts },
      summary_text: texts.summary,
      token_used: 0,
      generated_by: actor.id,
      status: "draft",
    })
    .select("id")
    .single();
  if (error) {
    if (isMissingRelationError(error)) return { ok: false, message: MIGRATION_0087_MISSING };
    return { ok: false, message: `Gagal menyimpan report brand: ${error.message}` };
  }

  await writeAudit({
    actorId: actor.id,
    action: "m8.brand_report",
    entityType: "brand_reports",
    entityId: String(report.id),
    after: {
      schema_version: 2, platform, shop_id: shopId, period: period.value,
      gmv_mcn: data.totals.gmv_mcn, gmv_tap: data.totals.gmv_tap, roas: data.roas,
      upgrade_recommendation: data.upgrade_recommendation, token_used: 0,
    },
    type: "auto",
  });
  revalidatePath("/brand-reports");
  redirect(`/brand-reports/${report.id}`);
}

type ReportRow = { id: number; schema_version: number; status: string; data_json: { texts?: Partial<BrandReportTexts> } | null; edits_json: unknown };

async function loadV2Report(admin: ReturnType<typeof createAdminClient>, reportId: number): Promise<ReportRow | string> {
  const { data, error } = await admin
    .from("brand_reports")
    .select("id, schema_version, status, data_json, edits_json")
    .eq("id", reportId)
    .maybeSingle();
  if (error) return isMissingRelationError(error) ? MIGRATION_0087_MISSING : error.message;
  if (!data) return "Report tidak ditemukan.";
  if (data.schema_version !== 2) return "Report lama (v1) hanya bisa dibaca.";
  return data as ReportRow;
}

/** Tim menyunting TEKS saja (edits_json); angka di data_json tidak pernah disentuh. */
export async function saveBrandReportEdits(
  reportId: number,
  _prev: BrandReportActionState | null,
  formData: FormData
): Promise<BrandReportActionState> {
  const actor = await requirePermission("m8.brand_report");
  const admin = createAdminClient();
  const report = await loadV2Report(admin, reportId);
  if (typeof report === "string") return { ok: false, message: report };
  if (report.status === "final") return { ok: false, message: "Report sudah final — teks tidak bisa diubah lagi." };

  const input: Record<string, string> = {};
  for (const k of BRAND_REPORT_TEXT_KEYS) input[k] = String(formData.get(k) ?? "");
  const edits = sanitizeEdits(input, report.data_json?.texts ?? {});

  const { error } = await admin
    .from("brand_reports")
    .update({ edits_json: Object.keys(edits).length ? edits : null })
    .eq("id", reportId)
    .eq("status", "draft");
  if (error) return { ok: false, message: `Gagal menyimpan teks: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "m8.brand_report_edit",
    entityType: "brand_reports",
    entityId: String(reportId),
    before: report.edits_json ?? null,
    after: edits,
    type: "auto",
  });
  revalidatePath(`/brand-reports/${reportId}`);
  return { ok: true, message: Object.keys(edits).length ? "Teks report disimpan." : "Teks kembali ke kalimat bawaan." };
}

/** Draft → final: setelah ini teks terkunci. */
export async function finalizeBrandReport(reportId: number): Promise<void> {
  const actor = await requirePermission("m8.brand_report");
  const admin = createAdminClient();
  const report = await loadV2Report(admin, reportId);
  if (typeof report === "string") throw new Error(report);
  if (report.status === "final") return;
  const now = new Date().toISOString();
  const { error } = await admin
    .from("brand_reports")
    .update({ status: "final", finalized_by: actor.id, finalized_at: now })
    .eq("id", reportId)
    .eq("status", "draft");
  if (error) throw new Error(`Gagal memfinalkan report: ${error.message}`);
  await writeAudit({
    actorId: actor.id,
    action: "m8.brand_report_finalize",
    entityType: "brand_reports",
    entityId: String(reportId),
    before: { status: "draft" },
    after: { status: "final", finalized_at: now },
    type: "auto",
  });
  revalidatePath("/brand-reports");
  revalidatePath(`/brand-reports/${reportId}`);
}
