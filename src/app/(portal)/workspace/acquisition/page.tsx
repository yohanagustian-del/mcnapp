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
import { ActionForm } from "./action-form";

export const dynamic = "force-dynamic";

const rupiah = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;
const input = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";
const btn = "rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700";
const btnSmall = "rounded-md px-2 py-1 text-xs font-medium";

/**
 * Satu input berlabel untuk form registrasi creator. Label eksplisit (bukan hanya
 * placeholder) supaya penanda wajib "*" tetap terlihat setelah kolom terisi —
 * placeholder hilang begitu user mengetik.
 */
function Field({
  label,
  htmlFor,
  required = false,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-600">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default async function AcquisitionWorkspacePage() {
  const member = await requireMember();
  const canRecord = hasPermission("m8.acquisition", member.role);
  const canPay = hasPermission("m8.referral_pay", member.role);

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
            di-assign ke CM. Kolom bertanda <span className="font-medium text-red-600">*</span> wajib
            diisi; sisanya opsional dan bisa dilengkapi belakangan lewat tombol Edit di tab Kreator.
          </p>
          <ActionForm
            action={registerCreator}
            className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
            submitLabel="Daftarkan Creator"
            pendingLabel="Mendaftarkan…"
            buttonClassName={`${btn} sm:col-span-2`}
            resetOnSuccess
          >
            {/* --- WAJIB: username, CM, join date, akhir kontrak --- */}
            <Field label="Username" required htmlFor="ac-username">
              <input id="ac-username" name="username" required placeholder="cth: winris12 (tanpa @)" className={input} />
            </Field>
            <Field label="CM (owner)" required htmlFor="ac-cm">
              <select id="ac-cm" name="owner_cpm_id" required className={input} defaultValue="">
                <option value="">— pilih CM —</option>
                {(cmMembers ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                ))}
              </select>
            </Field>
            <Field label="Join Date" required htmlFor="ac-join">
              <input id="ac-join" type="date" name="join_date" required className={input} />
            </Field>
            <Field label="Akhir Kontrak" required htmlFor="ac-end">
              <input id="ac-end" type="date" name="contract_end_date" required className={input} />
            </Field>

            {/* --- Opsional --- */}
            <p className="sm:col-span-2 border-t border-slate-100 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              Opsional
            </p>
            <Field label="Nama Creator" htmlFor="ac-name">
              <input id="ac-name" name="name" placeholder="kosong = pakai username" className={input} />
            </Field>
            <Field label="No HP" htmlFor="ac-phone">
              <input id="ac-phone" name="phone" placeholder="628123456789" className={input} />
            </Field>
            <Field label="Followers" htmlFor="ac-followers">
              <input id="ac-followers" name="followers" placeholder="cth: 20.100 - 50.000" className={input} />
            </Field>
            <Field label="Sharing Komisi %" htmlFor="ac-share">
              <input
                id="ac-share" type="number" name="commission_share" step="0.1" min="0" max="100"
                placeholder="cth: 22 untuk 22%" className={input}
              />
            </Field>
            <Field label="Domisili" htmlFor="ac-domisili">
              <input id="ac-domisili" name="domisili" placeholder="Surabaya" className={input} />
            </Field>
            <Field label="UID" htmlFor="ac-uid">
              <input id="ac-uid" name="uid" className={input} />
            </Field>
            <Field label="Platform" htmlFor="ac-platform">
              <select id="ac-platform" name="platform" className={input} defaultValue="">
                <option value="">—</option>
                <option value="tiktok">TikTok</option>
                <option value="shopee">Shopee</option>
              </select>
            </Field>
            <Field label="Jenis Creator" htmlFor="ac-jenis">
              <input id="ac-jenis" name="jenis_creator" placeholder="cth: live & vt" className={input} />
            </Field>
            <Field label="Niche Top 3" htmlFor="ac-niches" className="sm:col-span-2">
              <input id="ac-niches" name="top_niches" placeholder="cth: beauty; skincare, fashion" className={input} />
            </Field>
            <Field label="Kualitas Konten" htmlFor="ac-quality">
              <input id="ac-quality" name="content_quality" placeholder="Bagus / Cukup / Kurang" className={input} />
            </Field>
            <Field label="Level" htmlFor="ac-level">
              <select id="ac-level" name="level" className={input} defaultValue="">
                <option value="">—</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => <option key={l} value={l}>Level {l}</option>)}
              </select>
            </Field>
            <Field label="GMV Total (avg/bln)" htmlFor="ac-gmv">
              <input id="ac-gmv" name="gmv" className={input} />
            </Field>
            <Field label="GMV Live (avg/bln)" htmlFor="ac-gmv-live">
              <input id="ac-gmv-live" name="gmv_live" className={input} />
            </Field>
            <Field label="GMV Video (avg/bln)" htmlFor="ac-gmv-video">
              <input id="ac-gmv-video" name="gmv_video" className={input} />
            </Field>
            <Field label="RC Live" htmlFor="ac-rc-live">
              <input id="ac-rc-live" name="rc_live" className={input} />
            </Field>
            <Field label="RC Video" htmlFor="ac-rc-video">
              <input id="ac-rc-video" name="rc_video" className={input} />
            </Field>
            <Field label="Rate Card (Rp)" htmlFor="ac-rate-card">
              <input id="ac-rate-card" name="rate_card" className={input} />
            </Field>
          </ActionForm>
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
            <ActionForm
              action={recordAcquisition}
              className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
              submitLabel="Catat Binding"
              pendingLabel="Mencatat…"
              buttonClassName={`${btn} sm:col-span-2`}
              resetOnSuccess
            >
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
            </ActionForm>

            <h2 className="mt-6 text-lg font-medium">Catat Referral (Ajak Teman)</h2>
            <ActionForm
              action={recordReferral}
              className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
              submitLabel="Catat Referral"
              pendingLabel="Mencatat…"
              buttonClassName={`${btn} sm:col-span-2`}
              resetOnSuccess
            >
              <select name="new_creator_id" required className={input}>
                <option value="">— creator baru —</option>
                {(creators ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
              </select>
              <select name="referral_source" required className={input}>
                <option value="antar_creator">Antar-creator (berkomisi)</option>
                <option value="platform">Program referral platform</option>
              </select>
              <input name="referrer_creator_id" placeholder="Creator perujuk (CRT-..., wajib bila antar-creator)" className={`${input} sm:col-span-2`} />
            </ActionForm>
          </div>
        )}
      </section>

      {/* ===== daftar akuisisi + handoff ===== */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Closing & Handoff ke CM</h2>
          {canRecord && (
            <ActionForm
              action={refreshGmvPostJoin}
              submitLabel="Refresh GMV Post-Join (window KR)"
              pendingLabel="Menghitung…"
              buttonClassName={btn}
              compact
            />
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
                        <ActionForm
                          action={markHandoffDone}
                          submitLabel="Tandai handoff"
                          pendingLabel="Memproses…"
                          buttonClassName={`${btnSmall} bg-slate-900 text-white`}
                          buttonTitle={c?.owner_cpm_id ? undefined : "Creator belum di-assign CPM"}
                          compact
                        >
                          <input type="hidden" name="acquisition_id" value={a.id} />
                        </ActionForm>
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
                      <ActionForm
                        action={markReferralPaid}
                        submitLabel="Tandai dibayar"
                        pendingLabel="Memproses…"
                        buttonClassName={`${btnSmall} bg-green-600 text-white`}
                        compact
                      >
                        <input type="hidden" name="referral_id" value={r.id} />
                      </ActionForm>
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
