import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, canAccessNav, hasPermission, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
// Pipeline report campaign BD dipakai bersama halaman detail deal — satu parser,
// satu tabel, pemiliknya saja yang berbeda (deal_id / project_id).
import {
  addReportSession,
  uploadReportSessions,
  uploadReportCreators,
} from "@/lib/deals/report-actions";
import { CAMPAIGN_TYPE_LABEL } from "@/lib/deals/campaign-type";
import { PROJECT_STATUS_LABEL, sumProjectShops, type ProjectShopMetrics } from "@/lib/deals/bd-project";
import { ProjectFormButton, type ShopOption } from "../project-form-button";
import { DeleteProjectButton } from "./delete-project-button";

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

/**
 * Detail Project BD — bentuknya sengaja sejajar dengan detail Deal Brand
 * (/deals/DEAL-xxxxx): ringkasan di atas, daftar produk yang dikerjasamakan, lalu
 * tracking report campaign BD (report performance per sesi live + daftar creator
 * TC & Celeb) dengan importer yang sama persis.
 *
 * Bedanya cuma cakupan: detail deal melihat SATU brand, halaman ini melihat
 * beberapa shop sekaligus — jadi ada satu tabel tambahan, "Shop dalam Project",
 * dan angkanya penjumlahan ringkasan shop-shop itu. Tidak ada angka yang disimpan
 * di project: semuanya dibaca dari products_tap (CLAUDE.md #4).
 */
