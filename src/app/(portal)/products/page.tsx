import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadMasterProducts } from "./actions";
import { getCachedLevel2Categories } from "@/lib/cached";

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
  // Bug fix (2026-07-11): every needs_review=true row has price_segment NULL (flag muncul
  // persis saat harga tak terbaca), jadi kombinasi review=1 + segment/level2 lama selalu 0
  // baris. Mode review sekarang eksklusif — server mengabaikan level2/segment saat aktif.
  const isReviewMode = review === "1";

  const supabase = await createClient();
  let query = supabase
    .from("products_tap")
    .select(
      "product_id, product_name, shop_id, shop_name, level1_category, level2_category, price, price_segment, commission_pct, commission_note, source, active, needs_review, first_seen, last_seen"
    )
    .order("last_seen", { ascending: false })
    .limit(500);

  let resultCountQuery = supabase.from("products_tap").select("product_id", { count: "exact", head: true });

  if (isReviewMode) {
    query = query.eq("needs_review", true);
    resultCountQuery = resultCountQuery.eq("needs_review", true);
  } else {
    if (level2) {
      query = query.ilike("level2_category", `%${level2}%`);
      resultCountQuery = resultCountQuery.ilike("level2_category", `%${level2}%`);
    }
    if (segment) {
      query = query.eq("price_segment", segment);
      resultCountQuery = resultCountQuery.eq("price_segment", segment);
    }
  }

  const reviewCountQuery = supabase
    .from("products_tap")
    .select("product_id", { count: "exact", head: true })
    .eq("needs_review", true);

  const [{ data: products }, { count: resultCount }, { count: reviewCount }, categories] = await Promise.all([
    query,
    resultCountQuery,
    reviewCountQuery,
    getCachedLevel2Categories(),
  ]);

  const exportParams = new URLSearchParams();
  if (isReviewMode) {
    exportParams.set("review", "1");
  } else {
    if (level2) exportParams.set("level2", level2);
    if (segment) exportParams.set("segment", segment);
  }
  const exportHref = `/products/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;

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

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4" method="get">
          <div>
            <label className="block text-xs text-slate-500">Kategori (Level 2)</label>
            <input
              name="level2"
              defaultValue={isReviewMode ? "" : level2 ?? ""}
              list="level2-options"
              placeholder="cth: Skincare Serum"
              disabled={isReviewMode}
              className="mt-1 w-56 rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            />
            <datalist id="level2-options">
              {categories.map((c) => (
                <option key={c} value={c ?? ""} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-slate-500">Segmen Harga</label>
            <select
              name="segment"
              defaultValue={isReviewMode ? "" : segment ?? ""}
              disabled={isReviewMode}
              className="mt-1 w-48 rounded-md border border-slate-200 px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
            >
              <option value="">Semua segmen</option>
              {Object.entries(SEGMENT_LABEL).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700">
            Filter
          </button>
        </form>

        <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-4">
          {isReviewMode ? (
            <>
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Mode review aktif ({reviewCount ?? 0})
              </span>
              <p className="text-xs text-slate-500">Mode review: filter kategori &amp; segmen dinonaktifkan</p>
              <a href="/products" className="w-fit text-xs font-medium text-slate-600 underline hover:text-slate-900">
                Reset filter
              </a>
            </>
          ) : (
            <a
              href="/products?review=1"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              Perlu review saja ({reviewCount ?? 0})
            </a>
          )}
        </div>

        <a
          href={exportHref}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download CSV
        </a>
      </div>

      <p className="mt-4 text-sm text-slate-500">
        Menampilkan {(products ?? []).length} dari {resultCount ?? 0} produk yang cocok.
      </p>

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">PID</th>
              <th className="px-3 py-3">Nama Produk</th>
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
                <td className={`${td} font-mono text-xs`}>{p.product_id}</td>
                <td className={`${td} max-w-[220px] truncate font-medium`} title={p.product_name ?? p.product_id}>
                  {p.product_name ?? "—"}
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
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
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
