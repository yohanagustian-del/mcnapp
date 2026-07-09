import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

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
    .select(
      "id, brand_name, shop_id, niche, exp_date, komisi_kreator_raw, komisi_mea_raw, ads_budget, service_fee, campaign_type, sourced_by_role, status, review_flags, created_at"
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

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">ID</th>
              <th className="px-3 py-3">Brand</th>
              <th className="px-3 py-3">Shop ID</th>
              <th className="px-3 py-3">Niche</th>
              <th className="px-3 py-3">Exp Date</th>
              <th className="px-3 py-3">Komisi Kreator</th>
              <th className="px-3 py-3">Komisi MEA</th>
              <th className="px-3 py-3">Ads Budget</th>
              <th className="px-3 py-3">Service Fee</th>
              <th className="px-3 py-3">Produk</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(deals ?? []).map((d) => {
              const flags = (d.review_flags as string[] | null) ?? [];
              return (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/deals/${d.id}`} className="text-blue-700 underline">
                      {d.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/deals/${d.id}`} className="hover:underline">
                      {d.brand_name}
                    </Link>
                    {d.sourced_by_role === "cm" && (
                      <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                        via CM
                      </span>
                    )}
                    {d.campaign_type && d.campaign_type !== "paid" && (
                      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
                        {d.campaign_type === "sample" ? "sample" : "komisi extra"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{d.shop_id ?? "—"}</td>
                  <td className="px-3 py-2">{d.niche ?? "—"}</td>
                  <td className="px-3 py-2">{d.exp_date ?? "—"}</td>
                  <td className="px-3 py-2">{d.komisi_kreator_raw ?? "—"}</td>
                  <td className="px-3 py-2">{d.komisi_mea_raw ?? "—"}</td>
                  <td className="px-3 py-2">{formatRp(d.ads_budget)}</td>
                  <td className="px-3 py-2">{formatRp(d.service_fee)}</td>
                  <td className="px-3 py-2 text-center">{productCounts.get(d.id) ?? 0}</td>
                  <td className="px-3 py-2">{d.status ?? "—"}</td>
                  <td className="px-3 py-2">
                    {flags.length > 0 ? (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                        title={flags.join("; ")}
                      >
                        {flags.length} flag
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {(deals ?? []).length === 0 && (
              <tr>
                <td colSpan={12} className="px-4 py-6 text-center text-slate-400">
                  {q
                    ? `Tidak ada brand cocok dengan "${q}".`
                    : "Belum ada deal. Registrasi lewat form atau import master deal lama."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
