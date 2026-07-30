import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getProjectRequirements } from "@/lib/m7/requirements";
import { ProjectRequirementsPanel } from "@/components/project-requirements-panel";
import {
  markHandoffDone,
  markReferralPaid,
  recordAcquisition,
  recordReferral,
  refreshGmvPostJoin,
  registerCreator,
} from "./actions";
import { PendingCreatorsPanel } from "./pending-creators-panel";

export const dynamic = "force-dynamic";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

export default async function AcquisitionWorkspacePage() {
  const member = await requireMember();
  const canRecord = hasPermission("m8.acquisition", member.role);
  const canPay = hasPermission("m8.referral_pay", member.role);
  // Daftar tunggu kreator (0028): siapa yang boleh approve/tolak.
  const canReviewPending = hasPermission("creators.pending_review", member.role);

  const supabase = await createClient();
  const [{ data: acquisitions }, { data: referrals }, { data: creators }, { data: cmMembers }] = await Promise.all([
    supabase
      .from("acquisitions")
      .select("id, creator_id, lead_source, binding_date, gmv_post_join, commission_share_at_binding, gmv_last_30d, quarter_end, gmv_quarter_actual, handoff_done, creators(name, level, niche, status, owner_cpm_id), team_members(name)")
      .order("id", { ascending: false })
      .limit(100),
    supabase
      .from("referrals")
      .select("id, new_creator_id, referrer_creator_id, referral_source, commission_status, commission_amount")
      .order("id", { ascending: false })
      .limit(50),
    supabase.from("creators").select("id, name, status").order("name").limit(500),
    supabase
      .from("team_members")
      .select("id, name, role")
      .in("role", ["cm_lead", "cpm"])
      .eq("active", true)
      .order("name"),
  ]);

  // Daftar tunggu kreator (0028) — username dari file upload yang belum terdaftar.
  // Pending dulu (yang perlu tindakan), lalu yang sudah diputuskan sebagai riwayat.
  const { data: pending } = await supabase
    .from("creator_pending_registrations")
    .select(
      "id, username, platform, source, status, seen_count, rows_affected, followers, gmv_snapshot, first_seen_at, last_seen_at, creator_id, review_note"
    )
    .order("status", { ascending: true })
    .order("seen_count", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(200);
  const pendingRows = pending ?? [];

  const name = (rel: unknown) => (rel as { name?: string } | null)?.name ?? "—";

  // M7 creator requirements — acquisition sources creators to close the gap.
  const projectReqs = await getProjectRequirements(supabase);

  // §2C.1 metrik: binding per sumber (pribadi + tim) + GMV hasil binding.
  const bySource = new Map<string, { count: number; gmv: number }>();
  const bySpecialist = new Map<string, { count: number; gmv: number }>();
  for (const a of acquisitions ?? []) {
    const src = bySource.get(a.lead_source ?? "?") ?? { count: 0, gmv: 0 };
    src.count++; src.gmv += Number(a.gmv_post_join ?? 0);
    bySource.set(a.lead_source ?? "?", src);
    const spec = name(a.team_members);
    const s = bySpecialist.get(spec) ?? { count: 0, gmv: 0 };
    s.count++; s.gmv += Number(a.gmv_post_join ?? 0);
    bySpecialist.set(spec, s);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Acquisition Workspace (M8)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tracking kinerja closing binding per specialist & sumber lead, program referral, handoff
          ke CM. Deterministik, 0 token AI.
        </p>
      </div>

      <PendingCreatorsPanel rows={pendingRows} canReview={canReviewPending} />

      <ProjectRequirementsPanel requirements={projectReqs} focus="creator" />

      {/* ===== §2C.1 metrik closing ===== */}
      <section className="grid gap-4 sm:grid-cols-3">
        {(["inbound", "outbound", "platform"] as const).map((src) => {
          const s = bySource.get(src) ?? { count: 0, gmv: 0 };
          return (
            <div key={src} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs uppercase text-slate-500">{src}</p>
              <p className="mt-1 text-2xl font-semibold">{s.count} binding</p>
              <p className="text-sm text-slate-500">GMV post-join: {rupiah(s.gmv)}</p>
            </div>
          );
        })}
      </section>

      {/* ===== Registrasi creator baru (manual) ===== */}
      {canRecord && (
        <section>
          <h2 className="text-lg font-medium">Daftarkan Creator Baru</h2>
          <p className="mt-1 text-sm text-slate-500">
            Creator baru langsung berstatus bergabung (binding) dan tersedia di master kreator sampai
            di-assign ke CM.
          </p>
          <form action={registerCreator} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
            {/* --- Wajib --- */}
            <input name="username" required placeholder="Username" className={input} />
            <input name="name" required placeholder="Nama Creator" className={input} />
            <input name="phone" required placeholder="No HP" className={input} />
            <input name="followers" required placeholder="Followers (cth: 20.100 - 50.000)" className={input} />
            <input
              type="number" name="commission_share" required step="0.1" min="0" max="100"
              placeholder="Sharing Komisi % (cth: 22 untuk 22%)" className={input}
            />
            <select name="owner_cpm_id" required className={input}>
              <option value="">— CM (owner) —</option>
              {(cmMembers ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-500">Join
              <input type="date" name="join_date" required className={`${input} flex-1 text-slate-900`} />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">Akhir Kontrak
              <input type="date" name="contract_end_date" required className={`${input} flex-1 text-slate-900`} />
            </label>
            <input name="domisili" required placeholder="Domisili" className={input} />
            <input name="uid" required placeholder="UID" className={input} />

            {/* --- Opsional --- */}
            <select name="platform" className={input}>
              <option value="">Platform (opsional)</option>
              <option value="tiktok">TikTok</option>
              <option value="shopee">Shopee</option>
            </select>
            <input name="jenis_creator" placeholder="Jenis (opsional, cth: live & vt)" className={input} />
            <input name="top_niches" placeholder="Niche Top 3 (opsional, cth: beauty; skincare, fashion)" className={`${input} sm:col-span-2`} />
            <input name="content_quality" placeholder="Kualitas (opsional)" className={input} />
            <select name="level" className={input}>
              <option value="">Level (opsional)</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => <option key={l} value={l}>Level {l}</option>)}
            </select>
            <input name="gmv" placeholder="GMV Total avg/bln (opsional)" className={input} />
            <input name="gmv_live" placeholder="GMV Live avg/bln (opsional)" className={input} />
            <input name="gmv_video" placeholder="GMV Video avg/bln (opsional)" className={input} />
            <input name="rc_live" placeholder="RC Live (opsional)" className={input} />
            <input name="rc_video" placeholder="RC Video (opsional)" className={input} />
            <input name="rate_card" placeholder="Rate Card Rp (opsional)" className={input} />
            <button type="submit" className={`${btn} sm:col-span-2`}>Daftarkan Creator</button>
          </form>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-medium">Kinerja per Specialist</h2>
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2">Specialist</th><th className="px-3 py-2">Binding</th><th className="px-3 py-2">GMV post-join</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...bySpecialist.entries()].sort((a, b) => b[1].count - a[1].count).map(([spec, s]) => (
                  <tr key={spec}>
                    <td className="px-3 py-2">{spec}</td>
                    <td className="px-3 py-2">{s.count}</td>
                    <td className="px-3 py-2">{rupiah(s.gmv)}</td>
                  </tr>
                ))}
                {bySpecialist.size === 0 && (
                  <tr><td colSpan={3} className="px-3 py-5 text-center text-slate-400">Belum ada closing.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {canRecord && (
          <div>
            <h2 className="text-lg font-medium">Catat Closing Binding</h2>
            <form action={recordAcquisition} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <select name="creator_id" required className={input}>
                <option value="">— creator —</option>
                {(creators ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id}, {c.status})</option>)}
              </select>
              <select name="lead_source" required className={input}>
                <option value="inbound">Inbound (event/socmed/SEO)</option>
                <option value="outbound">Outbound (outreach)</option>
                <option value="platform">Platform list (Shopee/TikTok)</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-500">Binding
                <input type="date" name="binding_date" required className={`${input} flex-1 text-slate-900`} />
              </label>
              <input name="notes" placeholder="Catatan" className={input} />
              <button type="submit" className={`${btn} sm:col-span-2`}>Catat Binding</button>
            </form>

            <h2 className="mt-6 text-lg font-medium">Catat Referral (Ajak Teman)</h2>
            <form action={recordReferral} className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <select name="new_creator_id" required className={input}>
                <option value="">— creator baru —</option>
                {(creators ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
              </select>
              <select name="referral_source" required className={input}>
                <option value="antar_creator">Antar-creator (berkomisi)</option>
                <option value="platform">Program referral platform</option>
              </select>
              <input name="referrer_creator_id" placeholder="Creator perujuk (CRT-..., wajib bila antar-creator)" className={`${input} sm:col-span-2`} />
              <button type="submit" className={`${btn} sm:col-span-2`}>Catat Referral</button>
            </form>
          </div>
        )}
      </section>

      {/* ===== daftar akuisisi + handoff ===== */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Closing & Handoff ke CM</h2>
          {canRecord && (
            <form action={refreshGmvPostJoin}>
              <button type="submit" className={btn}>Refresh GMV Post-Join (window KR)</button>
            </form>
          )}
        </div>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Creator</th><th className="px-4 py-3">Specialist</th>
                <th className="px-4 py-3">Sumber</th><th className="px-4 py-3">Binding</th>
                <th className="px-4 py-3">Komisi @Binding</th>
                <th className="px-4 py-3">GMV 30d (log)</th>
                <th className="px-4 py-3">GMV Quartal (s/d akhir Q)</th>
                <th className="px-4 py-3">GMV post-join</th><th className="px-4 py-3">Handoff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(acquisitions ?? []).map((a) => {
                const c = a.creators as unknown as { name?: string; owner_cpm_id?: string | null } | null;
                return (
                  <tr key={a.id}>
                    <td className="px-4 py-2 font-medium">{c?.name ?? "—"} <span className="text-xs text-slate-400">{a.creator_id}</span></td>
                    <td className="px-4 py-2">{name(a.team_members)}</td>
                    <td className="px-4 py-2">{a.lead_source}</td>
                    <td className="px-4 py-2">{a.binding_date ?? "—"}</td>
                    <td className="px-4 py-2">
                      {a.commission_share_at_binding != null
                        ? `${Number((Number(a.commission_share_at_binding) <= 1
                            ? Number(a.commission_share_at_binding) * 100
                            : Number(a.commission_share_at_binding)).toFixed(1))}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{rupiah(a.gmv_last_30d)}</td>
                    <td className="px-4 py-2">
                      {rupiah(a.gmv_quarter_actual)}
                      {a.quarter_end && <span className="ml-1 text-xs text-slate-400">→ {a.quarter_end}</span>}
                    </td>
                    <td className="px-4 py-2">{rupiah(a.gmv_post_join)}</td>
                    <td className="px-4 py-2">
                      {a.handoff_done ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">selesai</span>
                      ) : canRecord ? (
                        <form action={markHandoffDone}>
                          <input type="hidden" name="acquisition_id" value={a.id} />
                          <button type="submit" className={`${btnSmall} bg-slate-900 text-white`}
                            title={c?.owner_cpm_id ? "" : "Creator belum di-assign CPM"}>
                            Tandai handoff
                          </button>
                        </form>
                      ) : "belum"}
                    </td>
                  </tr>
                );
              })}
              {(acquisitions ?? []).length === 0 && (
                <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-400">Belum ada closing binding.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== §2C.2 referral ===== */}
      <section>
        <h2 className="text-lg font-medium">Referral — Program Ajak Teman</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Creator baru</th><th className="px-4 py-3">Perujuk</th>
                <th className="px-4 py-3">Sumber</th><th className="px-4 py-3">Komisi</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(referrals ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">{r.new_creator_id}</td>
                  <td className="px-4 py-2">{r.referrer_creator_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.referral_source === "antar_creator" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
                      {r.referral_source}
                    </span>
                  </td>
                  <td className="px-4 py-2">{rupiah(r.commission_amount)}</td>
                  <td className="px-4 py-2">
                    {r.commission_status === "dibayar" ? "dibayar" : canPay && r.referral_source === "antar_creator" ? (
                      <form action={markReferralPaid}>
                        <input type="hidden" name="referral_id" value={r.id} />
                        <button type="submit" className={`${btnSmall} bg-green-600 text-white`}>Tandai dibayar</button>
                      </form>
                    ) : r.commission_status}
                  </td>
                </tr>
              ))}
              {(referrals ?? []).length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada referral.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
