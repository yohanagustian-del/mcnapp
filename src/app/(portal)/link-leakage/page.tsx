import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadCooperatingShops } from "./actions";
import { DownloadCsvButton } from "./download-csv-button";

const STATUS_LABELS: Record<string, string> = {
  via_agency: "Via Link Agency",
  bocor_sebagian: "Bocor Sebagian",
  bocor_total: "Bocor Total",
  belum_ada_link: "Belum Ada Link",
};
const STATUS_STYLES: Record<string, string> = {
  via_agency: "bg-green-100 text-green-800",
  bocor_sebagian: "bg-amber-100 text-amber-800",
  bocor_total: "bg-red-100 text-red-800",
  belum_ada_link: "bg-slate-100 text-slate-600",
};
/** Label + style untuk link_status = NULL (artifak format v2 — "Ringkasan Creator"
 * tidak punya breakdown bocor/TAP per kreator, jadi status memang tidak diketahui,
 * BUKAN via_agency/0 — lihat leak-artifact.ts writeUnknownLeakRollups). */
const UNKNOWN_STATUS_LABEL = "Belum diketahui (artifak v2)";
const UNKNOWN_STATUS_STYLE = "bg-slate-100 text-slate-500";

const rupiah = (n: number | null) =>
  n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`;

/**
 * /link-leakage adalah halaman READ-ONLY (keputusan arsitektur final): analisis
 * link-leakage TIDAK LAGI dihitung oleh engine M4 di platform (src/lib/m4/engine.ts
 * sudah tidak dipanggil). Data kini datang dari upload mingguan CM lewat /ingest
 * "Lane 2" — hasil artifak Excel eksternal "Agency Leaked Generator" (format v1/v2,
 * lihat src/lib/ingest/leak-artifact.ts). Platform hanya MENYIMPAN:
 *   - rollup per kreator per minggu → creator_link_status (kolom bisa NULL untuk
 *     artifak v2 = belum diketahui, bukan nol/via_agency)
 *   - totals level-CM per minggu → leak_week_summary
 *   - lead BizDev (shop non-deal) → bd_leads (source='artifact')
 * Detail produk bocor per (product_id, shop_id) TIDAK disimpan lagi ke depan —
 * detail itu tetap ada di file Excel artifak yang diupload CM. Tabel
 * `leakage_products` di bawah ini karena itu HANYA berisi data historis era engine
 * (sebelum migrasi ke artifak) dan tidak lagi bertambah untuk minggu baru.
 * Halaman ini tidak punya endpoint edit apa pun untuk rollup — satu-satunya upload
 * action di sini adalah uploadCooperatingShops (refresh master shop platform),
 * yang bukan bagian dari ingest mingguan Lane 1/Lane 2.
 */
export default async function LinkLeakagePage({
  searchParams,
}: {
  searchParams: Promise<{ creator_id?: string; week?: string }>;
}) {
  const member = await requireMember();
  const canUpload = hasPermission("m4.upload", member.role);

  const { creator_id: creatorIdFilter, week: weekFilter } = await searchParams;

  const supabase = await createClient();

  // Detail produk bocor: leakage_products TIDAK diisi lagi untuk minggu baru (era
  // artifak menyimpan rollup saja) — apa pun yang muncul di sini adalah sisa data
  // historis dari era engine, ditampilkan dengan keterangan jelas, bukan tabel
  // kosong yang menyesatkan.
  let detailQuery = supabase
    .from("leakage_products")
    .select("week, shop_id, shop_name, product_id, product_name, gmv_bocor, link_status, creator_id")
    .order("week", { ascending: false })
    .order("gmv_bocor", { ascending: false })
    .limit(200);
  if (creatorIdFilter?.trim()) detailQuery = detailQuery.eq("creator_id", creatorIdFilter.trim());
  if (weekFilter?.trim()) detailQuery = detailQuery.eq("week", weekFilter.trim());

  // ===== Wave 1: independent lookups =====
  // `latest` (latest rollup week) doesn't gate these — leads/alerts/detailQuery/
  // weekSummary are all independent of it; only `rollup` (wave 2) needs latestWeek.
  const [{ data: latest }, { data: leads }, { data: alerts }, { data: leakDetail }, { data: weekSummary }] =
    await Promise.all([
      // Latest week with a rollup on file (written by the /ingest Lane 2 artifact
      // upload — not computed on the platform, see leak-rollup.ts).
      supabase
        .from("creator_link_status")
        .select("week")
        .order("week", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("bd_leads")
        .select("shop_id, shop_name, frequency, total_gmv, priority_score, first_seen_week, status")
        .order("priority_score", { ascending: false })
        .limit(50),
      supabase
        .from("platform_alerts")
        .select("id, alert_type, entity_id, message, week, created_at")
        .eq("resolved", false)
        .order("created_at", { ascending: false })
        .limit(50),
      detailQuery,
      // Totals level-CM per minggu dari artifak (leak-artifact.ts writeLeakWeekSummary).
      supabase
        .from("leak_week_summary")
        .select("week, period_end, gmv_affiliate_total, gmv_tap, gmv_leak_potential, source_format, uploaded_by")
        .order("week", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
  const latestWeek: string | null = latest?.week ?? null;

  // ===== Wave 2: depends on latestWeek (wave 1 output) =====
  const { data: rollup } = latestWeek
    ? await supabase
        .from("creator_link_status")
        .select("creator_id, week, gmv_deal_total, gmv_bocor, leak_ratio, link_status, source, creators(name)")
        .eq("week", latestWeek)
        .order("leak_ratio", { ascending: false, nullsFirst: false })
        .limit(200)
    : { data: [] as never[] };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Link Leakage</h1>
      <p className="mt-1 text-sm text-slate-500">
        Rollup status link agency per kreator, bersumber dari upload artifak mingguan CM (file
        Excel hasil <em>Agency Leaked Generator</em>) lewat menu{" "}
        <Link href="/ingest" className="text-blue-700 underline">
          Upload Mingguan (Ingest)
        </Link>{" "}
        — bukan lagi dihitung oleh platform. Halaman ini read-only; satu-satunya cara mengubah
        rollup adalah upload artifak minggu berikutnya.
        {latestWeek && <> Minggu rollup terakhir: <strong>{latestWeek}</strong>.</>}
      </p>
      {weekSummary && (
        <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Total minggu {weekSummary.week} ({weekSummary.source_format === "artifact_v1" ? "artifak v1" : "artifak v2"}):
          Affiliate {rupiah(weekSummary.gmv_affiliate_total)} · TAP {rupiah(weekSummary.gmv_tap)} · Potensi bocor{" "}
          {rupiah(weekSummary.gmv_leak_potential)}
        </p>
      )}

      {canUpload && (
        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <CsvUploadForm
            action={uploadCooperatingShops}
            buttonLabel="Refresh Master Shop"
            helpText="Master All Cooperating Shops dari platform (mingguan). deal_end internal tidak tersentuh."
          />
        </div>
      )}

      <h2 className="mt-8 text-lg font-medium">Status Creator{latestWeek ? ` — minggu ${latestWeek}` : ""}</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">GMV Shop Ber-deal</th>
              <th className="px-4 py-3">GMV Bocor</th>
              <th className="px-4 py-3">Rasio</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rollup ?? []).map((r) => (
              <tr key={r.creator_id}>
                <td className="px-4 py-2 font-medium">
                  {(r.creators as unknown as { name: string } | null)?.name ?? r.creator_id}
                  <span className="ml-1 text-xs text-slate-400">{r.creator_id}</span>
                  {r.source === "artifact" && (
                    <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-700">artifak</span>
                  )}
                </td>
                <td className="px-4 py-2">{rupiah(r.gmv_deal_total)}</td>
                <td className="px-4 py-2">{rupiah(r.gmv_bocor)}</td>
                <td className="px-4 py-2">{r.leak_ratio === null ? "—" : `${(r.leak_ratio * 100).toFixed(1)}%`}</td>
                <td className="px-4 py-2">
                  {r.link_status === null ? (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${UNKNOWN_STATUS_STYLE}`}
                      title="Artifak format ringkas (v2) tidak punya breakdown bocor per kreator"
                    >
                      {UNKNOWN_STATUS_LABEL}
                    </span>
                  ) : (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.link_status] ?? ""}`}>
                      {STATUS_LABELS[r.link_status] ?? r.link_status}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(rollup ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Belum ada rollup. Upload artifak mingguan lewat menu Upload Mingguan (Ingest).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 text-lg font-medium">Detail Produk Bocor</h2>
      <p className="mt-1 text-sm text-slate-500">
        Detail per produk bocor (product_id, shop_id) tidak lagi disimpan di platform — detail itu
        ada di file Excel artifak (sheet &quot;Produk Bocor&quot;/&quot;Leaked_Products_All&quot;)
        yang diupload CM lewat{" "}
        <Link href="/ingest" className="text-blue-700 underline">
          Upload Mingguan (Ingest)
        </Link>
        . Buka file artifak minggu tersebut untuk melihat rincian produk.
      </p>
      {(leakDetail ?? []).length > 0 && (
        <>
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Tabel di bawah adalah data historis era engine (sebelum migrasi ke artifak) — tidak
            bertambah untuk minggu baru.
          </p>
          <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs text-slate-500">Creator ID</label>
              <input
                type="text" name="creator_id" defaultValue={creatorIdFilter ?? ""}
                placeholder="CRT-xxxxx"
                className="w-40 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Minggu</label>
              <input
                type="date" name="week" defaultValue={weekFilter ?? ""}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200"
            >
              Filter
            </button>
            {(creatorIdFilter || weekFilter) && (
              <Link href="/link-leakage" className="self-center text-sm text-slate-500 underline">
                Reset
              </Link>
            )}
            <div className="ml-auto">
              <DownloadCsvButton
                creatorId={creatorIdFilter ?? null}
                week={weekFilter ?? null}
                label="Download CSV Detail (historis)"
              />
            </div>
          </form>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Minggu</th>
                  <th className="px-4 py-3">Shop</th>
                  <th className="px-4 py-3">Produk</th>
                  <th className="px-4 py-3">GMV Bocor</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(leakDetail ?? []).map((d) => (
                  <tr key={`${d.week}-${d.shop_id}-${d.product_id}`}>
                    <td className="px-4 py-2">{d.week}</td>
                    <td className="px-4 py-2">
                      {d.shop_name ?? d.shop_id}
                      <span className="ml-1 text-xs text-slate-400">{d.shop_id}</span>
                    </td>
                    <td className="px-4 py-2">
                      {d.product_name ?? d.product_id}
                      <span className="ml-1 text-xs text-slate-400">{d.product_id}</span>
                    </td>
                    <td className="px-4 py-2">{rupiah(d.gmv_bocor)}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[d.link_status] ?? ""}`}>
                        {STATUS_LABELS[d.link_status] ?? d.link_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-lg font-medium">Lead BizDev (shop non-deal)</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Shop / ID</th>
                  <th className="px-4 py-3">Frekuensi</th>
                  <th className="px-4 py-3">Total GMV</th>
                  <th className="px-4 py-3">Prioritas</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(leads ?? []).map((l) => (
                  <tr key={l.shop_id}>
                    <td className="px-4 py-2">
                      {l.shop_name ? (
                        <>
                          {l.shop_name}
                          <span className="block font-mono text-xs text-slate-400">{l.shop_id}</span>
                        </>
                      ) : (
                        <span className="font-mono text-xs">{l.shop_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{l.frequency}</td>
                    <td className="px-4 py-2">{rupiah(l.total_gmv)}</td>
                    <td className="px-4 py-2">{Number(l.priority_score).toLocaleString("id-ID")}</td>
                    <td className="px-4 py-2">{l.status}</td>
                  </tr>
                ))}
                {(leads ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Belum ada lead.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-medium">Alert Terbuka</h2>
          <div className="mt-2 space-y-2">
            {(alerts ?? []).map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                  a.alert_type === "link_bocor" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"
                }`}>
                  {a.alert_type}
                </span>
                {a.message}
                <span className="ml-2 text-xs text-slate-400">{a.week ?? ""}</span>
              </div>
            ))}
            {(alerts ?? []).length === 0 && (
              <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
                Tidak ada alert terbuka.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
