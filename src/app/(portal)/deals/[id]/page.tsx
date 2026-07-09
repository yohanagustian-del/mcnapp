import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, canAccessNav, hasPermission, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { addDealSession, uploadDealSessions, uploadCreatorProposals } from "./report-actions";

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

/** Halaman 2: produk yang didaftarkan brand + tracking report campaign BD. */
export default async function DealDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ creator?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/deals")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canReport = hasPermission("m8.brand_report", member.role);

  const { id } = await params;
  const { creator: creatorFilter } = await searchParams;
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("brand_deals")
    .select(
      "id, brand_name, shop_id, niche, exp_date, campaign_name, komisi_kreator_raw, komisi_mea_raw, ads_budget, service_fee, campaign_type, sourced_by_role, status, contact_pic_brand"
    )
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  const [{ data: products }, { data: sessions }, { data: proposals }] = await Promise.all([
    supabase
      .from("deal_products")
      .select(
        "id, product_id, product_name, product_link, niche, exp_date, komisi_kreator_pct, komisi_mea_pct, ads_budget, service_fee, status"
      )
      .eq("deal_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("deal_live_sessions")
      .select("id, creator_name, session_date, event, support_ads, ads_spend_usd, ads_spend_idr, ss_link, gmv, roas")
      .eq("deal_id", id)
      .order("session_date", { ascending: false })
      .limit(500),
    supabase
      .from("deal_creator_proposals")
      .select("id, username, cm_name, tipe_kreator, channel, gmv_l30d, rc_live, rc_vt, domisili, brand_approval, creator_approval, shipping_status, is_exclusive")
      .eq("deal_id", id)
      .order("gmv_l30d", { ascending: false, nullsFirst: false })
      .limit(300),
  ]);

  // Report all creator vs report khusus per creator (exclusive MEA bisa >1).
  const creatorNames = [...new Set((sessions ?? []).map((s) => s.creator_name))].sort();
  const shown = creatorFilter
    ? (sessions ?? []).filter((s) => s.creator_name.toLowerCase() === creatorFilter.toLowerCase())
    : (sessions ?? []);
  const totalSpendIdr = shown.reduce((a, s) => a + Number(s.ads_spend_idr ?? 0), 0);
  const totalGmv = shown.reduce((a, s) => a + Number(s.gmv ?? 0), 0);
  const overallRoas = totalSpendIdr > 0 ? totalGmv / totalSpendIdr : null;
  // Sisa ads dihitung dari SEMUA sesi deal (bukan hanya filter creator aktif).
  const allSpendIdr = (sessions ?? []).reduce((a, s) => a + Number(s.ads_spend_idr ?? 0), 0);
  const sisaAds = deal.ads_budget != null ? Number(deal.ads_budget) - allSpendIdr : null;

  const infos: [string, string][] = [
    ["Shop ID", deal.shop_id ?? "—"],
    ["Niche", deal.niche ?? "—"],
    ["Exp Date", deal.exp_date ?? "—"],
    ["Campaign", deal.campaign_name ?? "—"],
    ["Komisi Kreator", deal.komisi_kreator_raw ?? "—"],
    ["Komisi MEA", deal.komisi_mea_raw ?? "—"],
    ["Ads Budget", formatRp(deal.ads_budget)],
    ["Service Fee", formatRp(deal.service_fee)],
    ["Tipe Campaign", deal.campaign_type === "sample" ? "Sample (non-berbayar)" : deal.campaign_type === "extra_commission" ? "Komisi Extra (non-berbayar)" : "Paid"],
    ["Didaftarkan oleh", deal.sourced_by_role === "cm" ? "CM (tanpa BizDev)" : "BizDev"],
    ["PIC Brand", deal.contact_pic_brand ?? "—"],
    ["Status", deal.status ?? "—"],
  ];

  return (
    <div>
      <Link href="/deals" className="text-sm text-slate-500 hover:underline">
        ← Kembali ke list brand
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{deal.brand_name}</h1>
      <p className="mt-1 font-mono text-xs text-slate-500">{deal.id}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-4">
        {infos.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase text-slate-400">{label}</p>
            <p className="mt-0.5 font-medium">{value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold">
        Produk yang Dikerjasamakan ({(products ?? []).length})
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Product ID</th>
              <th className="px-3 py-3">Nama Produk</th>
              <th className="px-3 py-3">Link</th>
              <th className="px-3 py-3">Niche</th>
              <th className="px-3 py-3">Exp Date</th>
              <th className="px-3 py-3">Komisi Kreator</th>
              <th className="px-3 py-3">Komisi MEA</th>
              <th className="px-3 py-3">Ads Budget</th>
              <th className="px-3 py-3">Service Fee</th>
              <th className="px-3 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(products ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs">{p.product_id ?? "—"}</td>
                <td className="px-3 py-2 font-medium">{p.product_name}</td>
                <td className="px-3 py-2">
                  {p.product_link ? (
                    <a
                      href={p.product_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-700 underline"
                    >
                      buka ↗
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">{p.niche ?? "—"}</td>
                <td className="px-3 py-2">{p.exp_date ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.komisi_kreator_pct != null ? `${p.komisi_kreator_pct}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.komisi_mea_pct != null ? `${p.komisi_mea_pct}%` : "—"}
                </td>
                <td className="px-3 py-2">{formatRp(p.ads_budget)}</td>
                <td className="px-3 py-2">{formatRp(p.service_fee)}</td>
                <td className="px-3 py-2">{p.status}</td>
              </tr>
            ))}
            {(products ?? []).length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  Belum ada produk terdaftar untuk brand ini. Tambahkan lewat form registrasi
                  deal atau upload excel.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Tracking Report Campaign (BD) — contoh: Femmy x MEA Report Performance ===== */}
      <h2 className="mt-10 text-lg font-semibold">Tracking Report Campaign (BD)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Report per sesi live. <strong>Report All Creator</strong> = semua kreator campaign;
        klik nama kreator untuk <strong>report khusus</strong> (kreator exclusive MEA bisa
        lebih dari satu).
      </p>

      {canReport && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CsvUploadForm
            action={uploadDealSessions}
            buttonLabel="Upload Report Performance"
            helpText="Format contoh 'Report Performance' (xlsx/csv): id, Brand, Nama Creator, Tanggal Session Live, Event, Support Ads, Ads Spending, IDR, SS Dashboard (link), GMV, ROAS. Baris BULK-xxx di atas header & baris TOTAL otomatis dilewati. Re-upload = replace."
          >
            <input type="hidden" name="deal_id" value={deal.id} />
          </CsvUploadForm>
          <CsvUploadForm
            action={uploadCreatorProposals}
            buttonLabel="Upload Creator TC & Celeb"
            helpText="Daftar usulan creator campaign (format contoh 'Creator TC & Celeb'): Username, Creator Manager, Tipe Kreator, Channel, GMV L30D, Ratecard, Approval brand/creator, Status pengiriman."
          >
            <input type="hidden" name="deal_id" value={deal.id} />
          </CsvUploadForm>
        </div>
      )}

      {/* summary report (mengikuti filter creator aktif) */}
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">GMV {creatorFilter ? creatorFilter : "All Creator"}</p>
          <p className="mt-1 text-xl font-semibold">{formatRp(totalGmv)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Total Ads Spending</p>
          <p className="mt-1 text-xl font-semibold">{formatRp(totalSpendIdr)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">ROAS</p>
          <p className="mt-1 text-xl font-semibold">{overallRoas != null ? overallRoas.toFixed(2) : "—"}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Sisa Ads (vs budget deal)</p>
          <p className={`mt-1 text-xl font-semibold ${sisaAds != null && sisaAds < 0 ? "text-red-600" : ""}`}>
            {sisaAds != null ? formatRp(sisaAds) : "—"}
          </p>
        </div>
      </div>

      {/* filter report khusus per creator */}
      {creatorNames.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/deals/${deal.id}`}
            className={`rounded-full px-3 py-1 ${!creatorFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            Report All Creator
          </Link>
          {creatorNames.map((n) => (
            <Link
              key={n}
              href={`/deals/${deal.id}?creator=${encodeURIComponent(n)}`}
              className={`rounded-full px-3 py-1 ${creatorFilter?.toLowerCase() === n.toLowerCase() ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {n}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Creator</th>
              <th className="px-3 py-3">Tanggal Session</th>
              <th className="px-3 py-3">Event</th>
              <th className="px-3 py-3">Support Ads</th>
              <th className="px-3 py-3">Ads Spending ($)</th>
              <th className="px-3 py-3">IDR</th>
              <th className="px-3 py-3">SS Dashboard</th>
              <th className="px-3 py-3">GMV</th>
              <th className="px-3 py-3">ROAS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-2 font-medium">{s.creator_name}</td>
                <td className="px-3 py-2">{s.session_date ?? "—"}</td>
                <td className="px-3 py-2">{s.event ?? "—"}</td>
                <td className="px-3 py-2">{s.support_ads ?? "—"}</td>
                <td className="px-3 py-2">{s.ads_spend_usd != null ? `$${Number(s.ads_spend_usd).toLocaleString("en-US")}` : "—"}</td>
                <td className="px-3 py-2">{formatRp(s.ads_spend_idr)}</td>
                <td className="px-3 py-2 max-w-[200px] truncate text-xs text-slate-500" title={s.ss_link ?? ""}>
                  {s.ss_link ?? "—"}
                </td>
                <td className="px-3 py-2 font-medium">{formatRp(s.gmv)}</td>
                <td className="px-3 py-2">{s.roas != null ? Number(s.roas).toFixed(2) : "—"}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  Belum ada report sesi{creatorFilter ? ` untuk ${creatorFilter}` : ""}. Upload
                  report performance atau input manual di bawah.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canReport && (
        <details className="mt-3 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">+ Input manual satu sesi live</summary>
          <form action={addDealSession} className="mt-3 grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="deal_id" value={deal.id} />
            <input name="creator_name" required placeholder="Nama creator (username)" className={input} />
            <input type="date" name="session_date" required className={input} />
            <input name="event" placeholder="Event (Payday/Reguler/Twindate...)" className={input} />
            <input name="ads_spend_usd" placeholder="Ads spending $ (mis. 75.25)" className={input} />
            <input name="ads_spend_idr" placeholder="IDR (mis. Rp1,296,097)" className={input} />
            <input name="gmv" required placeholder="GMV (mis. Rp14,626,698)" className={input} />
            <input name="roas" placeholder="ROAS (mis. 11.29)" className={input} />
            <input name="ss_link" placeholder="SS Dashboard (nama file/link)" className={`${input} sm:col-span-2`} />
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 sm:col-span-3"
            >
              Simpan Sesi
            </button>
          </form>
        </details>
      )}

      {/* ===== Creator campaign (TC & Celeb) ===== */}
      <h2 className="mt-10 text-lg font-semibold">
        Creator Campaign — TC &amp; Celeb ({(proposals ?? []).length})
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Username</th>
              <th className="px-3 py-3">CM</th>
              <th className="px-3 py-3">Tipe</th>
              <th className="px-3 py-3">Channel</th>
              <th className="px-3 py-3">GMV L30D</th>
              <th className="px-3 py-3">RC Live</th>
              <th className="px-3 py-3">RC VT</th>
              <th className="px-3 py-3">Domisili</th>
              <th className="px-3 py-3">Approval Brand</th>
              <th className="px-3 py-3">Approval Creator</th>
              <th className="px-3 py-3">Pengiriman</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(proposals ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-medium">
                  {p.username}
                  {p.is_exclusive && (
                    <span className="ml-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                      exclusive MEA
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{p.cm_name ?? "—"}</td>
                <td className="px-3 py-2">{p.tipe_kreator ?? "—"}</td>
                <td className="px-3 py-2">{p.channel ?? "—"}</td>
                <td className="px-3 py-2">{formatRp(p.gmv_l30d)}</td>
                <td className="px-3 py-2 max-w-[160px] truncate" title={p.rc_live ?? ""}>{p.rc_live ?? "—"}</td>
                <td className="px-3 py-2 max-w-[160px] truncate" title={p.rc_vt ?? ""}>{p.rc_vt ?? "—"}</td>
                <td className="px-3 py-2">{p.domisili ?? "—"}</td>
                <td className="px-3 py-2">{p.brand_approval ?? "—"}</td>
                <td className="px-3 py-2">{p.creator_approval ?? "—"}</td>
                <td className="px-3 py-2">{p.shipping_status ?? "—"}</td>
              </tr>
            ))}
            {(proposals ?? []).length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                  Belum ada daftar creator campaign. Upload file &quot;Creator TC &amp; Celeb&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
