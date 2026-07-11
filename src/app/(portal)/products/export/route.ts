import { NextResponse } from "next/server";
import { requireMember, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * CSV export for /products — same filter semantics as the page (level2, segment,
 * review). review=1 wins outright and level2/segment are ignored (see the
 * needs_review/price_segment note on the page: every needs_review row has
 * price_segment NULL, so combining review with the old segment filter always
 * returned 0 rows).
 */

const PAGE_SIZE = 1000; // PostgREST caps a single select at 1000 rows.
const MAX_ROWS = 5000;
const IN_CHUNK = 200; // keep `.in()` filter lists well under URL length limits.

/** RFC 4180 CSV field escape (quote + double inner quotes). */
function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface ProductRow {
  product_id: string;
  product_name: string | null;
  shop_id: string;
  commission_pct: number | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Bulk lookup deal_products.product_link keyed by product_id — no N+1. */
async function fetchProductLinks(supabase: SupabaseClient, productIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const ids of chunk(productIds, IN_CHUNK)) {
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("deal_products")
      .select("product_id, product_link")
      .in("product_id", ids)
      .not("product_link", "is", null);
    if (error) throw new Error(`export: deal_products lookup gagal: ${error.message}`);
    for (const row of data ?? []) {
      const pid = row.product_id as string | null;
      const link = row.product_link as string | null;
      if (pid && link && !map.has(pid)) map.set(pid, link);
    }
  }
  return map;
}

/** Bulk fallback lookup brand_deals.link_tap keyed by shop_id — no N+1. */
async function fetchShopLinks(supabase: SupabaseClient, shopIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const ids of chunk(shopIds, IN_CHUNK)) {
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("brand_deals")
      .select("shop_id, link_tap")
      .in("shop_id", ids)
      .not("link_tap", "is", null);
    if (error) throw new Error(`export: brand_deals lookup gagal: ${error.message}`);
    for (const row of data ?? []) {
      const sid = row.shop_id as string | null;
      const link = row.link_tap as string | null;
      if (sid && link && !map.has(sid)) map.set(sid, link);
    }
  }
  return map;
}

export async function GET(request: Request) {
  // Same guard as the /products page (requireMember + canAccessNav), but a route
  // handler can't render a redirect-to-dashboard UX — unauthorized access returns 403.
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/products");
  if (navItem && !canAccessNav(navItem, member.role)) {
    return NextResponse.json({ error: "Akses ditolak" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const level2 = searchParams.get("level2");
  const segment = searchParams.get("segment");
  const review = searchParams.get("review");
  const isReviewMode = review === "1";

  const supabase = await createClient();

  const products: ProductRow[] = [];
  for (let page = 0; products.length < MAX_ROWS; page++) {
    const rangeStart = page * PAGE_SIZE;
    const rangeEnd = Math.min(rangeStart + PAGE_SIZE, MAX_ROWS) - 1;
    let q = supabase
      .from("products_tap")
      .select("product_id, product_name, shop_id, commission_pct")
      .order("last_seen", { ascending: false })
      .range(rangeStart, rangeEnd);

    if (isReviewMode) {
      q = q.eq("needs_review", true);
    } else {
      if (level2) q = q.ilike("level2_category", `%${level2}%`);
      if (segment) q = q.eq("price_segment", segment);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    products.push(...((data ?? []) as ProductRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const productIds = [...new Set(products.map((p) => p.product_id).filter(Boolean))];
  const shopIds = [...new Set(products.map((p) => p.shop_id).filter(Boolean))];

  const [linkByProduct, linkByShop] = await Promise.all([
    fetchProductLinks(supabase, productIds),
    fetchShopLinks(supabase, shopIds),
  ]);

  const header = ["PID", "Nama Produk", "Komisi (%)", "Agency Link"];
  const lines = [header.join(",")];
  for (const p of products) {
    const agencyLink = linkByProduct.get(p.product_id) ?? linkByShop.get(p.shop_id) ?? "";
    lines.push(
      [
        csvCell(p.product_id),
        csvCell(p.product_name),
        csvCell(p.commission_pct == null ? "" : Number(p.commission_pct)),
        csvCell(agencyLink),
      ].join(",")
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  // BOM supaya Excel membaca CSV ini sebagai UTF-8 (nama produk bisa non-ASCII).
  return new NextResponse("\uFEFF" + lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="produk-tap-${today}.csv"`,
    },
  });
}
