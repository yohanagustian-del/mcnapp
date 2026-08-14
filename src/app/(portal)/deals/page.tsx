import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { DealsTable, type DealRow } from "./deals-table";
import { ShopsTable, type ShopSummaryRow } from "./shops-table";

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

  // Ringkasan kartu Produk TAP per shop — deal BARU tidak lagi masuk brand_deals
  // melainkan jadi kartu produk (0041), jadi tanpa tabel ini tab Deal Brand hanya
  // memperlihatkan deal lama. Agregasinya dikerjakan view products_tap_shop_summary
  // (SQL, bukan JS): halaman ini cuma membaca baris yang sudah jadi.
  let shopQuery = supabase
    .from("products_tap_shop_summary")
    .select("*")
    .order("product_count", { ascending: false })
    .limit(200);
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    // Pencarian yang sama dengan kotak di atas: shop_key sudah berisi Shop Name
    // (atau "#shop_id" untuk baris tanpa nama), jadi dua filter ini cukup.
    shopQuery = shopQuery.or(`shop_key.ilike.${term},shop_name.ilike.${term},shop_id.ilike.${term}`);
  }
  const { data: shopSummary, error: shopError } = await shopQuery;

  // deal_by / pic_tap disimpan sebagai uuid di kartu produk; namanya di-join di
  // aplikasi karena team_members cuma puluhan baris (pola yang sama dipakai
  // halaman Produk TAP).
  const memberNameById = new Map<string, string>();
  if ((shopSummary ?? []).length > 0) {
    const { data: memberRows } = await supabase.from("team_members").select("id, name");
    for (const m of memberRows ?? []) memberNameById.set(m.id as string, m.name as string);
  }
  const names = (ids: unknown): string[] =>
    Array.isArray(ids)
      ? [...new Set(ids.map((id) => memberNameById.get(String(id))).filter((n): n is string => !!n))]
      : [];

  // numeric/bigint hasil agregasi bisa datang sebagai string tergantung driver;
  // dijadikan number di sini supaya pengurutan kolom di tabel membandingkan ANGKA,
  // bukan teks ("9" > "10" secara leksikografis).
  const numeric = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const shopRows: ShopSummaryRow[] = (shopSummary ?? []).map((s) => ({
    ...s,
    shop_id_count: numeric(s.shop_id_count) ?? 0,
    shop_id_missing: numeric(s.shop_id_missing) ?? 0,
    product_count: numeric(s.product_count) ?? 0,
    active_count: numeric(s.active_count) ?? 0,
    needs_review_count: numeric(s.needs_review_count) ?? 0,
    campaign_count: numeric(s.campaign_count) ?? 0,
    ads_budget: numeric(s.ads_budget),
    service_fee: numeric(s.service_fee),
    ads_budget_missing: numeric(s.ads_budget_missing) ?? 0,
    service_fee_missing: numeric(s.service_fee_missing) ?? 0,
    gmv_tap: numeric(s.gmv_tap),
    avg_price: numeric(s.avg_price),
    avg_commission_pct: numeric(s.avg_commission_pct),
    avg_partner_commission_pct: numeric(s.avg_partner_commission_pct),
    campaign_types: (s.campaign_types as string[] | null) ?? [],
    deal_by_names: names(s.deal_by_ids),
    pic_tap_names: names(s.pic_tap_ids),
  }));

  const canRegister = hasPermission("deals.register", member.role);
  const canEdit = hasPermission("deals.edit", member.role);
  // Tabel shop mengedit KARTU PRODUK (products_tap), bukan brand_deals — izinnya
  // karena itu products.edit, sama dengan tombol Edit di tab Produk TAP.
  const canEditShop = hasPermission("products.edit", member.role);

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
        Klik judul kolom untuk mengurutkan (naik → turun → urutan bawaan). Tabel dimulai dari preset
        kolom <strong>Ringkas</strong> supaya muat satu layar tanpa digeser kanan-kiri — kolom
        nominal (Ads Budget, Service Fee, GMV TAP, Campaign, ID) bisa dimunculkan lewat menu{" "}
        <strong>Kolom</strong>, dan pilihannya tersimpan di browser ini. Baris per halaman bisa
        diatur 10/20/50/100 di bawah tabel.
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

      <h2 className="mt-10 text-lg font-semibold">Shop dari Produk TAP</h2>
      <p className="mt-1 text-sm text-slate-500">
        Isi tabel <strong>Produk TAP</strong> diringkas per <strong>Shop Name</strong> — satu baris
        per shop, sejajar dengan tabel deal di atas. Deal baru didaftarkan sebagai kartu produk,
        jadi di sinilah shop yang sedang berjalan terlihat. Jumlah kartu &amp; campaign dihitung,
        Ads Budget / Service Fee / GMV dijumlah, harga &amp; rate komisi dirata-rata, dan Exp Date
        memakai masa berlaku terjauh. Kolom lain bisa dimunculkan lewat menu <strong>Kolom</strong>;
        kotak pencarian di atas ikut menyaring tabel ini.
      </p>
      {canEditShop && (
        <p className="mt-2 text-sm text-slate-500">
          Tombol <strong>Edit</strong> di tiap baris menulis ke <em>semua kartu produk</em> shop
          tersebut sekaligus: Shop ID yang diisi di sini terisi ke seluruh produknya di tab Produk
          TAP, begitu juga <strong>Tipe Campaign</strong>. Kolom lain berbeda per produk, jadi
          perbaikannya tetap lewat tombol Edit di tab Produk TAP.
        </p>
      )}

      {shopError && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat ringkasan shop: {shopError.message}
        </p>
      )}

      <div className="mt-2">
        <ShopsTable
          rows={shopRows}
          canEdit={canEditShop}
          emptyMessage={
            q
              ? `Tidak ada shop cocok dengan "${q}".`
              : "Belum ada kartu produk. Daftarkan lewat Registrasi Deal atau upload master product list."
          }
        />
      </div>
    </div>
  );
}
