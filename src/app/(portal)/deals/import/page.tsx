import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { BulkImportPanel } from "./bulk-import-panel";

// 800+ baris: insert per batch + sinkron handler/cooperating_shops dalam satu request.
export const maxDuration = 300;

export default async function DealImportPage() {
  const member = await requireMember();
  if (!hasPermission("deals.import_legacy", member.role)) redirect("/deals");
  const canPreview = hasPermission("deals.import_preview", member.role);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Import Bulk Deal Brand</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Upload export tab <strong>&quot;DATA BULKING! UNTUK KO YOHAN&quot;</strong> (sheet All Brand TAP, .xlsx atau
        .csv) apa adanya — baris 1 grup kolom, baris 2 header. Kolom dibaca per <strong>posisi</strong> (header
        &quot;Leads&quot; muncul dua kali). Klik <strong>Preview</strong> dulu: belum ada yang tersimpan. Setelah
        dicek, <strong>Simpan</strong> melakukan upsert per (Shop ID + Nama Brand persis). Baris lama yang tidak ada
        di file TIDAK dihapus di sini.
      </p>
      {canPreview && (
        <p className="mt-2 text-sm">
          <Link href="/deals/import/preview" className="font-medium text-blue-700 hover:underline">
            Buka halaman Preview Bulk Load (staging vs produksi) →
          </Link>
        </p>
      )}
      <div className="mt-6">
        <BulkImportPanel />
      </div>
    </div>
  );
}
