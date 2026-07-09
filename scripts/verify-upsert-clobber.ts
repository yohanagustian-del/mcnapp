/**
 * ONE-TIME VERIFICATION (HANDOFF risk check, not a permanent script): confirms
 * against the REMOTE Supabase DB that the partial-column bulk upsert used by
 * upsertDerivedFromTap's "master refresh" path (src/lib/m10/products.ts) does
 * NOT clobber/NULL master columns on products_tap when it re-sends only a
 * subset of columns for a row that already has source='master_upload'.
 *
 * products_tap PK is `product_id` (text) — no composite key (supabase/migrations/
 * 0019_products_tap.sql). The master-refresh shape sent by upsertDerivedFromTap
 * (src/lib/m10/products.ts, masterRefreshRows) is exactly:
 *   { product_id, source, first_seen, last_seen, updated_at }
 * onConflict: "product_id"
 *
 * This script:
 *   1. Upserts one FULL row (all master columns filled with sentinel values)
 *      under product_id 'QA-CLOBBER-TEST-1'.
 *   2. Upserts a SECOND time with ONLY the master-refresh column subset above
 *      (same onConflict), mirroring upsertDerivedFromTap exactly.
 *   3. Re-reads the row and asserts every master column NOT in the subset is
 *      unchanged (not null, not overwritten).
 *   4. ALWAYS deletes the test row in a finally block, regardless of outcome.
 *
 * DO NOT RUN AUTOMATICALLY — one-time manual verification only.
 *
 * Run with:
 *   npx tsx scripts/verify-upsert-clobber.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * (same loader pattern as scripts/backfill-avg-gmv.ts).
 */
import { readFileSync } from "fs";

// ---- Load .env.local the same way backfill-avg-gmv.ts does ----
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const TEST_PRODUCT_ID = "QA-CLOBBER-TEST-1";

const MASTER_SENTINEL = {
  product_id: TEST_PRODUCT_ID,
  product_name: "QA CLOBBER MASTER",
  shop_id: "QA-SHOP-CLOBBER-1",
  shop_name: "QA Clobber Shop",
  level1_category: "QA Level1 Master",
  level2_category: "QA Level2 Master",
  price: 123456,
  price_segment: "sweet" as const,
  commission_pct: 12.5,
  commission_note: "QA sentinel note — should survive derived upsert",
  source: "master_upload" as const,
  active: true,
  needs_review: false,
  first_seen: "2025-01-01",
  last_seen: "2025-01-01",
  updated_at: new Date("2025-01-01T00:00:00Z").toISOString(),
};

// Exactly the masterRefreshRows shape from upsertDerivedFromTap (src/lib/m10/products.ts).
const DERIVED_MASTER_REFRESH_SUBSET = {
  product_id: TEST_PRODUCT_ID,
  source: "master_upload" as const,
  first_seen: "2025-01-01", // existing.first_seen ?? week
  last_seen: "2026-07-06", // week (simulated new TAP upload week)
  updated_at: new Date().toISOString(),
};

