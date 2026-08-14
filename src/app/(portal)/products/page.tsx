import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadMasterProducts } from "./actions";
import { ProductsTable, type ProductRow } from "./products-table";
import { UploadTutorial } from "./upload-tutorial";

export const dynamic = "force-dynamic";

/**
 * Kolom yang dibaca tabel — sama persis dengan ProductRow, satu daftar saja.
 *
 * Hanya atribut master export TAP "Export link", dimensi kartu deal (tipe campaign,
 * ads budget, service fee, deal by, PIC TAP), dan yang dibutuhkan form edit + wild
 * search. Metrik performa (GMV, orders, komisi nominal, dst.) tetap ada di
 * `products_tap` tapi tidak ikut ditarik: tabel tidak menampilkannya, dan 1.000
 * baris × puluhan kolom angka adalah payload yang percuma dikirim ke browser.
 */
const SELECT_COLUMNS = [
  "product_id", "product_name", "shop_id", "shop_name",
  "level1_category", "level2_category", "price",
  "commission_pct", "commission_note", "partner_commission_pct",
  "creator_shop_ads_commission_pct", "partner_shop_ads_commission_pct", "product_link",
  "campaign_id", "campaign_name", "effective_start", "effective_end",
  "campaign_type", "ads_budget", "service_fee", "deal_by", "pic_tap",
  "source", "active", "needs_review", "uploaded_by",
].join(", ");

export default async function ProductsPage() {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/products");
  if (navItem && !canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canUpload = hasPermission("products.upload_master", member.role);
  const canEdit = hasPermission("products.edit", member.role);
  // Tabelnya sendiri terbuka untuk semua role yang lolos guard nav di atas; hanya
  // kolom Nama BD yang dibatasi BizDev ke atas.
  const canSeeOwner = hasPermission("products.view_owner_name", member.role);

  const supabase = await createClient();

  // Identitas peng-input / deal by / PIC TAP di-join di aplikasi, bukan lewat embed
  // PostgREST: team_members hanya puluhan baris, sekali baca jauh lebih murah (dan
  // lebih tahan perubahan nama constraint FK) daripada tiga embed sekaligus.
  const { data: memberRows } = await supabase
    .from("team_members")
    .select("id, name, team_group");
  const memberById = new Map(
    (memberRows ?? []).map((m) => [
      m.id as string,
      { name: m.name as string, team: m.team_group as string },
    ])
  );

  const { data: products, error } = await supabase
    .from("products_tap")
    .select(SELECT_COLUMNS)
    // Urutan bawaan: produk penyumbang GMV terbesar dulu (produk tanpa metrik di
    // bawah), bukan sekadar yang terakhir terlihat — itu yang dicari saat matching.
    .order("affiliate_gmv", { ascending: false, nullsFirst: false })
    // Kartu yang baru didaftarkan lewat Registrasi Deal punya last_seen hari ini,
    // jadi ia muncul di bagian atas katalog tanpa perlu dicari dulu.
    .order("last_seen", { ascending: false })
    // Tie-break wajib: export "Export link" tidak membawa metrik GMV sama sekali,
    // jadi tanpa ini SELURUH baris seri di dua kunci di atas dan Postgres bebas
    // memulangkan urutan berbeda tiap request — baris bisa lompat antar halaman.
    .order("campaign_id", { ascending: true, nullsFirst: false })
    .order("product_id", { ascending: true })
    .limit(1000);

  const rows = ((products ?? []) as unknown as ProductRow[]).map((p) => {
    const owner = p.uploaded_by ? memberById.get(p.uploaded_by) : undefined;
    return {
      ...p,
      // Batas kolom Nama BD ditegakkan di sini, bukan cuma dengan menyembunyikan
      // kolomnya di klien: untuk role di bawah BizDev namanya tidak pernah ikut
      // terkirim, jadi tidak bisa dibaca dari payload halaman.
      uploader_name: canSeeOwner ? (owner?.name ?? null) : null,
      uploader_team: canSeeOwner ? (owner?.team ?? null) : null,
      // Deal by & PIC TAP bukan identitas pemilik data melainkan atribut deal, jadi
      // tidak ikut dibatasi: semua role yang boleh membuka katalog boleh melihatnya.
      deal_by_name: p.deal_by ? (memberById.get(p.deal_by)?.name ?? null) : null,
      pic_tap_name: p.pic_tap ? (memberById.get(p.pic_tap)?.name ?? null) : null,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Produk TAP</h1>
      <p className="mt-1 text-sm text-slate-500">
        Katalog produk TAP MEA — gabungan kartu dari form Registrasi Deal, upload master product
        list (export TAP “Export link”), dan derive otomatis dari file TAP mingguan (/ingest).
        Dipakai untuk Product×Creator Matching (rule-based, 0 token AI): cocokkan segmen harga
        kemampuan jual kreator dengan produk di segmen sama. Satu produk yang dipakai di beberapa
        campaign muncul sebagai baris terpisah per campaign, jadi input satu tim tidak pernah
        menimpa milik tim lain. Kolom yang ditampilkan bisa dipilih lewat menu{" "}
        <strong>Kolom</strong>.
        {canSeeOwner && (
          <>
            {" "}
            Kolom <strong>Nama BD</strong> menunjukkan akun yang menginput baris itu dan hanya
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
