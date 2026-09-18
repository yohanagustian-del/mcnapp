import { successRate } from "@/lib/m8/routing";
import { APPROACH_DATE_STAGES, type ExternalApproachRow } from "@/lib/workspace/external-approach";

const cardCls = "rounded-lg border border-slate-200 bg-white p-4";
const labelCls = "text-xs uppercase text-slate-500";
const valueCls = "mt-1 text-2xl font-semibold";

/** §2D.1 pipeline funnel: satu scorecard per tahap + conversion using TAP / reachout. */
export function ApproachScorecards({ rows }: { rows: ExternalApproachRow[] }) {
  const counts = {
    scouting_date: rows.filter((r) => r.approach_date).length,
    reachout_date: rows.filter((r) => r.reachout_date).length,
    respon_date: rows.filter((r) => r.respon_date).length,
    follow_up_1_date: rows.filter((r) => r.follow_up_1_date).length,
    follow_up_2_date: rows.filter((r) => r.follow_up_2_date).length,
    follow_up_3_date: rows.filter((r) => r.follow_up_3_date).length,
    using_tap_date: rows.filter((r) => r.using_tap_date).length,
  };
  const conversion = successRate(counts.reachout_date, counts.using_tap_date);

  return (
    <section className="grid gap-4 sm:grid-cols-4">
      {APPROACH_DATE_STAGES.map((stage) => (
        <div key={stage.field} className={cardCls}>
          <p className={labelCls}>{stage.label}</p>
          <p className={valueCls}>{counts[stage.field as keyof typeof counts]}</p>
        </div>
      ))}
      <div className={cardCls}>
        <p className={labelCls}>Conversion</p>
        <p className={valueCls}>{conversion === null ? "—" : `${(conversion * 100).toFixed(0)}%`}</p>
        <p className="text-sm text-slate-500">Using TAP / Reachout</p>
      </div>
    </section>
  );
}
