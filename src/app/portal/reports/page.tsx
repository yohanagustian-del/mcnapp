import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { weekStart, hasReportCredit, nextCreditDate } from "@/lib/m9/portal";
import { generateSelfReport } from "../actions";

/** §2.3 — CPM Final reports (surface, 0 token) + self-service credit (1/week, expires). */
export default async function ReportsPage() {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();
  const now = new Date();

  const { data: reports } = await admin
    .from("creator_reports")
    .select("id, period_type, period_start, status, generated_at")
    .eq("creator_id", creatorId).eq("status", "final")
    .order("period_start", { ascending: false });

  const { data: credits } = await admin
    .from("creator_report_credits").select("week_start").eq("creator_id", creatorId);
  const available = hasReportCredit(now, (credits ?? []).map((c) => c.week_start as string));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-lg font-semibold">Report Pertumbuhan Akun & Insight (self-service)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kuota 1 report/minggu, hangus bila tak dipakai. Minggu ini: {weekStart(now)}.
        </p>
        {available ? (
          <form action={generateSelfReport} className="mt-3">
            <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Generate report pertumbuhan</button>
          </form>
        ) : (
          <p className="mt-3 rounded bg-slate-100 p-2 text-sm text-slate-600">
            Kredit minggu ini sudah dipakai — tersedia lagi {nextCreditDate(now)}.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Report dari CPM (Final)</h2>
        {(reports ?? []).length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada report final. Report yang menumpuk di draft = sinyal ke manajemen.</p>
        ) : (
          <ul className="space-y-2">
            {(reports ?? []).map((r) => (
              <li key={r.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
                {r.period_type} · {r.period_start} · <span className="text-green-600">Final</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
