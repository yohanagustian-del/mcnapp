"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { parseMcnFile } from "@/lib/ingest/parse";
import { parseRupiah } from "@/lib/utils/rupiah";
import { PIPELINE_STAGES, shouldRecommendUpgrade, type PipelineStage } from "@/lib/m8/routing";
import { generateBrandSummary, summaryAvailable } from "@/lib/m8/brand-summary";

export interface BrandReportState {
  ok: boolean;
  message: string;
  reportId?: number;
}

/**
 * BizDev memproses req dari semua CM (§2B.1): diajukan → diproses → selesai.
 * Req ads yang menunggu approval Director tidak boleh diproses dulu (§6.4).
 */
export async function processCreatorRequest(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.request_process");
  const reqId = Number(formData.get("req_id"));
  const status = String(formData.get("status"));
  if (!reqId || !["diproses", "selesai"].includes(status)) throw new Error("Status req tidak valid");

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("creator_requests").select("id, status, approval_status, type").eq("id", reqId).maybeSingle();
  if (!req) throw new Error(`Req #${reqId} tidak ditemukan`);
  if (req.approval_status === "menunggu") {
    throw new Error("Req ads masih menunggu approval Director — belum bisa diproses");
  }
  const validFrom: Record<string, string> = { diproses: "diajukan", selesai: "diproses" };
  if (req.status !== validFrom[status]) {
    throw new Error(`Transisi tidak valid: ${req.status} → ${status}`);
  }

  const { error } = await admin
    .from("creator_requests")
    .update({ status, processed_by: actor.id, updated_at: new Date().toISOString() })
    .eq("id", reqId);
  if (error) throw new Error(`Gagal update req: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.request_process", entityType: "creator_requests",
    entityId: String(reqId), before: { status: req.status }, after: { status }, type: "auto",
  });
  revalidatePath("/workspace/bizdev");
  revalidatePath("/workspace/cm");
}

/** Pipeline deal per tahap (§2B.2): prospek → nego → closing → aktif → selesai. */
export async function setPipelineStage(formData: FormData): Promise<void> {
  const actor = await requirePermission("m8.pipeline");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  const stage = String(formData.get("stage") ?? "") as PipelineStage;
  if (!dealId || !PIPELINE_STAGES.includes(stage)) throw new Error("Deal & tahap wajib valid");

  const admin = createAdminClient();
  const { data: deal } = await admin
    .from("brand_deals").select("id, pipeline_stage").eq("id", dealId).maybeSingle();
  if (!deal) throw new Error(`Deal ${dealId} tidak ditemukan`);

  const { error } = await admin
    .from("brand_deals").update({ pipeline_stage: stage }).eq("id", dealId);
  if (error) throw new Error(`Gagal update tahap: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m8.pipeline_stage", entityType: "brand_deals", entityId: dealId,
    before: { pipeline_stage: deal.pipeline_stage }, after: { pipeline_stage: stage }, type: "auto",
  });
  revalidatePath("/workspace/bizdev");
}

/**
 * Report brand (§2B.4, §3.4): agregasi deterministik hasil campaign per brand.
 * Opsi B (upload-generate-buang) — brand report BERDIRI SENDIRI, tidak bergantung
 * pada transactions_all (raw itu dibuang setelah ingest oleh drop-raw, migration
 * 0014 retention.delete_raw_after_ingest). User meng-upload file platform (bisa
 * di-export ter-filter untuk shop deal ini), di-parse & di-agregat IN-MEMORY, lalu
 * HANYA hasil jadi disimpan di brand_reports. Raw tidak pernah masuk DB → nol
 * storage tambahan, sejalan tujuan Module 0.5. ROAS hanya bila ads spend diisi
 * manual (belanja iklan brand tidak ada di data platform). Ringkasan naratif = 1
 * LLM call opsional (satu-satunya titik LLM M8), token di-log.
 */
