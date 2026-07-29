import { redirect } from "next/navigation";
import { requireMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * M11 OD oversight — cross-team, read-only. No mutation controls anywhere on this page.
 * Access limited to od_viewer + Director (management may also review). od_viewer holds no
 * write permission outside the M3 OKR exception (OD_OKR_PERMISSIONS, revisi role 2026-07-29 —
 * OKR config lives at /okr/director); every other mutation endpoint rejects them server-side
 * (see od-viewer.test.ts).
 */
export default async function OdOversightPage() {
  const member = await requireMember();
  if (!["od_viewer", "director", "head", "spv"].includes(member.role)) redirect("/dashboard");

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("od_oversight_v")
    .select("cpm_id, cpm_name, report_count, creators_covered, complaint_count, complaint_weighted, repeat_complaint_creators")
    .order("complaint_weighted", { ascending: false });

  return (
    <div className="space-y-4 p-2">
      <header>
        <h1 className="text-xl font-semibold">OD Oversight (read-only)</h1>
        <p className="text-sm text-slate-500">
          Kesehatan CPM lintas tim: coverage report (M2) + komplain kreator (M9, termasuk selesai).
          Tidak ada aksi mutasi — OD hanya memantau &amp; export.
        </p>
      </header>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-2">CPM</th><th className="p-2">Report</th><th className="p-2">Kreator</th>
              <th className="p-2">Komplain</th><th className="p-2">Bobot severity</th><th className="p-2">Repeat</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).length === 0 ? (
              <tr><td className="p-3 text-slate-500" colSpan={6}>Belum ada data.</td></tr>
            ) : (rows ?? []).map((r) => (
              <tr key={r.cpm_id} className="border-t border-slate-100">
                <td className="p-2">{r.cpm_name}</td>
                <td className="p-2">{r.report_count}</td>
                <td className="p-2">{r.creators_covered}</td>
                <td className="p-2">{r.complaint_count}</td>
                <td className="p-2">{Number(r.complaint_weighted).toFixed(0)}</td>
                <td className="p-2">{r.repeat_complaint_creators > 0
                  ? <span className="text-red-600">{r.repeat_complaint_creators}</span>
                  : r.repeat_complaint_creators}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
