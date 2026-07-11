import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadDealProducts } from "../actions";
import { DealForm } from "./deal-form";

export default async function DealBaruPage() {
  const member = await requireMember();
  if (!hasPermission("deals.register", member.role)) redirect("/deals");

  const supabase = await createClient();
  const { data: picOptions } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("active", true)
    .in("team_group", ["bizdev", "management"])
    .order("name");

  // Kandidat niche untuk datalist search: union distinct brand_deals.niche &
  // products_tap.level2_category (pola sama dengan filter kategori di /products).
  const [{ data: dealNicheRows }, { data: productNicheRows }] = await Promise.all([
    supabase.from("brand_deals").select("niche").not("niche", "is", null).limit(1000),
    supabase.from("products_tap").select("level2_category").not("level2_category", "is", null).limit(1000),
  ]);
  const nicheOptions = [
    ...new Set(
      [
        ...(dealNicheRows ?? []).map((r) => r.niche),
        ...(productNicheRows ?? []).map((r) => r.level2_category),
      ].filter((v): v is string => Boolean(v && v.trim()))
    ),
  ].sort();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Registrasi Deal</h1>
      <p className="mt-1 text-sm text-slate-500">
        Validasi ketat mencegah data kotor: Shop ID numeric & unik, exp date dari date picker,
        komisi angka murni (range → min & max terpisah). Exp date otomatis sinkron ke
        cooperating_shops untuk alert kadaluarsa M4.
      </p>
      <div className="mt-6">
        <DealForm picOptions={picOptions ?? []} nicheOptions={nicheOptions} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Upload Produk via Excel</h2>
      <p className="mt-1 text-sm text-slate-500">
        Bulk daftar produk untuk deal yang sudah terdaftar (utamanya .xlsx).
      </p>
      <div className="mt-3">
        <CsvUploadForm
          action={uploadDealProducts}
          buttonLabel="Upload Produk"
          helpText="Kolom (xlsx/csv): deal_id ATAU shop_id (resolve brand), product_id, product_name, product_link, niche, exp_date, komisi_kreator, komisi_mea, ads_budget, service_fee, status (running|hold|done)."
        />
      </div>
    </div>
  );
}
