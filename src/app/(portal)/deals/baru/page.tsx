import { redirect } from "next/navigation";
import { requireMember, hasPermission, BIZDEV_ROLES, CM_ROLES, type Role } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
// Upload massal di halaman ini memakai PARSER YANG SAMA dengan tab Produk TAP
// (export TAP "Export link"/"Custom report" → products_tap), bukan importer
// deal_products tersendiri: satu format file, satu tujuan tabel, satu perilaku
// (CLAUDE.md #4). Tutorial unduh filenya pun tutorial yang sama. `uploadDealProducts`
// membungkusnya hanya untuk me-revalidate halaman deal juga — tidak ada lagi
// pertanyaan Tipe Campaign/Ads Budget/Service Fee yang membedakan kedua jalur.
import { uploadDealProducts } from "../actions";
import { UploadTutorial } from "@/app/(portal)/products/upload-tutorial";
import { DealForm, type MemberOption } from "./deal-form";
import { UploadCampaignFields } from "./upload-campaign-fields";

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
        link”), ditambah Deal by dan PIC TAP. <strong>Semua pertanyaannya opsional</strong> — isi
        yang sudah diketahui saja. Yang menentukan deal ini mendarat di mana adalah{" "}
        <strong>identitas produknya</strong>: begitu <strong>Product Name</strong> atau{" "}
        <strong>Product ID</strong> terisi, kartunya masuk tab <strong>Produk TAP</strong>; kalau
        keduanya belum diketahui dan Anda baru mengisi <strong>Shop Name</strong>, deal-nya dicatat
        sebagai shop di tab <strong>Deal Brand</strong> dan kartu produknya menyusul belakangan.{" "}
        <strong>Ads Budget</strong> &amp; <strong>Service Fee</strong> tidak ditanyakan di sini —
        keduanya diisi per shop di dalam project lewat tab <strong>Project BD</strong>.
      </p>
      <div className="mt-6">
        <DealForm picOptions={(picOptions ?? []) as MemberOption[]} dealByOptions={dealByOptions} />
      </div>

      <h2 className="mt-10 text-lg font-semibold">Upload Produk Deal Lama via Excel</h2>
      <p className="mt-1 text-sm text-slate-500">
        Versi massal dari form di atas: satu baris file = satu kartu produk. Sistemnya sama persis
        dengan <strong>Upload Master Product List</strong> di tab Produk TAP — file export TAP
        diunggah apa adanya, barisnya masuk ke katalog <strong>Produk TAP</strong> dengan kunci
        (Campaign ID + Product ID), dan baris yang sudah ada ikut diperbarui alih-alih
        digandakan. Kolom yang belum diketahui boleh kosong; baris berharga/komisi kotor tetap
        tersimpan dengan tanda “perlu review”. <strong>Deal by</strong> dan <strong>PIC TAP</strong>{" "}
        boleh dijawab sekali di sini untuk seluruh file; <strong>Nama BD</strong> terisi otomatis
        dari akun Anda.
      </p>
      <div className="mt-3">
        <UploadTutorial />
      </div>
      <div className="mt-3">
        <CsvUploadForm
          action={uploadDealProducts}
          buttonLabel="Upload Produk"
          helpText='Terima langsung file export TAP "Export link" (Campaign ID, product name,
            Product ID, Sale price, Shop name, masa berlaku produk, rate komisi kreator & partner
            termasuk versi Shop Ads, Product link) MAUPUN export "Custom report" Partner Compass
            yang membawa metrik performa. Kolom Shop ID dan kategori opsional. Rupiah campur
            (titik/koma ribuan), harga rentang varian, dan komisi kotor ("not found", "5-7%")
            ditangani otomatis dengan flag "perlu review", tidak crash. Baris "Summary" dilewati.
            Shop ID yang belum ketemu bisa diisi belakangan sekaligus se-shop lewat tombol Edit di
            tabel "Shop dari Produk TAP" (tab Deal Brand).'
        >
          <UploadCampaignFields
            picOptions={(picOptions ?? []) as MemberOption[]}
            dealByOptions={dealByOptions}
          />
        </CsvUploadForm>
      </div>
    </div>
  );
}