export default async function BdProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ creator?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/bd-projects")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canReport = hasPermission("m8.brand_report", member.role);
  const canManage = hasPermission("bd_project.manage", member.role);

  const { id } = await params;
  const { creator: creatorFilter } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("bd_projects")
    .select("id, name, status, notes, created_by, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();

  const { data: links } = await supabase
    .from("bd_project_shops")
    .select("shop_key")
    .eq("project_id", id);
  const shopKeys = (links ?? []).map((l) => l.shop_key as string);

  // Semua shop katalog tetap diambil: dipakai form Edit project (pilihan shop),
  // sekaligus jadi sumber ringkasan shop anggota project.
  const [{ data: allShops }, { data: sessions }, { data: proposals }, { data: memberRows }] =
    await Promise.all([
      supabase
        .from("products_tap_shop_summary")
        .select(
          "shop_key, shop_name, shop_id, product_count, active_count, needs_review_count, campaign_count, ads_budget, service_fee, gmv_tap, avg_commission_pct, effective_start, effective_end"
        )
        .order("product_count", { ascending: false })
        .limit(500),
      supabase
        .from("deal_live_sessions")
        .select("id, creator_name, session_date, event, support_ads, ads_spend_usd, ads_spend_idr, ss_link, gmv, roas")
        .eq("project_id", id)
        .order("session_date", { ascending: false })
        .limit(500),
      supabase
        .from("deal_creator_proposals")
        .select("id, username, cm_name, tipe_kreator, channel, gmv_l30d, rc_live, rc_vt, domisili, brand_approval, creator_approval, shipping_status, is_exclusive")
        .eq("project_id", id)
        .order("gmv_l30d", { ascending: false, nullsFirst: false })
        .limit(300),
      supabase.from("team_members").select("id, name"),
    ]);

  const shopOptions: ShopOption[] = (allShops ?? []).map((s) => ({
    shop_key: s.shop_key as string,
    shop_name: (s.shop_name as string | null) ?? null,
    shop_id: (s.shop_id as string | null) ?? null,
    product_count: numeric(s.product_count) ?? 0,
  }));

  const keySet = new Set(shopKeys);
  const shops = (allShops ?? [])
    .filter((s) => keySet.has(s.shop_key as string))
    .map((s) => ({
      shop_key: s.shop_key as string,
      shop_name: (s.shop_name as string | null) ?? null,
      shop_id: (s.shop_id as string | null) ?? null,
      product_count: numeric(s.product_count) ?? 0,
      active_count: numeric(s.active_count) ?? 0,
      needs_review_count: numeric(s.needs_review_count) ?? 0,
      campaign_count: numeric(s.campaign_count) ?? 0,
      ads_budget: numeric(s.ads_budget),
      service_fee: numeric(s.service_fee),
      gmv_tap: numeric(s.gmv_tap),
      avg_commission_pct: numeric(s.avg_commission_pct),
      effective_start: (s.effective_start as string | null) ?? null,
      effective_end: (s.effective_end as string | null) ?? null,
    }));
  const totals = sumProjectShops(shops as ProjectShopMetrics[]);
  const missingKeys = shopKeys.filter((k) => !shops.some((s) => s.shop_key === k));

  // Kartu produk milik shop-shop project. Difilter di SQL lewat shop_key — kunci
  // grup yang sama dengan view ringkasan (kolom generated, migrasi 0043).
  const { data: products } = shopKeys.length
    ? await supabase
        .from("products_tap")
        .select(
          "campaign_id, product_id, product_name, product_link, shop_name, shop_id, price, commission_pct, partner_commission_pct, effective_end, campaign_type, ads_budget, service_fee, active, needs_review"
        )
        .in("shop_key", shopKeys)
        .order("shop_name", { ascending: true })
        .limit(500)
    : { data: [] };

  const memberNameById = new Map<string, string>();
  for (const m of memberRows ?? []) memberNameById.set(m.id as string, m.name as string);

  // Report all creator vs report khusus per creator (exclusive MEA bisa >1) —
  // perilaku yang sama dengan detail deal.
  const creatorNames = [...new Set((sessions ?? []).map((s) => s.creator_name as string))].sort();
  const shown = creatorFilter
    ? (sessions ?? []).filter(
        (s) => (s.creator_name as string).toLowerCase() === creatorFilter.toLowerCase()
      )
    : (sessions ?? []);
  const totalSpendIdr = shown.reduce((a, s) => a + Number(s.ads_spend_idr ?? 0), 0);
  const totalGmv = shown.reduce((a, s) => a + Number(s.gmv ?? 0), 0);
  const overallRoas = totalSpendIdr > 0 ? totalGmv / totalSpendIdr : null;
  // Sisa ads dihitung dari SEMUA sesi project (bukan hanya filter creator aktif),
  // dibandingkan dengan total ads budget kartu produk project ini.
  const allSpendIdr = (sessions ?? []).reduce((a, s) => a + Number(s.ads_spend_idr ?? 0), 0);
  const sisaAds = totals.ads_budget != null ? totals.ads_budget - allSpendIdr : null;

  const infos: [string, string][] = [
    ["Shop / Brand", String(shopKeys.length)],
    ["Kartu Produk", String(totals.product_count)],
    ["Campaign", String(totals.campaign_count)],
    ["Ads Budget", formatRp(totals.ads_budget)],
    ["Service Fee", formatRp(totals.service_fee)],
    ["GMV TAP", formatRp(totals.gmv_tap)],
    ["Mulai", totals.effective_start ?? "—"],
    ["Exp Date", totals.effective_end ?? "—"],
    ["Status", PROJECT_STATUS_LABEL[project.status ?? ""] ?? "—"],
    ["Dibuat oleh", memberNameById.get((project.created_by as string) ?? "") ?? "—"],
    ["Dibuat", (project.created_at as string | null)?.slice(0, 10) ?? "—"],
    ["Perlu Review", String(totals.needs_review_count)],
  ];

  return (
    <div>
      <Link href="/bd-projects" className="text-sm text-slate-500 hover:underline">
        ← Kembali ke list project
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{project.id}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <ProjectFormButton
              shops={shopOptions}
              project={{
                id: project.id as string,
                name: project.name as string,
                status: (project.status as string | null) ?? "running",
                notes: (project.notes as string | null) ?? null,
                shop_keys: shopKeys,
              }}
              label="Edit Project"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            />
            <DeleteProjectButton
              project={{ id: project.id as string, name: project.name as string }}
            />
          </div>
        )}
      </div>

      {project.notes && <p className="mt-2 max-w-3xl text-sm text-slate-600">{project.notes}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-4">
        {infos.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase text-slate-400">{label}</p>
            <p className="mt-0.5 font-medium">{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Semua angka di atas dibaca dari kartu <strong>Produk TAP</strong> milik shop project ini —
        tidak ada yang disimpan di project. Perbaiki kartunya, angka di sini ikut benar.
      </p>

      {missingKeys.length > 0 && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {missingKeys.length} shop tidak ditemukan lagi di katalog Produk TAP (
          {missingKeys.slice(0, 3).join(", ")}
          {missingKeys.length > 3 ? ", …" : ""}). Biasanya Shop Name-nya diubah — pilih ulang
          shopnya lewat <strong>Edit Project</strong>.
        </p>
      )}

      {/* ===== Shop dalam project ===== */}
      <h2 className="mt-8 text-lg font-semibold">Shop dalam Project ({shops.length})</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Shop Name</th>
              <th className="px-3 py-3">Shop ID</th>
              <th className="px-3 py-3">Produk</th>
              <th className="px-3 py-3">Campaign</th>
              <th className="px-3 py-3">Komisi Kreator</th>
              <th className="px-3 py-3">Ads Budget</th>
              <th className="px-3 py-3">Service Fee</th>
              <th className="px-3 py-3">GMV TAP</th>
              <th className="px-3 py-3">Exp Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shops.map((s) => (
              <tr key={s.shop_key}>
                <td className="px-3 py-2 font-medium">{s.shop_name ?? s.shop_key}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.shop_id ?? "—"}</td>
                <td className="px-3 py-2">{s.product_count}</td>
                <td className="px-3 py-2">{s.campaign_count}</td>
                <td className="px-3 py-2">
                  {s.avg_commission_pct != null ? `${s.avg_commission_pct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2">{formatRp(s.ads_budget)}</td>
                <td className="px-3 py-2">{formatRp(s.service_fee)}</td>
                <td className="px-3 py-2">{formatRp(s.gmv_tap)}</td>
                <td className="px-3 py-2">{s.effective_end ?? "—"}</td>
              </tr>
            ))}
            {shops.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  Belum ada shop di project ini. Tambahkan lewat Edit Project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Produk yang dikerjasamakan ===== */}
      <h2 className="mt-8 text-lg font-semibold">
        Produk yang Dikerjasamakan ({(products ?? []).length})
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Product ID</th>
              <th className="px-3 py-3">Nama Produk</th>
              <th className="px-3 py-3">Shop</th>
              <th className="px-3 py-3">Link</th>
              <th className="px-3 py-3">Harga</th>
              <th className="px-3 py-3">Komisi Kreator</th>
              <th className="px-3 py-3">Komisi Partner</th>
              <th className="px-3 py-3">Tipe Campaign</th>
              <th className="px-3 py-3">Ads Budget</th>
              <th className="px-3 py-3">Service Fee</th>
              <th className="px-3 py-3">Exp Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(products ?? []).map((p) => (
              <tr key={`${p.campaign_id}|${p.product_id}`}>
                <td className="px-3 py-2 font-mono text-xs">{p.product_id as string}</td>
                <td className="px-3 py-2 font-medium">
                  {(p.product_name as string | null) ?? "—"}
                  {p.needs_review === true && (
                    <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                      review
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{(p.shop_name as string | null) ?? "—"}</td>
                <td className="px-3 py-2">
                  {p.product_link ? (
                    <a
                      href={p.product_link as string}
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
                <td className="px-3 py-2">{formatRp(numeric(p.price))}</td>
                <td className="px-3 py-2">
                  {p.commission_pct != null ? `${Number(p.commission_pct)}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.partner_commission_pct != null ? `${Number(p.partner_commission_pct)}%` : "—"}
                </td>
                <td className="px-3 py-2">
                  {CAMPAIGN_TYPE_LABEL[(p.campaign_type as string | null) ?? ""] ?? "—"}
                </td>
                <td className="px-3 py-2">{formatRp(numeric(p.ads_budget))}</td>
                <td className="px-3 py-2">{formatRp(numeric(p.service_fee))}</td>
                <td className="px-3 py-2">{(p.effective_end as string | null) ?? "—"}</td>
              </tr>
            ))}
            {(products ?? []).length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-6 text-center text-slate-400">
                  Belum ada kartu produk untuk shop project ini. Daftarkan lewat Registrasi Deal
                  atau upload master product list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(products ?? []).length >= 500 && (
        <p className="mt-2 text-xs text-amber-700">
          Ditampilkan 500 kartu pertama. Buka tab <strong>Produk TAP</strong> untuk daftar lengkap
          dengan filter.
        </p>
      )}

      {/* ===== Tracking Report Campaign (BD) — sama dengan detail Deal Brand ===== */}
      <h2 className="mt-10 text-lg font-semibold">Tracking Report Campaign (BD)</h2>
      <p className="mt-1 text-sm text-slate-500">
        Report per sesi live untuk project ini. <strong>Report All Creator</strong> = semua kreator
        project; klik nama kreator untuk <strong>report khusus</strong> (kreator exclusive MEA bisa
        lebih dari satu). Format filenya sama persis dengan report di detail Deal Brand.
      </p>

      {canReport && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <CsvUploadForm
            action={uploadReportSessions}
            buttonLabel="Upload Report Performance"
            helpText="Format contoh 'Report Performance' (xlsx/csv): id, Brand, Nama Creator, Tanggal Session Live, Event, Support Ads, Ads Spending, IDR, SS Dashboard (link), GMV, ROAS. Baris BULK-xxx di atas header & baris TOTAL otomatis dilewati. Re-upload = replace."
          >
            <input type="hidden" name="project_id" value={project.id as string} />
          </CsvUploadForm>
          <CsvUploadForm
            action={uploadReportCreators}
            buttonLabel="Upload Creator TC & Celeb"
            helpText="Daftar usulan creator campaign (format contoh 'Creator TC & Celeb'): Username, Creator Manager, Tipe Kreator, Channel, GMV L30D, Ratecard, Approval brand/creator, Status pengiriman."
          >
            <input type="hidden" name="project_id" value={project.id as string} />
          </CsvUploadForm>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">
            GMV {creatorFilter ? creatorFilter : "All Creator"}
          </p>
          <p className="mt-1 text-xl font-semibold">{formatRp(totalGmv)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Total Ads Spending</p>
          <p className="mt-1 text-xl font-semibold">{formatRp(totalSpendIdr)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">ROAS</p>
          <p className="mt-1 text-xl font-semibold">
            {overallRoas != null ? overallRoas.toFixed(2) : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase text-slate-500">Sisa Ads (vs budget project)</p>
          <p className={`mt-1 text-xl font-semibold ${sisaAds != null && sisaAds < 0 ? "text-red-600" : ""}`}>
            {sisaAds != null ? formatRp(sisaAds) : "—"}
          </p>
        </div>
      </div>

      {creatorNames.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <Link
            href={`/bd-projects/${project.id}`}
            className={`rounded-full px-3 py-1 ${!creatorFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            Report All Creator
          </Link>
          {creatorNames.map((n) => (
            <Link
              key={n}
              href={`/bd-projects/${project.id}?creator=${encodeURIComponent(n)}`}
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
              <tr key={s.id as number}>
                <td className="px-3 py-2 font-medium">{s.creator_name as string}</td>
                <td className="px-3 py-2">{(s.session_date as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(s.event as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(s.support_ads as string | null) ?? "—"}</td>
                <td className="px-3 py-2">
                  {s.ads_spend_usd != null ? `$${Number(s.ads_spend_usd).toLocaleString("en-US")}` : "—"}
                </td>
                <td className="px-3 py-2">{formatRp(numeric(s.ads_spend_idr))}</td>
                <td
                  className="px-3 py-2 max-w-[200px] truncate text-xs text-slate-500"
                  title={(s.ss_link as string | null) ?? ""}
                >
                  {(s.ss_link as string | null) ?? "—"}
                </td>
                <td className="px-3 py-2 font-medium">{formatRp(numeric(s.gmv))}</td>
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
          <summary className="cursor-pointer text-sm font-medium">
            + Input manual satu sesi live
          </summary>
          <form action={addReportSession} className="mt-3 grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="project_id" value={project.id as string} />
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
              <tr key={p.id as number}>
                <td className="px-3 py-2 font-medium">
                  {p.username as string}
                  {p.is_exclusive === true && (
                    <span className="ml-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800">
                      exclusive MEA
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{(p.cm_name as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(p.tipe_kreator as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(p.channel as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{formatRp(numeric(p.gmv_l30d))}</td>
                <td className="px-3 py-2 max-w-[160px] truncate" title={(p.rc_live as string | null) ?? ""}>
                  {(p.rc_live as string | null) ?? "—"}
                </td>
                <td className="px-3 py-2 max-w-[160px] truncate" title={(p.rc_vt as string | null) ?? ""}>
                  {(p.rc_vt as string | null) ?? "—"}
                </td>
                <td className="px-3 py-2">{(p.domisili as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(p.brand_approval as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(p.creator_approval as string | null) ?? "—"}</td>
                <td className="px-3 py-2">{(p.shipping_status as string | null) ?? "—"}</td>
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
