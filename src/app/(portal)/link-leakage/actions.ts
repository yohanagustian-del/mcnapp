"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { isSummaryRow } from "@/lib/utils/csv";
import { parseSheet } from "@/lib/utils/sheet";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { parseCount, pick } from "@/lib/platform-csv";
import {
  assertValidObjectRef, downloadIngestFile, removeIngestFiles, type IngestObjectRef,
} from "@/lib/ingest/storage";
import { runLeakAnalysisFromFiles, type LeakAnalysisResult } from "@/lib/m4/leak-analysis";
import {
  LEAK_DETAIL_CSV_HEADER, LEAK_EXPORT_BUCKET, filterLeakDetailCsv, findLeakDetailExport,
} from "@/lib/m4/leak-export";
import type { UploadReport } from "@/app/(portal)/tim/actions";

/**
 * /link-leakage actions:
 *   - runLeakAnalysisFromStorageAction: jalankan ANALISA KEBOCORAN mingguan di
 *     platform (fungsi artifak "Agency Leaked Generator" yang dipindah ke dalam
 *     platform). Rollup hasilnya langsung mengisi Link Leakage + CM Workspace.
 *   - uploadCooperatingShops: refresh master shop platform (mingguan).
 *   - downloadLeakageCsv: export detail historis era engine (leakage_products).
 *
 * Rollup per kreator tetap TIDAK bisa diedit manual (CLAUDE.md #3) — satu-satunya
 * cara mengubahnya adalah menjalankan ulang analisa dari file platform mingguan.
 */

export type RunLeakAnalysisActionResult =
  | { ok: true; result: LeakAnalysisResult }
  | { ok: false; error: string };

/**
 * Analisa kebocoran mingguan dari file yang SUDAH diunggah browser langsung ke
 * Storage (mem-bypass batas body serverless ~4,5MB → file export ~61k baris aman).
 * Action ini hanya menerima referensi objek, mengunduhnya via service-role,
 * menjalankan pipeline yang SAMA dengan /ingest (src/lib/m4/leak-analysis.ts),
 * lalu menghapus objek transiennya (raw tidak pernah dipersistkan).
 *
 * Dipakai untuk hitung-ulang / minggu yang terlewat; upload mingguan normal cukup
 * lewat /ingest (satu upload sekalian agregat performa). Tidak pernah throw ke
 * client (Next.js menyensor pesan error server action di production).
 */
export async function runLeakAnalysisFromStorageAction(
  mcnRef: unknown,
  tapRef: unknown,
  masterRef?: unknown
): Promise<RunLeakAnalysisActionResult> {
  const paths: string[] = [];
  try {
    const actor = await requirePermission("m4.upload");

    assertValidObjectRef(mcnRef, "MCN");
    const mcn: IngestObjectRef = mcnRef;
    paths.push(mcn.path);

    assertValidObjectRef(tapRef, "TAP");
    const tap: IngestObjectRef = tapRef;
    paths.push(tap.path);

    let master: IngestObjectRef | null = null;
    if (masterRef != null) {
      assertValidObjectRef(masterRef, "Master Data Shop");
      master = masterRef;
      paths.push(master.path);
    }

    const admin = createAdminClient();
    const result = await runLeakAnalysisFromFiles({
      mcnFile: await downloadIngestFile(admin, mcn),
      tapFile: await downloadIngestFile(admin, tap),
      masterFile: master ? await downloadIngestFile(admin, master) : null,
      actorId: actor.id,
      origin: "link_leakage",
    });

    revalidatePath("/link-leakage");
    revalidatePath("/workspace/cm");
    revalidatePath("/workspace/bizdev");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  } finally {
    if (paths.length > 0) await removeIngestFiles(createAdminClient(), paths);
  }
}

/**
 * Weekly master refresh (PRD §2.6): Shop ID | Shop Name | Level 2 Categories |
 * Total Collaborated Creators. Platform data does NOT carry deal_end — deal_id,
 * deal_start, deal_end stay owned by brand_deals sync and are never overwritten here.
 */
