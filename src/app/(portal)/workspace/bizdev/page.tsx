import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { PIPELINE_STAGES } from "@/lib/m8/routing";
import { getProjectRequirements } from "@/lib/m7/requirements";
import { ProjectRequirementsPanel } from "@/components/project-requirements-panel";
import { brandAccCampaign, handoverCampaign } from "../campaign-actions";
import { processCreatorRequest, setPipelineStage } from "./actions";
import { BrandReportForm } from "./brand-report-form";
import { RouteCampaignForm } from "./route-campaign-form";
import { CompactScheduleList, type CompactSlotRow } from "../../schedule/compact-list";
import type { LiveScheduleSlot } from "@/lib/schedule/types";
import { getWeekStart, getWeekDays } from "@/lib/schedule/week";

export const dynamic = "force-dynamic";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

interface BrandReportData {
  totals?: { gmv?: number; video_views?: number; live_views?: number; videos?: number; creators?: number };
  roas?: number | null;
  upgrade_recommendation?: boolean;
}

export default async function BizdevWorkspacePage() {
  const member = await requireMember();
  const canRoute = hasPermission("m8.route_campaign", member.role);
  const canBrandAcc = hasPermission("m8.brand_acc", member.role);
  const canHandover = hasPermission("m8.handover", member.role);
  const canProcess = hasPermission("m8.request_process", member.role);
  const canPipeline = hasPermission("m8.pipeline", member.role);
  const canReport = hasPermission("m8.brand_report", member.role);
  const canViewSchedule = hasPermission("schedule.view", member.role);

  const supabase = await createClient();

  // ===== M13 Jadwal Live (deal BD) — minggu berjalan, deals_by='bd' atau deal_id terisi =====
  const todayIso = new Date().toISOString().slice(0, 10);
  const bdWeekStart = getWeekStart(new Date());
  const bdWeekDays = getWeekDays(bdWeekStart);
  const bdWeekEnd = bdWeekDays[6];
  // ===== Wave 1: independent lookups =====
  // The BD schedule block is a 2-step dependent chain (slots → creator names
  // for those slots), bundled into an inline async fn so it still joins the
  // parallel wave; it's independent of deals/reqs/leads/reports/projectReqs.
  const [
    bdScheduleRows,
    { data: deals },
    { data: creatorReqs },
    { data: campaignReqs },
    { data: leads },
    { data: brandReports },
    projectReqs,
  ] = await Promise.all([
    (async (): Promise<CompactSlotRow[]> => {
      if (!canViewSchedule) return [];
      const { data: bdSlots } = await supabase
        .from("live_schedule_slots")
        .select("*")
        .gte("schedule_date", bdWeekStart)
        .lte("schedule_date", bdWeekEnd)
        .or("deals_by.eq.bd,deal_id.not.is.null")
        .order("schedule_date", { ascending: true });
      const bdCreatorIds = [...new Set(((bdSlots ?? []) as LiveScheduleSlot[]).map((s) => s.creator_id))];
      const { data: bdSlotCreators } = bdCreatorIds.length
        ? await supabase.from("creators").select("id, name").in("id", bdCreatorIds)
        : { data: [] as { id: string; name: string }[] };
      const bdNameById = new Map((bdSlotCreators ?? []).map((c) => [c.id, c.name]));
      return ((bdSlots ?? []) as LiveScheduleSlot[]).map((s) => ({
        slot: s,
        creatorName: bdNameById.get(s.creator_id) ?? s.creator_id,
      }));
    })(),
    supabase
      .from("brand_deals")
      .select("id, brand_name, shop_id, pipeline_stage, status, campaign_name, exp_date")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("creator_requests")
      .select("id, creator_id, type, target_brand, status, amount, approval_status, creators(name)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("campaign_requests")
      .select("id, deal_id, creator_id, owner_cpm_id, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handed_over_at, creator_sourced_by, brand_deals(brand_name), creators(name), team_members!campaign_requests_owner_cpm_id_fkey(name)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("bd_leads")
      .select("id, shop_id, shop_name, frequency, total_gmv, priority_score, source, status")
      .order("priority_score", { ascending: false, nullsFirst: false })
      .limit(20),
    supabase
      .from("brand_reports")
      .select("id, deal_id, period_start, period_end, data_json, summary_text, token_used, brand_deals(brand_name)")
      .order("created_at", { ascending: false })
      .limit(10),
    // M7 ads budget requirements — BizDev secures/allocates the ads spend.
    getProjectRequirements(supabase),
  ]);

  const name = (rel: unknown) => (rel as { name?: string } | null)?.name ?? "—";
  const dealOptions = (deals ?? []).map((d) => ({ id: d.id, brand_name: d.brand_name }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">BizDev Workspace (M8)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tracker req semua CM, pipeline deal, routing req campaign ke CM pemilik creator, report
          brand. Deterministik — LLM hanya opsional untuk ringkasan report brand (pola M2).
        </p>
      </div>

      <ProjectRequirementsPanel requirements={projectReqs} focus="ads" />

      {/* ===== M13 Jadwal Live (deal BD) — preview read-only minggu berjalan ===== */}
      {canViewSchedule && (
        <CompactScheduleList
          title="Jadwal Live (deal BD)"
          rows={bdScheduleRows}
          todayIso={todayIso}
          emptyLabel="Belum ada jadwal live minggu ini yang terkait deal BD."
        />
      )}

      {/* ===== §2E Routing req campaign ===== */}
      {canRoute && (
        <section>
          <h2 className="text-lg font-medium">Routing Req Campaign → CM Pemilik Creator</h2>
          <p className="mt-1 text-xs text-slate-500">
            Sistem cek owner_cpm_id tiap creator — req otomatis muncul di CM Workspace pemilik, bukan CM lain (§2E.1).
          </p>
          <div className="mt-3"><RouteCampaignForm deals={dealOptions} /></div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Status Req Campaign (§2E.2 — semua transisi ter-log)</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Brand</th><th className="px-4 py-3">Creator</th>
                <th className="px-4 py-3">Sourcing</th>
                <th className="px-4 py-3">CM Owner</th><th className="px-4 py-3">Konfirmasi CM</th>
                <th className="px-4 py-3">Acc Brand</th><th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(campaignReqs ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{name(r.brand_deals)}</td>
                  <td className="px-4 py-2">{name(r.creators)} <span className="text-xs text-slate-400">{r.creator_id}</span></td>
                  <td className="px-4 py-2">
                    {r.creator_sourced_by === "bizdev" ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                        BizDev langsung
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">via CM</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{name(r.team_members)}</td>
                  <td className="px-4 py-2">{r.cm_confirm_status}</td>
                  <td className="px-4 py-2">{r.needs_brand_acc ? r.brand_acc_status : "tidak perlu"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.final_status === "fix" ? "bg-green-100 text-green-800"
                      : r.final_status === "batal" ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-800"}`}>
                      {r.final_status}{r.handed_over_at ? " · handed over" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {canBrandAcc && r.final_status === "proses" && r.brand_acc_status === "menunggu" &&
                        (["approved", "ditolak"] as const).map((d) => (
                          <form key={d} action={brandAccCampaign}>
                            <input type="hidden" name="req_id" value={r.id} />
                            <input type="hidden" name="decision" value={d} />
                            <button type="submit" className={`${btnSmall} ${d === "approved" ? "bg-green-600 text-white" : "bg-red-100 text-red-700"}`}>
                              Brand {d}
                            </button>
                          </form>
                        ))}
                      {canHandover && r.final_status === "fix" && !r.handed_over_at && (
                        <form action={handoverCampaign}>
                          <input type="hidden" name="req_id" value={r.id} />
                          <button type="submit" className={`${btnSmall} bg-slate-900 text-white`}>Handover Campaign Ops</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {(campaignReqs ?? []).length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Belum ada req campaign.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== §2B.1 Tracker req dari semua CM + lead shop potensial ===== */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-medium">Tracker Req dari Semua CM</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Creator</th><th className="px-3 py-2">Jenis</th>
                  <th className="px-3 py-2">Brand</th><th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(creatorReqs ?? []).map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{name(r.creators)}</td>
                    <td className="px-3 py-2 uppercase">{r.type}{r.amount ? ` · ${rupiah(r.amount)}` : ""}</td>
                    <td className="px-3 py-2">{r.target_brand ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.status}
                      {r.approval_status === "menunggu" && <span className="ml-1 text-xs text-amber-600">(menunggu Director)</span>}
                    </td>
                    <td className="px-3 py-2">
                      {canProcess && r.approval_status !== "menunggu" && (
                        <div className="flex gap-1">
                          {r.status === "diajukan" && (
                            <form action={processCreatorRequest}>
                              <input type="hidden" name="req_id" value={r.id} />
                              <input type="hidden" name="status" value="diproses" />
                              <button type="submit" className={`${btnSmall} bg-slate-200 text-slate-700`}>Proses</button>
                            </form>
                          )}
                          {r.status === "diproses" && (
                            <form action={processCreatorRequest}>
                              <input type="hidden" name="req_id" value={r.id} />
                              <input type="hidden" name="status" value="selesai" />
                              <button type="submit" className={`${btnSmall} bg-green-600 text-white`}>Selesai</button>
                            </form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {(creatorReqs ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">Belum ada req dari CM.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-medium">Lead Shop Potensial (M4 otomatis + manual CM)</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Shop / ID</th><th className="px-3 py-2">Freq</th>
                  <th className="px-3 py-2">GMV</th><th className="px-3 py-2">Sumber</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(leads ?? []).map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      {l.shop_name ? (
                        <>
                          {l.shop_name}
                          <span className="block text-xs text-slate-400">{l.shop_id}</span>
                        </>
                      ) : (
                        l.shop_id
                      )}
                    </td>
                    <td className="px-3 py-2">{l.frequency ?? "—"}</td>
                    <td className="px-3 py-2">{rupiah(l.total_gmv)}</td>
                    <td className="px-3 py-2">{l.source}</td>
                    <td className="px-3 py-2">{l.status}</td>
                  </tr>
                ))}
                {(leads ?? []).length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-400">Belum ada lead.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Nilai deal bisa dinilai dengan <Link href="/predictor" className="underline">Prediksi Deal (M6)</Link>;
            pemilihan creator dibantu <Link href="/matching" className="underline">Matching (M5)</Link>.
          </p>
        </div>
      </section>

      {/* ===== §2B.2 Pipeline deal ===== */}
      <section>
        <h2 className="text-lg font-medium">Pipeline Deal Brand</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Deal</th><th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Exp</th>
                <th className="px-4 py-3">Tahap Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(deals ?? []).map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2 font-medium">{d.id}</td>
                  <td className="px-4 py-2">{d.brand_name}</td>
                  <td className="px-4 py-2">{d.campaign_name ?? "—"}</td>
                  <td className="px-4 py-2">{d.exp_date ?? "—"}</td>
                  <td className="px-4 py-2">
                    {canPipeline ? (
                      <form action={setPipelineStage} className="flex items-center gap-1">
                        <input type="hidden" name="deal_id" value={d.id} />
                        <select name="stage" defaultValue={d.pipeline_stage ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-xs">
                          <option value="" disabled>— tahap —</option>
                          {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <button type="submit" className={`${btnSmall} bg-slate-200 text-slate-700 hover:bg-slate-300`}>Set</button>
                      </form>
                    ) : (d.pipeline_stage ?? "—")}
                  </td>
                </tr>
              ))}
              {(deals ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada deal — registrasi via <Link href="/deals/baru" className="underline">Registrasi Deal</Link>.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== §2B.3-2B.4 Campaign & hasil + report brand ===== */}
      {canReport && (
        <section>
          <h2 className="text-lg font-medium">Report Brand Deals (§2B.4)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Agregasi hasil campaign per brand dari data platform (GMV, video, view; ROAS bila ads
            spend diisi) + saran upgrade service bila ROAS & GMV di atas ambang (tunable).
          </p>
          <div className="mt-3"><BrandReportForm deals={dealOptions} /></div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Brand</th><th className="px-4 py-3">Periode</th>
                  <th className="px-4 py-3">GMV</th><th className="px-4 py-3">ROAS</th>
                  <th className="px-4 py-3">Video / View</th><th className="px-4 py-3">Creator</th>
                  <th className="px-4 py-3">Upgrade?</th><th className="px-4 py-3">Ringkasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(brandReports ?? []).map((r) => {
                  const d = (r.data_json ?? {}) as BrandReportData;
                  const t = d.totals ?? {};
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 font-medium">{name(r.brand_deals)}</td>
                      <td className="px-4 py-2">{r.period_start} → {r.period_end}</td>
                      <td className="px-4 py-2">{rupiah(t.gmv ?? null)}</td>
                      <td className="px-4 py-2">{d.roas ? d.roas.toFixed(2) : "—"}</td>
                      <td className="px-4 py-2">{t.videos ?? 0} / {(Number(t.video_views ?? 0) + Number(t.live_views ?? 0)).toLocaleString("id-ID")}</td>
                      <td className="px-4 py-2">{t.creators ?? 0}</td>
                      <td className="px-4 py-2">{d.upgrade_recommendation ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">✦ layak upgrade</span> : "—"}</td>
                      <td className="max-w-md px-4 py-2 text-xs text-slate-600">{r.summary_text ? `${r.summary_text.slice(0, 160)}… (${r.token_used} token)` : "data-only (0 token)"}</td>
                    </tr>
                  );
                })}
                {(brandReports ?? []).length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">Belum ada report brand.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
