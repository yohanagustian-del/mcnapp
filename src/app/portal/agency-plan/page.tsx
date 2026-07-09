import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { stripPlanForCreator, planExposesForbiddenField } from "@/lib/m9/portal";

/** §2.4 — ALL active agency plans; komisi_kreator only (komisi_mea stripped at view + here). */
export default async function AgencyPlanPage() {
  await requireCreator();
  const admin = createAdminClient();
  const { data } = await admin
    .from("creator_agency_plan_v")
    .select("deal_id, product_id, product_name, link, niche, komisi_kreator, exp_date, status")
    .order("product_name");

  // Defense-in-depth: the view already excludes komisi_mea; strip again before render.
  const rows = (data ?? []).map(stripPlanForCreator);
  const leaked = (data ?? []).some(planExposesForbiddenField);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Extra Komisi dari agency plan</h1>
        <p className="text-sm text-slate-500">
          Pakai link ini agar mendapatkan komisi extra.
        </p>
      </header>
      {leaked && (
        <p className="rounded bg-red-50 p-2 text-xs text-red-600">
          Peringatan internal: view mengekspos kolom terlarang — hubungi admin.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Produk</th><th className="p-3">Niche</th>
              <th className="p-3">Komisi Kreator</th><th className="p-3">Link</th><th className="p-3">Exp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="p-3 text-slate-500" colSpan={5}>Belum ada plan aktif.</td></tr>
            ) : rows.map((r, i) => (
              <tr key={`${r.deal_id}-${r.product_id}-${i}`} className="border-t border-slate-100">
                <td className="p-3">{r.product_name}</td>
                <td className="p-3">{r.niche ?? "-"}</td>
                <td className="p-3">{r.komisi_kreator != null ? `${r.komisi_kreator}%` : "-"}</td>
                <td className="p-3">
                  {r.link ? <a className="text-blue-600 hover:underline" href={String(r.link)}>Buka link</a> : "-"}
                </td>
                <td className="p-3">{r.exp_date ? String(r.exp_date) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
