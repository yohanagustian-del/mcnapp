import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadMasterProducts } from "./actions";
import { ProductsTable, SEGMENT_LABEL, type ProductRow } from "./products-table";
import { UploadTutorial } from "./upload-tutorial";

export const dynamic = "force-dynamic";

/**
 * Kolom yang dibaca tabel — sama persis dengan ProductRow, satu daftar saja.
 *
 * Hanya atribut master export TAP "Export link" + yang dibutuhkan form edit dan
 * wild search. Metrik performa (GMV, orders, komisi nominal, dst.) tetap ada di
 * `products_tap` tapi tidak ikut ditarik: tabel tidak menampilkannya, dan 1.000
 * baris × puluhan kolom angka adalah payload yang percuma dikirim ke browser.
 */
const SELECT_COLUMNS = [
  "product_id", "product_name", "shop_id", "shop_name",
  "level1_category", "level2_category", "price",
  "commission_pct", "commission_note", "partner_commission_pct",
  "creator_shop_ads_commission_pct", "partner_shop_ads_commission_pct", "product_link",
  "campaign_id", "campaign_name", "effective_start", "effective_end",
  "source", "active", "needs_review", "uploaded_by",
].join(", ");

/** Tim yang bisa dipakai menyaring katalog (nilai enum team_group_t). */
const TEAM_OPTIONS = [
  { value: "bizdev", label: "BizDev" },
  { value: "cm", label: "CM" },
  { value: "acquisition", label: "Acquisition" },
  { value: "management", label: "Management" },
  { value: "od", label: "OD" },
  { value: "support", label: "Support" },
  { value: "finance", label: "Finance" },
  { value: "external", label: "External" },
];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    level2?: string;
    segment?: string;
    review?: string;
    team?: string;
  }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/products");
  if (navItem && !canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canUpload = hasPermission("products.upload_master", member.role);
  const canEdit = hasPermission("products.edit", member.role);
  // Tabelnya sendiri terbuka untuk semua role yang lolos guard nav di atas; hanya
  // kolom Nama BD yang dibatasi BizDev ke atas.
  const canSeeOwner = hasPermission("products.view_owner_name", member.role);

  const { level2, segment, review, team } = await searchParams;
  const filterActive = Boolean(level2 || segment || team || review === "1");

  const supabase = await createClient();

  // Identitas peng-upload di-join di aplikasi, bukan lewat embed PostgREST:
  // team_members hanya puluhan baris, sekali baca jauh lebih murah (dan lebih
  // tahan perubahan nama constraint FK) daripada embed per query.
  const { data: memberRows } = await supabase
    .from("team_members")
    .select("id, name, team_group");
  const memberById = new Map(
    (memberRows ?? []).map((m) => [
      m.id as string,
      { name: m.name as string, team: m.team_group as string },
    ])
  );

  let query = supabase
    .from("products_tap")
    .select(SELECT_COLUMNS)
    // Urutan bawaan: produk penyumbang GMV terbesar dulu (produk tanpa metrik di
    // bawah), bukan sekadar yang terakhir terlihat — itu yang dicari saat matching.
    .order("affiliate_gmv", { ascending: false, nullsFirst: false })
    .order("last_seen", { ascending: false })
    // Tie-break wajib: export "Export link" tidak membawa metrik GMV sama sekali,
    // jadi tanpa ini SELURUH baris seri di dua kunci di atas dan Postgres bebas
    // memulangkan urutan berbeda tiap request — baris bisa lompat antar halaman.
    .order("campaign_id", { ascending: true, nullsFirst: false })
    .order("product_id", { ascending: true })
    .limit(1000);

  if (level2) query = query.ilike("level2_category", `%${level2}%`);
  if (segment) query = query.eq("price_segment", segment);
  if (review === "1") query = query.eq("needs_review", true);
  if (team) {
    // Tim disaring lewat pemiliknya. Kalau tim itu belum punya anggota, daftar id
    // kosong dan `.in()` dengan array kosong akan memulangkan 0 baris — memang
    // itu jawaban yang benar, bukan "tampilkan semua".
    const teamMemberIds = (memberRows ?? [])
      .filter((m) => m.team_group === team)
      .map((m) => m.id as string);
    query = query.in("uploaded_by", teamMemberIds);
  }

  const { data: products, error } = await query;

  const { data: categoryRows } = await supabase
    .from("products_tap")
    .select("level2_category")
    .not("level2_category", "is", null)
    .limit(1000);
  const categories = [...new Set((categoryRows ?? []).map((r) => r.level2_category).filter(Boolean))].sort();

  const rows = ((products ?? []) as unknown as ProductRow[]).map((p) => {
    const owner = p.uploaded_by ? memberById.get(p.uploaded_by) : undefined;
    return {
      ...p,
      // Batas kolom Nama BD ditegakkan di sini, bukan cuma dengan menyembunyikan
      // kolomnya di klien: untuk role di bawah BizDev namanya tidak pernah ikut
      // terkirim, jadi tidak bisa dibaca dari payload halaman.
      uploader_name: canSeeOwner ? (owner?.name ?? null) : null,
      uploader_team: canSeeOwner ? (owner?.team ?? null) : null,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Produk TAP</h1>
      <p className="mt-1 text-sm text-slate-500">
        Katalog produk TAP MEA — gabungan upload master product list (export TAP “Export link”) +
        derive otomatis dari file TAP mingguan (/ingest). Dipakai untuk Product×Creator Matching
        (rule-based, 0 token AI): cocokkan segmen harga kemampuan jual kreator dengan produk di
        segmen sama. Kolom tabel mengikuti export TAP “Export link” apa adanya; satu produk yang
        dipakai di beberapa campaign muncul sebagai baris terpisah per campaign, jadi upload satu
        tim tidak pernah menimpa milik tim lain.
        {canSeeOwner && (
          <>
            {" "}
            Kolom <strong>Nama BD</strong> menunjukkan akun yang meng-upload baris itu dan hanya
            tampil untuk BizDev ke atas.
          </>
        )}
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
              helpText='Terima langsung file export TAP "Export link" (Campaign ID, product name,
                Product ID, Sale price, Shop name, masa berlaku produk, rate komisi kreator & partner
                termasuk versi Shop Ads, Product link) MAUPUN export "Custom report" Partner Compass
                yang membawa metrik performa (Affiliate GMV total/video/live, Orders, Items sold,
                Collaborated creators, komisi estimasi & aktual, Settled GMV, refund, metrik Link).
                Kolom Shop ID dan kategori opsional. Rupiah campur (titik/koma ribuan), harga rentang
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
        <div>
          <label className="block text-xs text-slate-500">Tim (pemilik data)</label>
          <select
            name="team"
            defaultValue={team ?? ""}
            className="mt-1 w-44 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          >
            <option value="">Semua tim</option>
            {TEAM_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
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
        {/* Hapus filter = kembali ke /products tanpa query. Sengaja <Link>, bukan tombol
            reset form: reset hanya mengembalikan isi input ke nilai terakhir yang
            dikirim server, katalognya sendiri tetap tersaring. */}
        {filterActive ? (
          <Link
            href="/products"
            className="rounded-md border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Hapus Filter
          </Link>
        ) : (
          <span
            aria-disabled="true"
            title="Belum ada filter yang aktif"
            className="cursor-not-allowed rounded-md border border-slate-200 px-4 py-1.5 text-sm text-slate-300"
          >
            Hapus Filter
          </span>
        )}
      </form>

      {error && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat katalog produk: {error.message}
        </p>
      )}

      <div className="mt-6">
        <ProductsTable rows={rows} canEdit={canEdit} canSeeOwner={canSeeOwner} />
      </div>
    </div>
  );
}
