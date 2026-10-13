import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMember, canAccessNav, hasPermission, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { isMissingRelationError, MIGRATION_0087_MISSING } from "@/lib/db/missing-migration";
import type { BrandReportData } from "@/lib/brand-report/build";
import { resolveTexts, type BrandReportTexts } from "@/lib/brand-report/rules";
import { BrandReportView } from "@/components/brand-report-view";
import { finalizeBrandReport } from "../actions";
import { EditBrandReportTextsForm } from "./edit-texts-form";

export const dynamic = "force-dynamic";

const rp = (n: unknown) =>
  n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`;

interface V1Data {
  deal?: { brand_name?: string; shop_id?: string; campaign_name?: string | null };
  totals?: { gmv?: number; live_gmv?: number; video_gmv?: number; orders?: number; creators?: number };
  ads_spend?: number | null;
  roas?: number | null;
  upgrade_recommendation?: boolean;
}

export default async function BrandReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/brand-reports")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const supabase = await createClient();
  const V1_COLS = "id, deal_id, period_start, period_end, data_json, summary_text, token_used, created_at, brand_deals(brand_name)";
  let missing = false;
  let row: Record<string, unknown> | null = null;
  const v2 = await supabase
    .from("brand_reports")
    .select(`${V1_COLS}, schema_version, status, edits_json, finalized_at`)
    .eq("id", id)
    .maybeSingle();
  if (v2.error && isMissingRelationError(v2.error)) {
    missing = true;
    const v1 = await supabase.from("brand_reports").select(V1_COLS).eq("id", id).maybeSingle();
    row = (v1.data as Record<string, unknown> | null) ?? null;
  } else {
    row = (v2.data as Record<string, unknown> | null) ?? null;
  }
  if (!row) notFound();

  const isV2 = Number(row.schema_version ?? 1) >= 2;
  const canEdit = hasPermission("m8.brand_report", member.role);

  if (!isV2) {
    const d = (row.data_json ?? {}) as V1Data;
    const t = d.totals ?? {};
    const brand = (row.brand_deals as { brand_name?: string } | null)?.brand_name ?? d.deal?.brand_name ?? "—";
    return (
      <div className="space-y-4">
        <Header title={brand} subtitle={`${row.period_start} → ${row.period_end} · report lama (v1), hanya bisa dibaca`} />
        {missing && <Banner>{MIGRATION_0087_MISSING}</Banner>}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {[
                ["Deal", String(row.deal_id ?? "—")],
                ["GMV", rp(t.gmv)],
                ["GMV live / video", `${rp(t.live_gmv)} / ${rp(t.video_gmv)}`],
                ["Order", String(t.orders ?? "—")],
                ["Kreator", String(t.creators ?? "—")],
                ["Ads spend", rp(d.ads_spend)],
                ["ROAS", d.roas ? d.roas.toFixed(2) : "—"],
                ["Upgrade?", d.upgrade_recommendation ? "✦ layak upgrade" : "—"],
              ].map(([k, v]) => (
                <tr key={k}><td className="w-48 px-4 py-2 text-slate-500">{k}</td><td className="px-4 py-2">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        {typeof row.summary_text === "string" && row.summary_text && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p className="text-xs text-slate-400">Ringkasan naratif lama ({Number(row.token_used ?? 0)} token)</p>
            <p className="mt-1 whitespace-pre-line">{row.summary_text}</p>
          </div>
        )}
      </div>
    );
  }

  const data = row.data_json as BrandReportData & { texts?: Partial<BrandReportTexts> };
  const texts = resolveTexts(data.texts ?? {}, row.edits_json);
  const isFinal = row.status === "final";

  return (
    <div className="space-y-4">
      <Header
        title={data.shop.shop_name}
        subtitle={`${data.shop.platform === "shopee" ? "Shopee" : "TikTok Shop"} · Shop ID ${data.shop.shop_id} · ${data.period.label} · ${isFinal ? "Final" : "Draft"} · 0 token AI`}
      />
      <BrandReportView data={data} texts={texts} />

      {canEdit && !isFinal && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold">Sunting teks</h2>
          <p className="mt-1 text-xs text-slate-500">
            Hanya kalimat yang bisa disunting; angka berasal dari data upload dan tidak bisa diubah. Kosongkan kolom
            untuk kembali ke kalimat bawaan.
          </p>
          <div className="mt-3">
            <EditBrandReportTextsForm reportId={id} texts={texts} />
          </div>
          <form action={finalizeBrandReport.bind(null, id)} className="mt-4 border-t border-slate-100 pt-4">
            <button type="submit" className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600">
              Finalkan report
            </button>
            <span className="ml-2 text-xs text-slate-500">Setelah final, teks terkunci.</span>
          </form>
        </section>
      )}
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <Link href="/brand-reports" className="text-sm text-slate-500 hover:underline">← Semua report</Link>
    </div>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{children}</p>;
}