const MASTER_COLUMNS_NOT_IN_SUBSET = [
  "product_name",
  "shop_id",
  "shop_name",
  "level1_category",
  "level2_category",
  "price",
  "price_segment",
  "commission_pct",
  "commission_note",
  "active",
  "needs_review",
] as const;

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  console.log(`onConflict key under test: product_id`);
  console.log(`Derived (partial) upsert column set: ${Object.keys(DERIVED_MASTER_REFRESH_SUBSET).join(", ")}`);
  console.log(`Master columns expected to survive untouched: ${MASTER_COLUMNS_NOT_IN_SUBSET.join(", ")}\n`);

  let allPass = true;

  try {
    // ---- Step 1: seed FULL master row ----
    const { error: seedError } = await admin
      .from("products_tap")
      .upsert(MASTER_SENTINEL, { onConflict: "product_id" });
    if (seedError) throw new Error(`Gagal seed baris master penuh: ${seedError.message}`);
    console.log(`Step 1 OK: baris master penuh di-seed untuk product_id=${TEST_PRODUCT_ID}`);

    // sanity: confirm seed actually landed as expected before the real test
    const { data: seeded, error: seededReadError } = await admin
      .from("products_tap")
      .select("*")
      .eq("product_id", TEST_PRODUCT_ID)
      .maybeSingle();
    if (seededReadError) throw new Error(`Gagal membaca baris seed: ${seededReadError.message}`);
    if (!seeded) throw new Error("Baris seed tidak ditemukan setelah upsert — tidak bisa lanjut.");

    // ---- Step 2: partial-column upsert, exact shape from upsertDerivedFromTap ----
    const { error: partialError } = await admin
      .from("products_tap")
      .upsert(DERIVED_MASTER_REFRESH_SUBSET, { onConflict: "product_id" });
    if (partialError) throw new Error(`Gagal upsert partial (derived subset): ${partialError.message}`);
    console.log(`Step 2 OK: upsert partial-column (bentuk derived master-refresh) dijalankan.\n`);

    // ---- Step 3: re-read + assert master columns unchanged ----
    const { data: after, error: afterError } = await admin
      .from("products_tap")
      .select("*")
      .eq("product_id", TEST_PRODUCT_ID)
      .maybeSingle();
    if (afterError) throw new Error(`Gagal membaca baris setelah upsert partial: ${afterError.message}`);
    if (!after) throw new Error("Baris hilang setelah upsert partial — tidak seharusnya terjadi.");

    console.log("=== Hasil per kolom master ===");
    for (const col of MASTER_COLUMNS_NOT_IN_SUBSET) {
      const expected = (MASTER_SENTINEL as Record<string, unknown>)[col];
      const actual = (after as Record<string, unknown>)[col];
      const pass = actual === expected;
      if (!pass) allPass = false;
      console.log(
        `${pass ? "PASS" : "FAIL"}  ${col}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
      );
    }

    // Also verify the columns we DID send actually updated (sanity the upsert applied at all).
    console.log("\n=== Sanity: kolom yang memang dikirim di upsert kedua ===");
    for (const col of ["last_seen", "updated_at"] as const) {
      const expected = (DERIVED_MASTER_REFRESH_SUBSET as Record<string, unknown>)[col];
      const actual = (after as Record<string, unknown>)[col];
      const pass = actual === expected;
      if (!pass) allPass = false;
      console.log(
        `${pass ? "PASS" : "FAIL"}  ${col}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`
      );
    }
    // source is re-asserted (same value) — confirm it's still 'master_upload', never downgraded.
    {
      const pass = after.source === "master_upload";
      if (!pass) allPass = false;
      console.log(`${pass ? "PASS" : "FAIL"}  source: expected="master_upload" actual=${JSON.stringify(after.source)}`);
    }

    console.log(`\n=== KESIMPULAN: ${allPass ? "PASS — tidak ada clobber" : "FAIL — clobber terdeteksi"} ===`);
  } finally {
    // ---- Step 4: mandatory cleanup, runs regardless of pass/fail/throw ----
    const { error: deleteError, count } = await admin
      .from("products_tap")
      .delete({ count: "exact" })
      .eq("product_id", TEST_PRODUCT_ID);
    if (deleteError) {
      console.error(`CLEANUP GAGAL: tidak bisa menghapus baris test ${TEST_PRODUCT_ID}: ${deleteError.message}`);
      console.error("HARAP HAPUS MANUAL baris ini dari products_tap.");
    } else {
      console.log(`Cleanup OK: baris test ${TEST_PRODUCT_ID} dihapus (${count ?? "?"} baris terhapus).`);
    }
  }

  if (!allPass) process.exit(1);
}

main().catch((e) => {
  console.error("Verifikasi gagal total:", e);
  process.exit(1);
});