export async function generateBrandReport(
  _prev: BrandReportState | null,
  formData: FormData
): Promise<BrandReportState> {
  const actor = await requirePermission("m8.brand_report");
  const dealId = String(formData.get("deal_id") ?? "").trim();
  const periodStart = String(formData.get("period_start") ?? "");
  const periodEnd = String(formData.get("period_end") ?? "");
  const adsSpend = parseRupiah(String(formData.get("ads_spend") ?? ""));
  const withSummary = formData.get("with_summary") === "on";
  const file = formData.get("mcn_file");
  const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!dealId) return { ok: false, message: "Deal wajib dipilih" };
  if (!isIso(periodStart) || !isIso(periodEnd) || periodEnd <= periodStart) {
    return { ok: false, message: "Periode tidak valid (start < end)" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "File platform wajib di-upload (export shop ini untuk periode report)" };
  }

  const admin = createAdminClient();
  const { data: deal } = await admin
    .from("brand_deals")
    .select("id, brand_name, shop_id, campaign_name, komisi_mea_pct")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, message: `Deal ${dealId} tidak ditemukan` };
  if (!deal.shop_id) return { ok: false, message: `Deal ${dealId} belum punya shop_id — lengkapi dulu di registrasi deal` };

  // ===== Data layer deterministik (0 LLM), IN-MEMORY — raw tidak disimpan =====
  // Parse file platform, ambil HANYA baris shop deal ini di dalam periode. File
  // umumnya sudah di-export ter-filter per shop; filter shop_id + periode di sini
  // tetap jalan sebagai pengaman bila file memuat shop/periode lain. Baris tanpa
  // periode terbaca (periodStart null) tetap dihitung — file sudah dibatasi user.
  const parsed = await parseMcnFile(file);
  const rows = parsed.rows.filter(
    (r) =>
      r.shopId === deal.shop_id &&
      (r.periodStart === null || (r.periodStart >= periodStart && r.periodStart < periodEnd))
  );
  if (rows.length === 0) {
    return {
      ok: false,
      message: `File tidak berisi transaksi untuk shop ${deal.shop_id} pada periode ini — cek file & periode.`,
    };
  }

  const sum = (f: (r: (typeof rows)[number]) => number) =>
    rows.reduce((s, r) => s + Number(f(r) ?? 0), 0);
  const gmv = sum((r) => r.affiliateGmv);
  const totals = {
    gmv,
    live_gmv: sum((r) => r.affiliateLiveGmv),
    video_gmv: sum((r) => r.affiliateVideoGmv),
    orders: sum((r) => r.orders),
    items_sold: sum((r) => r.itemsSold),
    video_views: 0, // MCN platform report tidak punya kolom views (schema.ts) — selalu 0
    live_views: 0,
    videos: 0,
    creators: new Set(rows.map((r) => r.creatorName).filter(Boolean)).size,
  };
  const roas = adsSpend !== null && adsSpend > 0 ? gmv / adsSpend : null;

  // Rekomendasi upgrade service (LOCKED §6.5): ROAS tinggi + GMV tinggi, ambang tunable.
  const [roasMin, gmvMin] = await Promise.all([
    getConfig<number>("m8.upgrade_roas_min"),
    getConfig<number>("m8.upgrade_gmv_min"),
  ]);
  const upgrade = shouldRecommendUpgrade(gmv, roas, { roasMin, gmvMin });

  const dataJson = {
    deal: { id: deal.id, brand_name: deal.brand_name, shop_id: deal.shop_id, campaign_name: deal.campaign_name },
    period: { start: periodStart, end_exclusive: periodEnd },
    totals,
    ads_spend: adsSpend,
    roas,
    upgrade_recommendation: upgrade,
    upgrade_thresholds: { roas_min: roasMin, gmv_min: gmvMin },
  };

  // ===== Ringkasan naratif (≤1 LLM call, opsional) =====
  let summaryText: string | null = null;
  let tokenUsed = 0;
  let note = "";
  if (withSummary && summaryAvailable()) {
    const result = await generateBrandSummary(dataJson);
    summaryText = result.text;
    tokenUsed = result.tokensUsed;
    note = ` Ringkasan naratif dibuat (${tokenUsed} token).`;
  } else if (withSummary) {
    note = " ANTHROPIC_API_KEY belum di-set — report tersimpan data-only.";
  }

  const { data: report, error } = await admin
    .from("brand_reports")
    .insert({
      deal_id: dealId, period_start: periodStart, period_end: periodEnd,
      data_json: dataJson, summary_text: summaryText, token_used: tokenUsed,
      generated_by: actor.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan report brand: ${error.message}` };

  await writeAudit({
    actorId: actor.id, action: "m8.brand_report", entityType: "brand_reports",
    entityId: String(report.id),
    after: { deal_id: dealId, period_start: periodStart, gmv, roas, upgrade_recommendation: upgrade, token_used: tokenUsed },
    type: "auto",
  });

  revalidatePath("/workspace/bizdev");
  return {
    ok: true,
    message: `Report brand ${deal.brand_name} (${periodStart} s/d ${periodEnd}) tersimpan.${upgrade ? " ✦ Layak ditawari upgrade service (ROAS & GMV di atas ambang)." : ""}${note}`,
    reportId: report.id,
  };
}
