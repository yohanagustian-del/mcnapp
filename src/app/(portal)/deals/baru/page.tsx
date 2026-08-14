import { redirect } from "next/navigation";
import { requireMember, hasPermission, BIZDEV_ROLES, CM_ROLES, type Role } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadDealProducts } from "../actions";
import { DealForm, type MemberOption } from "./deal-form";

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

  // "Deal by" = orang yang menutup deal: role CM atau role BizDev. Difilter per ROLE
  // (bukan team_group) supaya daftarnya persis dua divisi itu, dan dikelompokkan agar
  // nama yang sama-sama umum tidak tertukar antar divisi.
  const { data: dealByRows } = await supabase
    .from("team_members")
    .select("id, name, role")
    .eq("active", true)
    .in("role", [...CM_ROLES, ...BIZDEV_ROLES])
    .order("name");
  const dealByOptions: MemberOption[] = (dealByRows ?? []).map((m) => ({
    id: m.id as string,
    name: m.name as string,
    group: (CM_ROLES as Role[]).includes(m.role as Role) ? "CM" : "BizDev",
  }));

  return (
    <div>
      <h1 className="text-2xl font-semibold">Registrasi Deal</h1>
      <p className="mt-1 text-sm text-slate-500">
        Isian form ini mengikuti kolom tabel <strong>Produk TAP</strong> (export TAP “Export
        link”), ditambah Tipe Campaign, Ads Budget, Service Fee, Deal by, dan PIC TAP. Setelah
        disimpan, kartunya langsung muncul sebagai baris di tab Produk TAP. Hanya Product Name
        yang wajib; Ads Budget &amp; Service Fee wajib khusus untuk tipe komisi extra.
      </p>
      <div className="mt-6">
        <DealForm picOptions={(picOptions ?? []) as MemberOption[]} dealByOptions={dealByOptions} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Upload Produk Deal Lama via Excel</h2>
      <p className="mt-1 text-sm text-slate-500">
        Bulk daftar produk untuk deal brand yang sudah terdaftar di tab Deal Brand (tabel deal
        lama). Untuk mengisi katalog Produk TAP secara massal, pakai “Upload Master Product List”
        di tab Produk TAP.
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
