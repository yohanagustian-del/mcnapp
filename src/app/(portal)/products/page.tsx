import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadMasterProducts } from "./actions";

export const dynamic = "force-dynamic";

function formatRp(v: number | null | undefined): string {
  return v != null ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

const SEGMENT_LABEL: Record<string, string> = {
  low: "Low (<180rb)",
  entry: "Entry (180rb-800rb)",
  sweet: "Sweet (800rb-3,6jt)",
  high: "High (3,6jt-8jt)",
  premium: "Premium (>8jt)",
};

const td = "px-3 py-2 whitespace-nowrap";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ level2?: string; segment?: string; review?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/products");
  if (navItem && !canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canUpload = hasPermission("products.upload_master", member.role);

  const { level2, segment, review } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("products_tap")
    .select(
      "product_id, product_name, shop_id, shop_name, level1_category, level2_category, price, price_segment, commission_pct, commission_note, source, active, needs_review, first_seen, last_seen"
    )
    .order("last_seen", { ascending: false })
    .limit(500);

  if (level2) query = query.ilike("level2_category", `%${level2}%`);
  if (segment) query = query.eq("price_segment", segment);
  if (review === "1") query = query.eq("needs_review", true);

  const { data: products } = await query;

  const { data: categoryRows } = await supabase
    .from("products_tap")
    .select("level2_category")
    .not("level2_category", "is", null)
    .limit(1000);
  const categories = [...new Set((categoryRows ?? []).map((r) => r.level2_category).filter(Boolean))].sort();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Produk TAP</h1>
      <p className="mt-1 text-sm text-slate-500">
        Katalog produk TAP MEA — gabungan upload master product list + derive otomatis dari file TAP
        mingguan (/ingest). Dipakai untuk Product×Creator Matching (rule-based, 0 token AI): cocokkan
        segmen harga kemampuan jual kreator dengan produk di segmen sama.
      </p>

      {canUpload && (
        <div className="mt-6">
          <CsvUploadForm
            action={uploadMasterProducts}
            buttonLabel="Upload Master Product List"
            helpText='Kolom yang dikenali: Product ID, Product Name, Shop ID, Shop Name, Level 1 Category,
              Level 2 Category, Price/Harga, Commission/Komisi. Rupiah campur (titik/koma ribuan) & komisi
              kotor ("not found", "5-7%") ditangani otomatis dengan flag "perlu review", tidak crash.
              Baris "Summary" dilewati. Segmen harga dihitung dari Price memakai app_config
              segments.price_bounds.'
          />
        </div>
      )}

      <form className="mt-6 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" method="get">
        <div>
          <label className="block text-xs text-slate-500">Kategori (Level 2)</label>
          <input
            name="level2"
            defaultValue={level2 ?? ""}
            list="level2-options"
            placeholder="cth: Skincare Serum"
            className="mt-1 w-56 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
          <datalist id="level2-options">
            {categories.map((c) => (
              <option key={c} value={c ?? ""} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="block text-xs text-slate-500">Segmen Harga</label>
          <select name="segment" defaultValue={segment ?? ""} className="mt-1 w-48 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">Semua segmen</option>
            {Object.entries(SEGMENT_LABEL).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="review" value="1" defaultChecked={review === "1"} />
          Perlu review saja
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700">
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Produk</th>
              <th className="px-3 py-3">Shop</th>
              <th className="px-3 py-3">Kategori L1/L2</th>
              <th className="px-3 py-3">Harga</th>
              <th className="px-3 py-3">Segmen</th>
              <th className="px-3 py-3">Komisi</th>
              <th className="px-3 py-3">Sumber</th>
              <th className="px-3 py-3">Terakhir Terlihat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(products ?? []).map((p) => (
              <tr key={p.product_id} className={p.needs_review ? "bg-amber-50" : undefined}>
                <td className={`${td} font-medium`}>
                  {p.product_name ?? "—"}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{p.product_id}</span>
                </td>
                <td className={td}>
                  {p.shop_name ?? "—"}
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{p.shop_id}</span>
                </td>
                <td className={td}>{[p.level1_category, p.level2_category].filter(Boolean).join(" / ") || "—"}</td>
                <td className={td}>{formatRp(p.price)}</td>
                <td className={td}>{p.price_segment ? SEGMENT_LABEL[p.price_segment] ?? p.price_segment : "—"}</td>
                <td className={td}>
                  {p.commission_pct != null ? `${Number(p.commission_pct).toFixed(1)}%` : "—"}
                  {p.commission_note && (
                    <span className="ml-1 text-xs text-amber-600" title={p.commission_note}>
                      ⚠ {p.commission_note}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      p.source === "master_upload" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {p.source === "master_upload" ? "Master Upload" : "Derive TAP"}
                  </span>
                  {!p.active && <span className="ml-1 text-xs text-red-600">nonaktif</span>}
                </td>
                <td className={td}>{p.last_seen ?? "—"}</td>
              </tr>
            ))}
            {(products ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Belum ada produk TAP. Upload master list atau tunggu ingest mingguan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
