import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { importLegacyDeals } from "../actions";

export default async function DealImportPage() {
  const member = await requireMember();
  if (!hasPermission("deals.import_legacy", member.role)) redirect("/deals");

  return (
    <div>
      <h1 className="text-2xl font-semibold">Import Master Deal Internal (lama)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Parser toleran untuk sheet lama yang berantakan: Rupiah campur (titik/koma ribuan),
        exp date teks bebas ("19 February 2026"), komisi kotor ("5-7%", "not found") → disimpan
        dengan flag review, tidak crash. Baris "Summary" otomatis dilewati. Countdown negatif →
        shop dinonaktifkan. Mendukung .xlsx, .csv, dan .numbers (Apple Numbers) — baris judul di
        atas header ikut dilewati otomatis.
      </p>

      <div className="mt-6 max-w-3xl">
        <CsvUploadForm
          action={importLegacyDeals}
          buttonLabel="Import Master Deal"
          helpText='Kolom yang dikenali (header sheet lama): Nama Brand, SHOP ID, Niche, GMV TAP, Avg Harga, Tim Handler, Ads Brand, Leads, Bobot, Diterima/Ditolak, Priority, Status, Campaign Name, Campaign ID, Exp Date, Countdown, Link TAP, Contact PIC, Nama Grup, Komisi Kreator, Komisi Mea, Openplan, Action, Notes, Shop Code.'
        />
      </div>
    </div>
  );
}
