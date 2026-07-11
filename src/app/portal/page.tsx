import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";

/** §2.2 — own performance dashboard (read-only surface of M2 aggregate; 0 token). */
export default async function CreatorDashboard() {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  // ===== Wave 1: independent lookups =====
  const [{ data: creator }, { data: periodRows }] = await Promise.all([
    admin.from("creators").select("name, level, niche, gmv").eq("id", creatorId).maybeSingle(),
    // Module 0.5 Fase 2: creator_period_summary — satu baris per creator per
    // periode (bukan platform_metrics_raw long-format per-hari); ambil batch
    // terbaru per periode, lalu render periode paling baru.
    admin
      .from("creator_period_summary")
      .select("period_start, period_end, created_at, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv, orders, items_sold")
      .eq("creator_id", creatorId)
      .order("period_start", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(24),
  ]);

  const latestPeriodStart = periodRows?.[0]?.period_start ?? null;
  const latest = latestPeriodStart
    ? (periodRows ?? []).find((r) => r.period_start === latestPeriodStart) ?? null
    : null;
  const metricCards = latest
    ? [
        { label: "affiliate_gmv", value: latest.affiliate_gmv },
        { label: "affiliate_live_gmv", value: latest.affiliate_live_gmv },
        { label: "affiliate_video_gmv", value: latest.affiliate_video_gmv },
        { label: "orders", value: latest.orders },
        { label: "items_sold", value: latest.items_sold },
      ]
    : [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Halo, {creator?.name ?? creatorId}</h1>
        <p className="text-sm text-slate-500">
          Level {creator?.level ?? "-"} · {creator?.niche ?? "-"} · data dari platform (read-only)
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-medium text-slate-700">
          Metrik terbaru {latest ? `(${latest.period_start}–${latest.period_end})` : ""}
        </h2>
        {metricCards.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada data metrik.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {metricCards.map((m) => (
              <div key={m.label} className="rounded-md bg-slate-50 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{m.label}</p>
                <p className="text-lg font-semibold">{Number(m.value ?? 0).toLocaleString("id-ID")}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="text-xs text-slate-400">
        Komisi MEA/margin & data kreator lain tidak ditampilkan — portal ini hanya menampilkan datamu sendiri.
      </p>
    </div>
  );
}