export async function uploadCooperatingShops(formData: FormData): Promise<UploadReport> {
  const actor = await requirePermission("m4.upload");
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("File Excel (.xlsx) atau CSV wajib diunggah");

  const { rows, errors } = await parseSheet(file);
  const report: UploadReport = { inserted: 0, skipped: errors.map((e) => ({ row: -1, reason: e })) };
  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const upserts: Record<string, unknown>[] = [];
  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    if (isSummaryRow(raw)) continue;
    const shopId = pick(raw, ["shop_id"]);
    if (!shopId) {
      report.skipped.push({ row: rowNum, reason: "shop_id kosong" });
      continue;
    }
    upserts.push({
      shop_id: shopId,
      shop_name: pick(raw, ["shop_name"]) || null,
      level2_categories: pick(raw, ["level_2_categories_(unique)", "level_2_categories", "level2_categories"]) || null,
      total_collaborated_creators: parseCount(pick(raw, ["total_collaborated_creators"])),
    });
    report.inserted++;
  }

  for (let i = 0; i < upserts.length; i += 500) {
    // Upsert only the platform-owned columns; deal fields stay untouched.
    const { error } = await admin
      .from("cooperating_shops")
      .upsert(upserts.slice(i, i + 500), { onConflict: "shop_id" });
    if (error) throw new Error(`Gagal refresh cooperating_shops: ${error.message}`);
  }

  // Recompute active_flag only where deal_end is known (BUILD_PLAN Fase 1 rule).
  await admin.from("cooperating_shops").update({ active_flag: false }).lt("deal_end", today);
  await admin.from("cooperating_shops").update({ active_flag: true }).gte("deal_end", today);

  await writeAudit({
    actorId: actor.id,
    action: "m4.refresh_cooperating_shops",
    entityType: "cooperating_shops",
    entityId: null,
    after: { shops: report.inserted },
    type: "auto",
  });

  revalidatePath("/link-leakage");
  return report;
}

interface LeakDetailRow {
  week: string;
  creator_id: string;
  shop_id: string;
  shop_name: string | null;
  product_id: string;
  product_name: string | null;
  gmv_bocor: number | null;
  link_status: string;
}

/** RFC 4180 CSV field escape (quote + double inner quotes). */
function csvCell(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Server action: export per-product leak DETAIL (leakage_products) as CSV within
 * the retention window. Optional filters creator_id / week narrow the export;
 * omitted → everything still retained. Read-only, RBAC via m4.view. Columns match
 * the on-screen detail table (task §4).
 */
export async function downloadLeakageCsv(formData: FormData): Promise<{ filename: string; csv: string }> {
  await requirePermission("m4.view");
  const creatorId = String(formData.get("creator_id") ?? "").trim() || null;
  const week = String(formData.get("week") ?? "").trim() || null;

  const admin = createAdminClient();
  const rows = await fetchAll<LeakDetailRow>(
    admin,
    "leakage_products",
    "week, creator_id, shop_id, shop_name, product_id, product_name, gmv_bocor, link_status",
    (q) => {
      let out = q;
      if (creatorId) out = out.eq("creator_id", creatorId);
      if (week) out = out.eq("week", week);
      return out.order("week", { ascending: false }).order("gmv_bocor", { ascending: false });
    }
  );

  const header = ["week", "creator", "shop_id", "shop_name", "product_id", "product_name", "gmv_bocor", "link_status"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(r.week),
      csvCell(r.creator_id),
      csvCell(r.shop_id),
      csvCell(r.shop_name),
      csvCell(r.product_id),
      csvCell(r.product_name),
      csvCell(r.gmv_bocor === null ? "" : Math.round(Number(r.gmv_bocor))),
      csvCell(r.link_status),
    ].join(","));
  }

  const suffix = [creatorId, week].filter(Boolean).join("_") || "all";
  return { filename: `leak-detail_${suffix}.csv`, csv: lines.join("\n") };
}

export type CreatorLeakDetailResult =
  | {
      ok: true;
      filename: string;
      csv: string;
      rows: number;
      /** `detail_table` = leakage_products (era engine); `export_backup` = CSV backup mingguan. */
      source: "detail_table" | "export_backup";
    }
  | { ok: false; error: string };

/** Slug aman untuk nama file unduhan (huruf/angka/dash saja). */
function fileSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "kreator";
}

