import Link from "next/link";
import { requireMember } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import {
  computePctProgress,
  countAchievedKrs,
  formatPct,
  mapRewardTier,
  okrStatusLabel,
  statusBadgeClass,
  isRewardTbd,
} from "@/lib/m3/scoring";
import { getHandsOnRatio } from "@/lib/m3/adapters";
import { aggregateUsageByWeek } from "@/lib/m3/usage";
import { describeActivity } from "@/lib/m3/activity-labels";
import { UsageAdoptionTable, type UsageRow } from "./usage-table";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const MANAGEMENT_ROLES = ["director", "head", "spv"] as const;
const rupiah = (n: number | null) =>
  n === null ? "TBD" : `Rp${Math.round(n).toLocaleString("id-ID")}`;

export default async function OkrPage() {
  const member = await requireMember();
  const supabase = await createClient();

  const isManagement = (MANAGEMENT_ROLES as readonly string[]).includes(member.role);
  const isLead = member.role.endsWith("_lead") || isManagement;
  const isCpm = member.role === "cpm" || member.role === "cm_lead";
  const isDirector = member.role === "director";

  const windowDays = Number((await getConfig("m3.hands_on_window_days")) ?? 7);

  // Load KRs untuk role ini (atau semua jika management)
  const krQuery = supabase
    .from("okr_key_results")
    .select("id, role, segment, metric, target, period_type, period_start, period_end, aggregation_rule, objective_ref, active")
    .eq("active", true)
    .order("role").order("metric");

  if (!isManagement) {
    krQuery.eq("role", member.role);
  }

  const [{ data: krs }, { data: tiers }, { data: gatingPending }] = await Promise.all([
    krQuery,
    supabase.from("reward_tiers").select("role, kr_achieved_count, reward_amount").order("kr_achieved_count"),
    supabase
      .from("okr_gating_events")
      .select("id, kr_id, event_desc, director_decision")
      .eq("director_decision", "pending"),
  ]);

  const krIds = (krs ?? []).map((k) => k.id);

  type OkrActualRow = {
    kr_id: number;
    subject_id: string | null;
    actual_value: number | null;
    pct_progress: number | null;
    achieved: boolean | null;
    computed_at: string;
  };

  // Load aktuals — latest per (kr_id, subject_id) via distinct-on emulation:
  // ambil semua, lalu filter di JS (jumlah KR terbatas)
  let allActuals: OkrActualRow[] = [];
  if (krIds.length) {
    const { data } = await supabase
      .from("okr_actuals")
      .select("kr_id, subject_id, actual_value, pct_progress, achieved, computed_at")
      .in("kr_id", krIds)
      .order("computed_at", { ascending: false });
    allActuals = (data ?? []) as OkrActualRow[];
  }

  // Untuk tiap (kr_id, subject_id) ambil yang paling baru
  const latestActuals = new Map<string, OkrActualRow>();
  for (const a of allActuals) {
    const key = `${a.kr_id}:${a.subject_id}`;
    if (!latestActuals.has(key)) latestActuals.set(key, a);
  }

  // Aktuals untuk member ini saja
  const myActuals = [...latestActuals.values()].filter(
    (a) => a.subject_id === member.id
  );

  const myKrs = (krs ?? []).filter((k) => k.role === member.role || isManagement);
  const achievedCount = countAchievedKrs(myActuals.map((a) => ({ achieved: a.achieved ?? false })));
  const projectedReward = mapRewardTier(member.role, achievedCount, tiers ?? []);
  const rewardTbd = isRewardTbd(member.role, achievedCount, tiers ?? []);

  const pendingGatingForMe = (gatingPending ?? []).filter((g) =>
    myActuals.some((a) => a.kr_id === g.kr_id)
  ).length;

  // Hands-on ratio hanya untuk CPM
  const handsOnRatioVal = isCpm ? await getHandsOnRatio(supabase as never, member.id, windowDays) : null;

  // Untuk management: ambil semua subject dalam setiap KR (cross-team view)
  let crossTeam: { memberId: string; memberName: string; role: string; achieved: number; total: number }[] = [];
  if (isManagement) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name, role")
      .eq("active", true);

    const subjectAchieved = new Map<string, number>();
    const subjectTotal = new Map<string, number>();
    for (const a of allActuals ?? []) {
      if (a.subject_id) {
        subjectAchieved.set(a.subject_id, (subjectAchieved.get(a.subject_id) ?? 0) + (a.achieved ? 1 : 0));
        subjectTotal.set(a.subject_id, (subjectTotal.get(a.subject_id) ?? 0) + 1);
      }
    }

    crossTeam = (members ?? [])
      .filter((m) => subjectTotal.has(m.id))
      .map((m) => ({
        memberId: m.id,
        memberName: m.name,
        role: m.role,
        achieved: subjectAchieved.get(m.id) ?? 0,
        total: subjectTotal.get(m.id) ?? 0,
      }))
      .sort((a, b) => b.achieved - a.achieved);
  }

  // Adopsi sistem (QA): jam pemakaian tools per user per minggu — Director & Lead.
  // Last Access & Last Activity dibaca dari sumber yang sudah ada (tool_usage_logs,
  // audit_logs) — bukan mekanisme log baru (CLAUDE.md #4: satu sumber kebenaran).
  let usageRows: UsageRow[] = [];
  if (isLead) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 92); // ~3 bulan terakhir
    const [{ data: usageLogs }, { data: allMembers }, { data: recentAudit }] = await Promise.all([
      supabase
        .from("tool_usage_logs")
        .select("member_id, occurred_at")
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: true })
        .limit(20000),
      supabase.from("team_members").select("id, name, role").eq("active", true),
      supabase
        .from("audit_logs")
        .select("actor_id, action, created_at")
        .gte("created_at", since.toISOString())
        .not("actor_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20000),
    ]);
    const memberById = new Map((allMembers ?? []).map((m) => [m.id, m]));

    const lastAccessByMember = new Map<string, string>();
    for (const l of usageLogs ?? []) {
      // usageLogs terurut ascending → penulisan terakhir per member = paling baru.
      lastAccessByMember.set(l.member_id, l.occurred_at);
    }

    const lastActivityByMember = new Map<string, { at: string; label: string }>();
    for (const a of recentAudit ?? []) {
      // recentAudit terurut descending → kemunculan pertama per actor = paling baru.
      if (a.actor_id && !lastActivityByMember.has(a.actor_id)) {
        lastActivityByMember.set(a.actor_id, { at: a.created_at, label: describeActivity(a.action) });
      }
    }

    usageRows = aggregateUsageByWeek(usageLogs ?? []).map((u) => ({
      ...u,
      memberName: memberById.get(u.memberId)?.name ?? u.memberId,
      role: memberById.get(u.memberId)?.role ?? "—",
      lastAccess: lastAccessByMember.get(u.memberId) ?? null,
      lastActivity: lastActivityByMember.get(u.memberId) ?? null,
    }));
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OKR — Kinerja Quartal (M3)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Progres KR personal + proyeksi reward. Scoring deterministik, 0 token AI. Reward final = snapshot akhir quartal.
          </p>
        </div>
        {isDirector && (
          <Link href="/okr/director"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Dashboard Director →
          </Link>
        )}
      </div>

      {/* ===== Kartu ringkasan ===== */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">KR Achieved</p>
          <p className="mt-1 text-2xl font-semibold">{achievedCount} / {myKrs.filter(k => k.role === member.role).length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Proyeksi Reward</p>
          <p className={`mt-1 text-2xl font-semibold ${rewardTbd ? "text-amber-600" : ""}`}>
            {projectedReward === null ? (rewardTbd ? "TBD" : "—") : rupiah(projectedReward)}
          </p>
          {rewardTbd && <p className="text-xs text-amber-600">Reward belum ditetapkan Director</p>}
        </div>
        {isCpm && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">Hands-on Ratio ({windowDays} hari)</p>
            <p className="mt-1 text-2xl font-semibold">
              {handsOnRatioVal === null ? "—" : `${Math.round(handsOnRatioVal * 100)}%`}
            </p>
            <p className="text-xs text-slate-400">GMV naik dengan aktivitas CPM tercatat (korelasional)</p>
          </div>
        )}
        {pendingGatingForMe > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-xs uppercase text-red-500">Gating Pending</p>
            <p className="mt-1 text-2xl font-semibold text-red-700">{pendingGatingForMe}</p>
            <p className="text-xs text-red-600">KR berisiko gugur — menunggu review Director</p>
          </div>
        )}
      </section>

      {/* ===== Tabel KR personal ===== */}
      <section>
        <h2 className="text-lg font-medium">Key Results — {member.role}</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Objective</th>
                <th className="px-4 py-3">Metrik</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Aktual</th>
                <th className="px-4 py-3">Progres</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Terakhir dihitung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {myKrs.filter(k => k.role === member.role).map((kr) => {
                const actualRow = latestActuals.get(`${kr.id}:${member.id}`);
                const pct = actualRow ? Number(actualRow.pct_progress) : -1;
                const gatingFlagged = (gatingPending ?? []).some((g) => g.kr_id === kr.id);
                const status = okrStatusLabel(pct, gatingFlagged);
                return (
                  <tr key={kr.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{kr.objective_ref ?? "—"}</td>
                    <td className="px-4 py-2 font-medium">{kr.metric}</td>
                    <td className="px-4 py-2">{kr.target}</td>
                    <td className="px-4 py-2">
                      {actualRow ? Number(actualRow.actual_value).toLocaleString("id-ID") : "—"}
                    </td>
                    <td className="px-4 py-2 font-semibold">{pct < 0 ? "—" : formatPct(pct)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}>
                        {status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-400">
                      {actualRow ? new Date(actualRow.computed_at).toLocaleDateString("id-ID") : "Belum dihitung"}
                    </td>
                  </tr>
                );
              })}
              {myKrs.filter(k => k.role === member.role).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                    Belum ada KR terdefinisi untuk role ini.
                    {isDirector && (
                      <span> <Link href="/okr/director" className="underline">Set KR di Dashboard Director</Link>.</span>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Progres dihitung mingguan oleh Director. Reward final hanya dari KR ≥100% saat snapshot akhir quartal.
        </p>
      </section>

      {/* ===== Reward tiers yang berlaku untuk role ini ===== */}
      {(tiers ?? []).some((t) => t.role === member.role) && (
        <section>
          <h2 className="text-lg font-medium">Reward Tier — {member.role}</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">KR achieved (min.)</th>
                  <th className="px-4 py-3">Reward</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(tiers ?? []).filter((t) => t.role === member.role).map((t, i) => (
                  <tr key={i} className={achievedCount >= t.kr_achieved_count ? "bg-green-50" : ""}>
                    <td className="px-4 py-2">{t.kr_achieved_count}/KR{achievedCount >= t.kr_achieved_count && " ✓"}</td>
                    <td className="px-4 py-2 font-semibold">
                      {t.reward_amount === null ? <span className="text-amber-600">TBD</span> : rupiah(t.reward_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ===== Cross-team view (management) ===== */}
      {isManagement && crossTeam.length > 0 && (
        <section>
          <h2 className="text-lg font-medium">Kinerja Tim (Cross-team)</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Anggota</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">KR Achieved</th>
                  <th className="px-4 py-3">Total KR</th>
                  <th className="px-4 py-3">% Achieve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {crossTeam.map((m) => (
                  <tr key={m.memberId}>
                    <td className="px-4 py-2 font-medium">{m.memberName}</td>
                    <td className="px-4 py-2">{m.role}</td>
                    <td className="px-4 py-2">{m.achieved}</td>
                    <td className="px-4 py-2">{m.total}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.total > 0 && m.achieved / m.total >= 0.75
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }`}>
                        {m.total > 0 ? `${Math.round(m.achieved / m.total * 100)}%` : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ===== Adopsi sistem (QA): jam pemakaian tools per minggu ===== */}
      {isLead && (
        <section>
          <h2 className="text-lg font-medium">Adopsi Sistem — Jam Pemakaian Tools</h2>
          <p className="mt-1 text-xs text-slate-500">
            Dari log page-view (sesi = aktivitas beruntun, gap &gt;30 menit memulai sesi baru).
            Akumulasi per minggu Senin−Minggu. Indikator adaptasi tim ke sistem baru — bukan komponen reward.
          </p>
          <UsageAdoptionTable rows={usageRows} />
        </section>
      )}

      {/* ===== View untuk management bila belum ada data ===== */}
      {isManagement && crossTeam.length === 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
          <p>Belum ada data aktual OKR tim. Jalankan &ldquo;Score Mingguan&rdquo; dari Dashboard Director setelah KR dikonfigurasi.</p>
          {isDirector && (
            <Link href="/okr/director" className="mt-3 inline-block rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              Buka Dashboard Director →
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
