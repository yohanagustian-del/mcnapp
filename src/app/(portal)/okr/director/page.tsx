import { createClient } from "@/lib/supabase/server";
import { hasPermission, requirePermission } from "@/lib/rbac";
import {
  decidGating,
  saveKrTarget,
  saveRewardTier,
  scoreWeekly,
  snapshotQuarter,
} from "./actions";

export const dynamic = "force-dynamic";

const input  = "rounded-md border border-slate-300 px-3 py-2 text-sm w-full";
const select = "rounded-md border border-slate-300 px-3 py-2 text-sm bg-white w-full";
const btn    = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
const btnSm  = "rounded-md px-2 py-1 text-xs font-medium";
const rupiah = (n: number | null) =>
  n === null ? "TBD" : `Rp${Math.round(n).toLocaleString("id-ID")}`;

const METRIC_OPTIONS = [
  { value: "binding_count",            label: "Binding count (total)" },
  { value: "binding_hbf_count",        label: "Binding HBF (L4+/65jt)" },
  { value: "binding_commission_gte20", label: "Binding komisi ≥20%" },
  { value: "external_approach_count",  label: "Approach external (count)" },
  { value: "external_conversion_pct",  label: "Konversi external (rasio 0–1)" },
  { value: "gmv_portfolio_total",      label: "GMV total portfolio CPM" },
  { value: "level_up_count",           label: "Level-up creator (vs baseline)" },
  { value: "special_project_pct",      label: "Special project fulfillment %" },
];

const ROLES_LIST = [
  "director","head","spv","cm_lead","cpm",
  "bizdev_lead","bizdev","campaign_ops","bd_admin",
  "acquisition_lead","acquisition_spec","campaign_external","creator_support","finance",
];

