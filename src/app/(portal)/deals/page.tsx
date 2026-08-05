import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { DealsTable, type DealRow } from "./deals-table";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/deals")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("brand_deals")
    // Satu string literal (bukan concat): tipe hasil select disimpulkan dari literalnya.
    .select(
      "id, brand_name, shop_id, niche, exp_date, komisi_kreator_raw, komisi_kreator_pct, komisi_mea_raw, komisi_mea_pct, ads_budget, service_fee, gmv_tap, avg_price, campaign_name, campaign_type, sourced_by_role, status, notes, review_flags, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`brand_name.ilike.${term},shop_id.ilike.${term},niche.ilike.${term}`);
  }
  const { data: deals } = await query;

  // Jumlah produk per deal (1 brand mendaftarkan >1 produk)
  const dealIds = (deals ?? []).map((d) => d.id);
  const productCounts = new Map<string, number>();
  if (dealIds.length > 0) {
    const { data: products } = await supabase
      .from("deal_products")
      .select("deal_id")
      .in("deal_id", dealIds);
    for (const p of products ?? []) {
      productCounts.set(p.deal_id, (productCounts.get(p.deal_id) ?? 0) + 1);
    }
  }

  const canRegister = hasPermission("deals.register", member.role);
  const canEdit = hasPermission("deals.edit", member.role);

  const rows: DealRow[] = (deals ?? []).map((d) => ({
    ...d,
    review_flags: (d.review_flags as string[] | null) ?? [],
    productCount: productCounts.get(d.id) ?? 0,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deal Brand</h1>
          <p className="mt-1 text-sm text-slate-500">
            List brand kerjasama. Klik brand untuk melihat produk yang didaftarkan.
          </p>
        </div>
        {canRegister && (
          <Link
            href="/deals/baru"
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            + Registrasi Deal
          </Link>
        )}
      </div>

      <form method="get" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari brand / shop ID / niche…"
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
        >
          Cari
        </button>
        {q && (
          <Link href="/deals" className="self-center text-sm text-slate-500 underline">
            Reset
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-slate-400">
        Klik judul kolom untuk mengurutkan (naik → turun → urutan bawaan).
      </p>

      <div className="mt-2">
        <DealsTable
          rows={rows}
          canEdit={canEdit}
          emptyMessage={
            q
              ? `Tidak ada brand cocok dengan "${q}".`
              : "Belum ada deal. Registrasi lewat form atau import master deal lama."
          }
        />
      </div>
    </div>
  );
}
