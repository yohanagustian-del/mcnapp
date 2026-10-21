/**
 * Dry-run Import Bulk Deal Brand (keputusan Yohan 2026-10-20, docs/DECISIONS.md).
 *
 * SELALU dry-run: script ini hanya MEMBACA. Tidak ada mode tulis — apply/replace ke
 * produksi = langkah "Promote ke Produksi" terpisah setelah persetujuan Yohan.
 *
 * Pakai:
 *   # dari snapshot JSON (hasil SELECT read-only, mis. lewat Supabase SQL editor/MCP)
 *   npx tsx scripts/mcn-bulkload-dryrun.ts --sheet bulk.csv \
 *     --snapshot src/lib/deals/data/prod-snapshot-2026-10-20.json
 *
 *   # langsung dari database (SELECT saja) — butuh .env.local berisi
 *   # NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY environment yang dibandingkan
 *   npx tsx scripts/mcn-bulkload-dryrun.ts --sheet bulk.xlsx --live --env-label produksi
 *
 * Output: docs/reports/bulkload-dryrun-<tanggal>.md (atau --out <path>).
 * Sheet = export tab "DATA BULKING! UNTUK KO YOHAN" (.csv atau .xlsx).
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { parseBulkDealMatrix, readSheetMatrix } from "../src/lib/deals/bulk-deal-spec";
import {
  BRAND_DEAL_FK_REFS,
  planBulkDeals,
  type ExistingDeal,
  type TeamMemberLite,
} from "../src/lib/deals/bulk-deal-plan";
import { buildDryRunMarkdown } from "../src/lib/deals/bulk-deal-report";
import {
  DEFAULT_ADS_SUPPORT_OPTIONS,
  DEFAULT_LEADS_TYPE_OPTIONS,
  DEFAULT_NICHE_OPTIONS,
} from "../src/lib/deals/deal-options";
import { BIZDEV_ROLES } from "../src/lib/rbac-constants";

interface Snapshot {
  env: string;
  deals: ExistingDeal[];
  refs: Record<string, Record<string, number>>;
  members: TeamMemberLite[];
  projectShopIds: string[];
  handlers: Record<string, string[]>;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function loadLive(envLabel: string): Promise<Snapshot> {
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
    if (r.error) throw new Error(`${what}: ${r.error.message}`);
    return r.data as T;
  };
  const deals = must(await db.from("brand_deals").select("*"), "brand_deals") as ExistingDeal[];
  const refs: Snapshot["refs"] = {};
  for (const { table, column } of BRAND_DEAL_FK_REFS) {
    const rows = must(await db.from(table).select(column).not(column, "is", null), table) as unknown as Record<string, string>[];
    for (const r of rows) {
      const id = r[column];
      refs[id] = { ...(refs[id] ?? {}), [table]: (refs[id]?.[table] ?? 0) + 1 };
    }
  }
  const members = must(await db.from("team_members").select("id, name, role, active"), "team_members") as TeamMemberLite[];
  const map = must(await db.from("shop_key_map").select("platform, shop_id, shop_key").eq("platform", "tiktok"), "shop_key_map") as {
    shop_id: string;
    shop_key: string;
  }[];
  const keyToShop = new Map(map.map((m) => [m.shop_key, m.shop_id]));
  const projShops = must(await db.from("bd_project_shops").select("shop_key"), "bd_project_shops") as { shop_key: string }[];
  const handlerRows = must(
    await db.from("brand_bizdev_handlers").select("shop_key, team_members!brand_bizdev_handlers_member_id_fkey(name)"),
    "brand_bizdev_handlers"
  ) as unknown as { shop_key: string; team_members: { name: string } | null }[];
  const handlers: Record<string, string[]> = {};
  for (const h of handlerRows) {
    const shop = keyToShop.get(h.shop_key);
    if (shop && h.team_members) handlers[shop] = [...(handlers[shop] ?? []), h.team_members.name];
  }
  return {
    env: envLabel,
    deals,
    refs,
    members,
    projectShopIds: projShops.map((p) => keyToShop.get(p.shop_key)).filter((s): s is string => !!s),
    handlers,
  };
}

async function main() {
  if (process.argv.includes("--apply")) {
    throw new Error("Script ini hanya dry-run. Apply/replace = langkah Promote ke Produksi setelah persetujuan Yohan.");
  }
  const sheetPath = arg("sheet");
  if (!sheetPath) throw new Error("--sheet <file .csv/.xlsx> wajib");
  const snapPath = arg("snapshot");
  const snap: Snapshot = snapPath
    ? JSON.parse(readFileSync(snapPath, "utf8"))
    : process.argv.includes("--live")
      ? await loadLive(arg("env-label") ?? "environment")
      : (() => {
          throw new Error("Pilih --snapshot <json> atau --live");
        })();

  const buf = readFileSync(sheetPath);
  const matrix = sheetPath.toLowerCase().endsWith(".csv")
    ? readSheetMatrix(buf.toString("utf8"), sheetPath)
    : readSheetMatrix(new Uint8Array(buf), sheetPath);
  const parsed = parseBulkDealMatrix(matrix);
  if (parsed.errors.length) throw new Error(parsed.errors.join("\n"));

  const plan = planBulkDeals({
    parsed,
    existing: snap.deals,
    members: snap.members,
    bizdevRoles: BIZDEV_ROLES,
    projectShopIds: new Set(snap.projectShopIds),
    options: {
      adsSupport: DEFAULT_ADS_SUPPORT_OPTIONS,
      leadsType: DEFAULT_LEADS_TYPE_OPTIONS,
      niche: DEFAULT_NICHE_OPTIONS,
      fromDefaults: true,
    },
  });
  const generatedAt = new Date().toISOString();
  const md = buildDryRunMarkdown(plan, {
    sheetName: 'Google Sheet "All Brand TAP [Database Bizdev TikTok 2026]" — tab "DATA BULKING! UNTUK KO YOHAN"',
    envLabel: snap.env,
    generatedAt,
    sheetDataRows: parsed.rows.length + parsed.skipped.length,
    envRowCount: snap.deals.length,
    refs: snap.refs,
    handlers: snap.handlers,
  });
  const out = arg("out") ?? `docs/reports/bulkload-dryrun-${generatedAt.slice(0, 10)}.md`;
  writeFileSync(out, md);
  console.log(
    `Dry-run selesai → ${out}\n` +
      `insert ${plan.inserts.length} · update ${plan.updates.length} · sama ${plan.unchanged.length} · ` +
      `skip ${plan.skipped.length} · tidak ada di sheet ${plan.missingFromSheet.length}`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
