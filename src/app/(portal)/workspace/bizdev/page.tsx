import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getProjectRequirements } from "@/lib/m7/requirements";
import { ProjectRequirementsPanel } from "@/components/project-requirements-panel";
import { processCreatorRequest } from "./actions";
import { BrandReportForm } from "./brand-report-form";
import { CampaignReqTable, type CampaignReqRow } from "./campaign-req-table";
import { PipelineTable, type PipelineDealRow } from "./pipeline-table";
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
  let bdScheduleRows: CompactSlotRow[] = [];
  if (canViewSchedule) {
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
    bdScheduleRows = ((bdSlots ?? []) as LiveScheduleSlot[]).map((s) => ({
      slot: s,
      creatorName: bdNameById.get(s.creator_id) ?? s.creator_id,
    }));
  }
  const [{ data: deals }, { data: creatorReqs }, { data: campaignReqs }, { data: leads }, { data: brandReports }] =
    await Promise.all([
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
        .select("id, deal_id, creator_id, owner_cpm_id, route_type, level2_category, request_text, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handed_over_at, creator_sourced_by, brand_deals(brand_name), creators(name), team_members!campaign_requests_owner_cpm_id_fkey(name)")
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
    ]);

  const name = (rel: unknown) => (rel as { name?: string } | null)?.name ?? "—";
  const dealOptions = (deals ?? []).map((d) => ({ id: d.id, brand_name: d.brand_name }));

  // Baris siap-tampil untuk tabel client (sort header + paginasi 10 baris).
  const campaignReqRows: CampaignReqRow[] = (campaignReqs ?? []).map((r) => ({
    id: r.id,
    dealId: r.deal_id,
    brandName: name(r.brand_deals),
    requestText: r.request_text,
    routeType: r.route_type,
    level2Category: r.level2_category,
    creatorId: r.creator_id,
    creatorName: name(r.creators),
    cmOwnerName: name(r.team_members),
    cmConfirmStatus: r.cm_confirm_status,
    needsBrandAcc: Boolean(r.needs_brand_acc),
    brandAccStatus: r.brand_acc_status,
    finalStatus: r.final_status,
    handedOverAt: r.handed_over_at,
    creatorSourcedBy: r.creator_sourced_by,
  }));
  const pipelineRows: PipelineDealRow[] = (deals ?? []).map((d) => ({
    id: d.id,
    brandName: d.brand_name,
    campaignName: d.campaign_name,
    expDate: d.exp_date,
    pipelineStage: d.pipeline_stage,
  }));

  // Kolom 1 (kreator) + kolom 2 (kategori) untuk form routing — BizDev mencentang,
  // tidak lagi mengetik ID manual. Kategori dari penjualan nyata (creator_subcat_segment_gmv).
  const [{ data: routeCreators }, { data: catRows }] = canRoute
    ? await Promise.all([
        supabase
          .from("creators")
          .select("id, name, username, owner_cpm_id")
          .order("name", { ascending: true })
          .limit(1000),
        supabase
          .from("creator_subcat_segment_gmv")
          .select("level2_category")
          .gt("gmv", 0)
          .limit(5000),
      ])
    : [{ data: [] as { id: string; name: string; username: string | null; owner_cpm_id: string | null }[] }, { data: [] as { level2_category: string }[] }];
  const creatorOptions = (routeCreators ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    hasOwner: Boolean(c.owner_cpm_id),
  }));
  const categoryOptions = [...new Set((catRows ?? []).map((r) => r.level2_category).filter(Boolean))].sort();

  // M7 ads budget requirements — BizDev secures/allocates the ads spend.
  const projectReqs = await getProjectRequirements(supabase);

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
          searchable
        />
      )}

      {/* ===== §2E Routing req campaign ===== */}
      {canRoute && (
        <section>
          <h2 className="text-lg font-medium">Routing Req Campaign → CM Pemilik Creator</h2>
          <p className="mt-1 text-xs text-slate-500">
            3 kolom: (1) kreator → CM pemilik (cek owner_cpm_id, bukan CM lain); (2) kategori →
            semua CM yang punya kreator dengan penjualan di kategori itu; (3) teks bebas → broadcast
            semua CM. Tidak perlu hafal creator ID — cari & centang (§2E.1).
          </p>
          <div className="mt-3">
            <RouteCampaignForm deals={dealOptions} creators={creatorOptions} categories={categoryOptions} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Status Req Campaign (§2E.2 — semua transisi ter-log)</h2>
        <CampaignReqTable rows={campaignReqRows} canBrandAcc={canBrandAcc} canHandover={canHandover} />
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
        <PipelineTable rows={pipelineRows} canPipeline={canPipeline} />
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