export default async function DirectorOkrPage() {
  // Director + OD (revisi role 2026-07-29). Aksi Director-only di bawah tetap
  // digate per-permission — server actions re-check via requirePermission.
  const member = await requirePermission("m3.set_target");
  const canGating   = hasPermission("m3.gating_decision", member.role);
  const canSnapshot = hasPermission("m3.snapshot", member.role);

  const supabase = await createClient();
  const [{ data: krs }, { data: tiers }, { data: gatingEvents }] = await Promise.all([
    supabase
      .from("okr_key_results")
      .select("id, role, segment, metric, target, period_type, period_start, period_end, aggregation_rule, active, objective_ref")
      .order("role").order("metric"),
    supabase
      .from("reward_tiers")
      .select("id, role, kr_achieved_count, reward_amount, period_start, notes")
      .order("role").order("kr_achieved_count"),
    supabase
      .from("okr_gating_events")
      .select("id, kr_id, subject_id, event_desc, evidence_ref, flagged_at, director_decision, decided_at, okr_key_results(role, metric)")
      .eq("director_decision", "pending")
      .order("flagged_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Konfigurasi OKR (M3) — Director / OD</h1>
        <p className="mt-1 text-sm text-slate-500">
          Set target KR & reward per role dan trigger scoring mingguan.
          {canGating && " Review gating & snapshot quartal (Director)."} Semua perubahan tercatat di audit_logs.
        </p>
      </div>

      {/* ===== Trigger scoring & snapshot ===== */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="font-medium">Score Mingguan</h2>
          <p className="text-xs text-slate-500">Hitung aktual tiap KR dari sumber M2/M4/M7/M8 dan update progres.</p>
          <form action={scoreWeekly}>
            <input type="hidden" name="period_start" value="" />
            <button type="submit" className={btn}>Hitung OKR Sekarang</button>
          </form>
        </div>
        {canSnapshot && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-medium">Snapshot Quartal</h2>
            <form action={snapshotQuarter} className="grid gap-2">
              <select name="kind" className={select}>
                <option value="baseline">Baseline (awal quartal)</option>
                <option value="final">Final (akhir quartal)</option>
              </select>
              <input type="date" name="period_start" required className={input} />
              <button type="submit" className={btn}>Ambil Snapshot</button>
            </form>
          </div>
        )}
      </section>

      {/* ===== Add / edit KR ===== */}
      <section>
        <h2 className="text-lg font-medium">Tambah / Edit Key Result</h2>
        <form
          action={saveKrTarget}
          className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <input type="hidden" name="kr_id" value="" />
          <div>
            <label className="text-xs text-slate-500">Role</label>
            <select name="role" required className={select}>
              <option value="">— pilih role —</option>
              {ROLES_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Metrik</label>
            <select name="metric" required className={select}>
              {METRIC_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Target (angka)</label>
            <input name="target" type="number" step="any" min="0" required className={input} placeholder="contoh: 60" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Periode</label>
            <select name="period_type" className={select}>
              <option value="quartal">Quartal</option>
              <option value="bulan">Bulan</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Mulai periode</label>
            <input type="date" name="period_start" required className={input} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Akhir periode</label>
            <input type="date" name="period_end" className={input} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Aggregation</label>
            <select name="aggregation_rule" className={select}>
              <option value="pribadi">Pribadi (per individu)</option>
              <option value="tim">Tim (aggregate)</option>
              <option value="pribadi_tim">Pribadi + tim</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Objective ref</label>
            <input name="objective_ref" placeholder="mis. O1: Binding creator" className={input} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Segment (kosongkan = semua)</label>
            <input name="segment" placeholder="mis. tc, incubation" className={input} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className="text-xs text-slate-500">Filter JSON tambahan (opsional)</label>
            <input name="filter_json" placeholder='{"min_gmv": 65000000}' className={input} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <button type="submit" className={btn}>Simpan KR</button>
          </div>
        </form>

        {/* Daftar KR yang ada */}
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Metrik</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Periode</th>
                <th className="px-4 py-3">Agg</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(krs ?? []).map((kr) => (
                <tr key={kr.id}>
                  <td className="px-4 py-2 font-medium">{kr.role} {kr.segment && <span className="text-xs text-slate-400">({kr.segment})</span>}</td>
                  <td className="px-4 py-2">{kr.metric}</td>
                  <td className="px-4 py-2">{kr.target}</td>
                  <td className="px-4 py-2 text-xs">{kr.period_start} – {kr.period_end ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{kr.aggregation_rule}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${kr.active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"}`}>
                      {kr.active ? "aktif" : "nonaktif"}
                    </span>
                  </td>
                </tr>
              ))}
              {(krs ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada KR terdefinisi.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== Reward tiers ===== */}
      <section>
        <h2 className="text-lg font-medium">Reward Tier per Role</h2>
        <p className="mt-1 text-xs text-slate-500">
          Kosongkan kolom reward = TBD (ditandai sampai Director menetapkan).
        </p>
        <form
          action={saveRewardTier}
          className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-5"
        >
          <div>
            <label className="text-xs text-slate-500">Role</label>
            <select name="role" required className={select}>
              <option value="">— pilih —</option>
              {ROLES_LIST.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">KR achieve min.</label>
            <input name="kr_achieved_count" type="number" min="1" max="10" required className={input} />
          </div>
          <div>
            <label className="text-xs text-slate-500">Reward (Rp, kosong=TBD)</label>
            <input name="reward_amount" type="number" min="0" className={input} placeholder="mis. 4000000" />
          </div>
          <div>
            <label className="text-xs text-slate-500">Berlaku sejak</label>
            <input type="date" name="period_start" className={input} />
          </div>
          <div className="flex items-end">
            <button type="submit" className={`${btn} w-full`}>Simpan Tier</button>
          </div>
        </form>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Min. KR achieved</th>
                <th className="px-4 py-3">Reward</th>
                <th className="px-4 py-3">Berlaku sejak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(tiers ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 font-medium">{t.role}</td>
                  <td className="px-4 py-2">{t.kr_achieved_count}/KR</td>
                  <td className="px-4 py-2">
                    {t.reward_amount === null
                      ? <span className="text-amber-600 font-medium">TBD</span>
                      : rupiah(t.reward_amount)}
                  </td>
                  <td className="px-4 py-2 text-xs">{t.period_start ?? "—"}</td>
                </tr>
              ))}
              {(tiers ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">Belum ada tier reward.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== Gating events pending ===== */}
      <section>
        <h2 className="text-lg font-medium">Gating Events — Pending Review Director</h2>
        <p className="mt-1 text-xs text-slate-500">
          Sistem menandai KR "berisiko gugur" — Director memutuskan gugur/tidak. Keputusan tercatat di audit_logs.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">KR</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Kejadian</th>
                <th className="px-4 py-3">Bukti</th>
                <th className="px-4 py-3">Terdeteksi</th>
                <th className="px-4 py-3">Keputusan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(gatingEvents ?? []).map((ev) => {
                const kr = ev.okr_key_results as unknown as { role?: string; metric?: string } | null;
                return (
                  <tr key={ev.id}>
                    <td className="px-4 py-2 text-xs">{kr?.role} / {kr?.metric}</td>
                    <td className="px-4 py-2 text-xs font-mono">{ev.subject_id}</td>
                    <td className="px-4 py-2">{ev.event_desc}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{ev.evidence_ref ?? "—"}</td>
                    <td className="px-4 py-2 text-xs">{new Date(ev.flagged_at).toLocaleDateString("id-ID")}</td>
                    <td className="px-4 py-2">
                      {canGating ? (
                        <div className="flex gap-2">
                          {(["gugur", "tidak_gugur"] as const).map((d) => (
                            <form key={d} action={decidGating}>
                              <input type="hidden" name="event_id" value={ev.id} />
                              <input type="hidden" name="decision" value={d} />
                              <button type="submit"
                                className={`${btnSm} ${d === "gugur" ? "bg-red-600 text-white" : "bg-green-100 text-green-800"}`}>
                                {d === "gugur" ? "Gugur" : "Tidak gugur"}
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Keputusan oleh Director</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(gatingEvents ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Tidak ada gating event pending.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
