import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadMasterProducts } from "./actions";
import { ProductsTable, SEGMENT_LABEL, type ProductRow } from "./products-table";
import { UploadTutorial } from "./upload-tutorial";

export const dynamic = "force-dynamic";

/** Kolom yang dibaca tabel — sama persis dengan ProductRow, satu daftar saja. */
const SELECT_COLUMNS = [
  "product_id", "product_name", "shop_id", "shop_name",
  "level1_category", "level2_category", "price", "price_segment",
  "commission_pct", "commission_note", "partner_commission_pct", "product_link",
  "campaign_name", "campaign_count", "period_start", "period_end",
  "affiliate_gmv", "affiliate_video_gmv", "affiliate_live_gmv",
  "settled_gmv", "gmv_refund", "revenue_showcase",
  "orders", "items_sold",
  "collaborated_creators", "creators_with_posts", "creators_with_sales",
  "est_partner_commission", "actual_partner_commission",
  "est_creator_commission", "actual_creator_commission",
  "link_gmv", "link_items_sold", "link_orders",
  "source", "active", "needs_review", "first_seen", "last_seen",
].join(", ");

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ level2?: string; segment?: string; review?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/products");
  if (navItem && !canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canUpload = hasPermission("products.upload_master", member.role);
  const canEdit = hasPermission("products.edit", member.role);

  const { level2, segment, review } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("products_tap")
    .select(SELECT_COLUMNS)
    // Urutan bawaan: produk penyumbang GMV terbesar dulu (produk tanpa metrik di
    // bawah), bukan sekadar yang terakhir terlihat — itu yang dicari saat matching.
    .order("affiliate_gmv", { ascending: false, nullsFirst: false })
    .order("last_seen", { ascending: false })
    .limit(1000);

  if (level2) query = query.ilike("level2_category", `%${level2}%`);
  if (segment) query = query.eq("price_segment", segment);
  if (review === "1") query = query.eq("needs_review", true);

  const { data: products, error } = await query;

  const { data: categoryRows } = await supabase
    .from("products_tap")
    .select("level2_category")
    .not("level2_category", "is", null)
    .limit(1000);
  const categories = [...new Set((categoryRows ?? []).map((r) => r.level2_category).filter(Boolean))].sort();

  const rows = (products ?? []) as unknown as ProductRow[];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Produk TAP</h1>
      <p className="mt-1 text-sm text-slate-500">
        Katalog produk TAP MEA — gabungan upload custom report TikTok Partner Compass + derive
        otomatis dari file TAP mingguan (/ingest). Dipakai untuk Product×Creator Matching
        (rule-based, 0 token AI): cocokkan segmen harga kemampuan jual kreator dengan produk di
        segmen sama.
      </p>

      {canUpload && (
        <>
          <div className="mt-6">
            <UploadTutorial />
          </div>

          <div className="mt-4">
            <CsvUploadForm
              action={uploadMasterProducts}
              buttonLabel="Upload Master Product List"
              helpText='Terima langsung export "Custom report" TikTok Partner Compass (Product ID, Product
                name, Shop, Level 1/2 category, Affiliate GMV total/video/live, Orders, Items sold,
                Collaborated creators, komisi estimasi & aktual, Settled GMV, refund, metrik Link)
                MAUPUN campaign product list (Sale price, Creator/Partner commission rate, masa berlaku,
                link produk). Kolom Shop opsional. Rupiah campur (titik/koma ribuan), harga rentang
                varian, dan komisi kotor ("not found", "5-7%") ditangani otomatis dengan flag "perlu
                review", tidak crash. Baris "Summary" dilewati. Segmen harga dihitung dari harga memakai
                app_config segments.price_bounds.'
            />
          </div>
        </>
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

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat katalog produk: {error.message}
        </p>
      )}

      <div className="mt-6">
        <ProductsTable rows={rows} canEdit={canEdit} />
      </div>
    </div>
  );
}
