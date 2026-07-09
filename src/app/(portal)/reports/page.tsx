import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { GenerateReportForm } from "./generate-report-form";

export default async function ReportsPage() {
  const member = await requireMember();
  if (!hasPermission("reports.generate", member.role)) redirect("/dashboard");

  const supabase = await createClient();

  // CPM scope: only their own creators appear in the picker (server also re-checks).
  let creatorsQuery = supabase.from("creators").select("id, name").eq("status", "aktif").order("name");
  if (member.role === "cpm") creatorsQuery = creatorsQuery.eq("owner_cpm_id", member.id);

  const [{ data: creators }, { data: reports }, { data: baselines }] = await Promise.all([
    creatorsQuery,
    supabase
      .from("creator_reports")
      .select("id, creator_id, period_type, period_start, status, token_used, generated_at, creators(name)")
      .order("generated_at", { ascending: false })
      .limit(50),
    supabase.from("token_baseline").select("report_type, best_token, updated_at"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Report Kreator (M2)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pipeline hybrid: agregasi deterministik → gate skip-LLM → insight naratif (1 call, token
        tercatat). Draft direview lalu difinalisasi (human-in-the-loop).
      </p>

      <div className="mt-6">
        <GenerateReportForm creators={creators ?? []} />
      </div>

      {(baselines ?? []).length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          Token baseline (ratchet):{" "}
          {(baselines ?? []).map((b) => `${b.report_type} = ${b.best_token} token`).join(" · ")}
        </p>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Jenis</th>
              <th className="px-4 py-3">Periode</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Token</th>
              <th className="px-4 py-3">Dibuat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(reports ?? []).map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2">
                  <Link href={`/reports/${r.id}`} className="font-medium text-slate-900 underline">#{r.id}</Link>
                </td>
                <td className="px-4 py-2">
                  {(r.creators as unknown as { name: string } | null)?.name ?? r.creator_id}
                </td>
                <td className="px-4 py-2">{r.period_type}</td>
                <td className="px-4 py-2">{r.period_start}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "final" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2">{r.token_used}</td>
                <td className="px-4 py-2 text-slate-500">{new Date(r.generated_at).toLocaleString("id-ID")}</td>
              </tr>
            ))}
            {(reports ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Belum ada report. Generate dari form di atas (butuh data metrik di Data Platform).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