/**
 * Detail produk bocor SATU kreator pada satu minggu, sebagai CSV (tombol "Detail" di
 * tabel Link Leakage CM Workspace).
 *
 * Dua sumber, dicoba berurutan — bukan dua rumus, hanya dua tempat penyimpanan hasil
 * dari engine yang sama (CLAUDE.md #4):
 *   1. `leakage_products` — detail per (shop, produk) era engine M4 lama.
 *   2. Backup CSV mingguan di bucket privat `leak-exports` — era "rollup saja", di mana
 *      detail per produk memang tidak masuk Postgres (0027). Baris disaring ke kreator
 *      ini lewat kolom `creator` (nama/username apa adanya dari file MCN).
 *
 * Read-only: tidak menulis apa pun, tidak menghitung ulang bocor. Mengembalikan union
 * (bukan throw) karena Next.js menyensor pesan error server action di production.
 *
 * Scope: sama seperti tabelnya di CM Workspace — CPM hanya boleh mengunduh detail
 * kreator yang dia pegang (owner_cpm_id), role lain lintas (§2F). Dicek di server,
 * bukan hanya di UI, karena creatorId datang dari client.
 */
export async function downloadCreatorLeakDetail(
  creatorIdRaw: unknown,
  weekRaw: unknown
): Promise<CreatorLeakDetailResult> {
  try {
    const actor = await requirePermission("m4.view");
    const creatorId = String(creatorIdRaw ?? "").trim();
    const week = String(weekRaw ?? "").trim();
    if (!creatorId) return { ok: false, error: "Kreator tidak dikenali." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return { ok: false, error: "Minggu tidak valid." };

    const admin = createAdminClient();
    const { data: creator } = await admin
      .from("creators")
      .select("id, name, username, owner_cpm_id")
      .eq("id", creatorId)
      .maybeSingle();
    if (!creator) return { ok: false, error: `Kreator ${creatorId} tidak ditemukan.` };
    if (actor.role === "cpm" && creator.owner_cpm_id !== actor.id) {
      return { ok: false, error: "Kreator ini di luar scope Anda." };
    }

    const filename = `leak-detail_${fileSlug(creator.username || creator.name || creatorId)}_${week}.csv`;

    // 1. Detail era engine (kalau minggu ini memang ditulis engine lama).
    const products = await fetchAll<LeakDetailRow>(
      admin,
      "leakage_products",
      "week, creator_id, shop_id, shop_name, product_id, product_name, gmv_bocor, link_status",
      (q) => q.eq("creator_id", creatorId).eq("week", week).order("gmv_bocor", { ascending: false })
    );
    if (products.length > 0) {
      const header = [...LEAK_DETAIL_CSV_HEADER];
      const lines = [header.join(",")];
      for (const r of products) {
        lines.push(
          [
            csvCell(r.week), csvCell(creator.name), csvCell(r.shop_id), csvCell(r.shop_name),
            csvCell(r.product_id), csvCell(r.product_name), csvCell(""), csvCell(""),
            csvCell(""), csvCell(""),
            csvCell(r.gmv_bocor === null ? "" : Math.round(Number(r.gmv_bocor))),
            csvCell(r.link_status),
          ].join(",")
        );
      }
      return {
        ok: true, filename, csv: `﻿${lines.join("\r\n")}`,
        rows: products.length, source: "detail_table",
      };
    }

    // 2. Backup CSV mingguan (era platform: detail per produk tidak ada di Postgres).
    const path = await findLeakDetailExport(admin, week);
    if (!path) {
      return {
        ok: false,
        error:
          `Detail per produk untuk minggu ${week} tidak tersedia. Backup CSV analisa hanya ` +
          "disimpan selama masa retensi (app_config retention.leak_export_days) — jalankan " +
          "ulang analisa minggu itu di /link-leakage untuk membuatnya kembali.",
      };
    }
    const { data: blob, error: dlError } = await admin.storage.from(LEAK_EXPORT_BUCKET).download(path);
    if (dlError || !blob) {
      return { ok: false, error: `Gagal membaca backup analisa minggu ${week}: ${dlError?.message ?? "file kosong"}.` };
    }

    const { csv, rows } = filterLeakDetailCsv(await blob.text(), [creator.username, creator.name]);
    if (rows === 0) {
      return {
        ok: false,
        error:
          `Tidak ada produk bocor tercatat untuk ${creator.name} di minggu ${week} ` +
          `(kreator ini mungkin 100% via agency link pada minggu tersebut).`,
      };
    }
    return { ok: true, filename, csv, rows, source: "export_backup" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menyiapkan detail bocor." };
  }
}
