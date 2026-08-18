import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { ShopsTable, type ShopSummaryRow } from "./shops-table";

/**
 * Batas baris shop yang ditarik sekali muat. Bukan paginasi sungguhan: kalau batasnya
 * kena, halaman MENGATAKANNYA (di bawah tabel) alih-alih diam-diam memotong daftar.
 */
const SHOP_ROW_LIMIT = 500;

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

  // Satu tabel, satu view: `deal_shop_summary` meringkas kartu Produk TAP per shop DAN
  // membawa shop yang deal-nya sudah terdaftar tapi kartunya belum (Registrasi Deal
  // berisi Shop Name saja → baris brand_deals). Ads Budget & Service Fee di dalamnya =
  // TOTAL nominal shop itu lintas Project BD (0046). Agregasinya SQL, bukan JS:
  // halaman ini cuma membaca baris yang sudah jadi.
  // Urutan bawaan: kartu terbanyak dulu, lalu shop yang punya baris deal. Tanpa
  // pengurutan kedua, SEMUA shop yang baru terdaftar (0 kartu) menumpuk di ekor dan
  // jadi yang pertama terpotong batas di bawah — persis baris yang paling butuh
  // dilihat setelah didaftarkan.
  let shopQuery = supabase
    .from("deal_shop_summary")
    .select("*")
    .order("product_count", { ascending: false })
    .order("deal_count", { ascending: false })
    .order("shop_key", { ascending: true })
    .limit(SHOP_ROW_LIMIT);
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
    deal_count: numeric(s.deal_count) ?? 0,
    deal_id: (s.deal_id as string | null) ?? null,
    ads_budget: numeric(s.ads_budget),
    service_fee: numeric(s.service_fee),
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
            Shop kerjasama yang sedang berjalan. Registrasi deal yang sudah menyebut produk jadi
            kartu Produk TAP; yang baru menyebut Shop Name tercatat sebagai deal shop — keduanya
            muncul di tabel yang sama di bawah.
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

      <h2 className="mt-8 text-lg font-semibold">Shop</h2>
      <p className="mt-1 text-sm text-slate-500">
        Satu baris per <strong>Shop Name</strong>: kartu <strong>Produk TAP</strong> shop itu
        diringkas (jumlah kartu &amp; campaign dihitung, GMV dijumlah, harga &amp; rate komisi
        dirata-rata, Exp Date memakai masa berlaku terjauh), ditambah shop yang{" "}
        <strong>deal-nya sudah didaftarkan tapi produknya belum</strong> — baris seperti itu tampil
        dengan 0 kartu dan bertanda <strong>deal</strong>. <strong>Ads Budget</strong> &amp;{" "}
        <strong>Service Fee</strong> di sini adalah <strong>total lintas project</strong>:
        penjumlahan nominal yang diinput per shop di tiap <strong>Project BD</strong> (mis. DVARA di
        project A + DVARA di project B). Kolom lain bisa dimunculkan lewat menu{" "}
        <strong>Kolom</strong>; kotak pencarian di atas ikut menyaring tabel ini.
      </p>
      {canEditShop && (
        <p className="mt-2 text-sm text-slate-500">
          Tombol <strong>Edit</strong> di tiap baris menulis ke <em>semua kartu produk</em> shop
          tersebut sekaligus — dan ke baris <em>deal</em>-nya, sehingga Shop ID shop yang produknya
          belum turun pun bisa diisi dari sini. Yang bisa diseragamkan: Shop ID dan{" "}
          <strong>Tipe Campaign</strong>. <strong>Ads Budget</strong> &amp;{" "}
          <strong>Service Fee</strong> tidak bisa diedit dari sini — keduanya diisi per shop{" "}
          <em>di dalam project</em> lewat tab <strong>Project BD</strong>, karena satu shop bisa
          punya nominal berbeda di project yang berbeda. Kolom lain berbeda per produk, jadi
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
          canSeeOwner={canSeeOwner}
          emptyMessage={
            q
              ? `Tidak ada shop cocok dengan "${q}".`
              : "Belum ada shop. Daftarkan lewat Registrasi Deal atau upload master product list."
          }
        />
      </div>
      {shopRows.length >= SHOP_ROW_LIMIT && (
        <p className="mt-2 text-xs text-amber-700">
          Ditampilkan {SHOP_ROW_LIMIT} shop pertama (kartu terbanyak dulu). Pakai kotak pencarian di
          atas untuk menemukan shop yang tidak terlihat di daftar ini.
        </p>
      )}
    </div>
  );
}
