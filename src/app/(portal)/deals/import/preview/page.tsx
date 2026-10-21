import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPreviewData } from "@/lib/deals/bulk-deal-preview";
import { MIGRATION_0097_MISSING } from "@/lib/db/missing-migration";
import { BulkPlanView } from "../bulk-plan-view";

/**
 * Preview Bulk Load Deal Brand — hanya management + bizdev_lead (deals.import_preview).
 * Hasil load sheet di environment ini (staging) vs snapshot produksi. Tidak ada tombol
 * tulis di sini; "Promote ke Produksi" adalah langkah terpisah setelah persetujuan Yohan.
 */
export default async function BulkPreviewPage() {
  const member = await requireMember();
  if (!hasPermission("deals.import_preview", member.role)) redirect("/deals");

  let data: Awaited<ReturnType<typeof loadPreviewData>> | null = null;
  let error: string | null = null;
  try {
    data = await loadPreviewData(createAdminClient());
  } catch (e) {
    error = e instanceof Error ? e.message : MIGRATION_0097_MISSING;
  }

  return (
    <div>
      <Link href="/deals/import" className="text-sm text-blue-700 hover:underline">← Import Bulk Deal Brand</Link>
      <h1 className="mt-1 text-2xl font-semibold">Preview Bulk Load Deal Brand</h1>
      <p className="mt-1 max-w-3xl text-sm text-slate-500">
        Hasil load sheet &quot;DATA BULKING! UNTUK KO YOHAN&quot; di <strong>environment ini</strong> dibandingkan
        dengan <strong>produksi</strong>. Produksi tidak disentuh: pembandingnya snapshot SELECT read-only
        {data ? ` (${data.snapshot.fetchedAt.slice(0, 16).replace("T", " ")} UTC, ${data.snapshot.deals.length} baris)` : ""}.
        Pemindahan ke produksi hanya lewat langkah &quot;Promote ke Produksi&quot; terpisah setelah Yohan menyetujui.
      </p>

      {error && <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            {data.lastRun ? (
              <>
                Load terakhir: <strong>{new Date(data.lastRun.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</strong>
                {data.lastRun.by ? ` oleh ${data.lastRun.by}` : ""} — insert {data.lastRun.counts.inserts}, update{" "}
                {data.lastRun.counts.updates}, tidak berubah {data.lastRun.counts.unchanged}, skip {data.lastRun.counts.skipped}.
              </>
            ) : (
              <>Belum ada load di environment ini. Jalankan Import Bulk Deal Brand dulu.</>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Angka di bawah = <strong>apa yang akan terjadi di produksi bila di-Promote</strong>: Insert = brand staging
            yang belum ada di produksi, Update = brand yang isinya berbeda, &quot;Ada di produksi, tidak di
            sheet&quot; = kandidat soft-deactivate.
          </p>
          <BulkPlanView plan={data.plan} envRowCount={data.snapshot.deals.length} envLabel="produksi" refs={data.snapshot.refs} />
        </div>
      )}
    </div>
  );
}
