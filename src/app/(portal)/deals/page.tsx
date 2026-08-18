import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
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

  // Deal baru tidak lagi masuk brand_deals melainkan jadi kartu produk (0041), dan
  // ringkasannya per shop dikerjakan view products_tap_shop_summary (SQL, bukan JS):
  // halaman ini cuma membaca baris yang sudah jadi.
  let shopQuery = supabase
    .from("products_tap_shop_summary")
    .select("*")
    .order("product_count", { ascending: false })
    .limit(200);
  if (q?.trim()) {
    const term = `%${q.trim()}%`;
    // shop_key sudah berisi Shop Name (atau "#shop_id" untuk baris tanpa nama), jadi
    // tiga filter ini cukup.
    shopQuery = shopQuery.or(`shop_key.ilike.${term},shop_name.ilike.${term},shop_id.ilike.${term}`);
  }
  const { data: shopSummary, error: shopError } = await shopQuery;

  // Kolom Nama BD membuka identitas pemilik kartu — namanya TIDAK ikut dikirim ke
  // role yang tidak berhak, bukan hanya disembunyikan di tabel (pola tab Produk TAP).
  const canSeeOwner = hasPermission("products.view_owner_name", member.role);

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
    uploaded_by_names: canSeeOwner ? names(s.uploaded_by_ids) : [],
  }));

  const canRegister = hasPermission("deals.register", member.role);
  // Tabel shop mengedit KARTU PRODUK (products_tap), bukan brand_deals — izinnya
  // karena itu products.edit, sama dengan tombol Edit di tab Produk TAP.
  const canEditShop = hasPermission("products.edit", member.role);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Deal Brand</h1>
          <p className="mt-1 text-sm text-slate-500">
            Shop kerjasama yang sedang berjalan, diringkas dari kartu Produk TAP. Registrasi deal
            baru jadi kartu produk yang otomatis muncul di sini.
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
          placeholder="Cari shop / Shop ID…"
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

      <h2 className="mt-8 text-lg font-semibold">Shop dari Produk TAP</h2>
      <p className="mt-1 text-sm text-slate-500">
        Isi tabel <strong>Produk TAP</strong> diringkas per <strong>Shop Name</strong> — satu baris
        per shop. Deal baru didaftarkan sebagai kartu produk, jadi di sinilah shop yang sedang
        berjalan terlihat. Jumlah kartu &amp; campaign dihitung, Ads Budget / Service Fee / GMV
        dijumlah, harga &amp; rate komisi dirata-rata, dan Exp Date memakai masa berlaku terjauh.{" "}
        <strong>Ads Budget</strong> &amp; <strong>Service Fee</strong> beserta <strong>Deal by</strong>,{" "}
        <strong>PIC TAP</strong>, dan <strong>Nama BD</strong> tampil di tabel ini. Kolom lain bisa
        dimunculkan lewat menu <strong>Kolom</strong>; kotak pencarian di atas ikut menyaring tabel
        ini.
      </p>
      {canEditShop && (
        <p className="mt-2 text-sm text-slate-500">
          Tombol <strong>Edit</strong> di tiap baris menulis ke <em>semua kartu produk</em> shop
          tersebut sekaligus: Shop ID yang diisi di sini terisi ke seluruh produknya di tab Produk
          TAP, begitu juga <strong>Tipe Campaign</strong>. Ads Budget &amp; Service Fee diatur per
          shop di tab <strong>Project BD</strong>; kolom lain berbeda per produk, jadi perbaikannya
          tetap lewat tombol Edit di tab Produk TAP.
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
          canSeeOwner={canSeeOwner}
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
