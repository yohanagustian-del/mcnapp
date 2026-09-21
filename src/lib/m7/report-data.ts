/**
 * M7 v2 Special Project — report peserta `data_json` builder (PRD §6.8, K5).
 * Rank and cohort averages are read from `project_creator_report_v`, computed
 * IN SQL (window functions) — this file only shapes what the view/queries
 * already computed into the JSON contract; it never re-aggregates raw rows
 * (CLAUDE.md #4: one source of truth) and never calls an LLM.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildLiveNotes } from "./live-notes";

/**
 * Live-session detail (PRD addendum §9/§10.4) — the part of the report that
 * describes HOW the live ran, not just what it totalled: the 30-minute timeline,
 * the tayang → beli funnel, and the efficiency/interaction figures.
 *
 * Split of sources follows §9 exactly, no second implementation of either:
 *  - `project_live_sessions` = the Product-file totals (commerce truth) plus the
 *    session's own meta (brand, jam, durasi) and the Trend totals already stored
 *    at upload (views, viewers_peak, impressions_live).
 *  - `project_live_intervals` = the timeline AND the interaction counts, which
 *    exist per interval only (the session-level columns for likes/comments/
 *    shares/new_followers are not written by the ingest).
 * Ratios (ctr/ctor/gpm) are derived here, once, from those stored counts.
 */
export interface ProjectReportLive {
  sessions: number;
  /** Nomor sesi, hanya ketika report ini memang satu sesi (judul "— Sesi 1"). */
  session_no: number | null;
  brands: string[];
  first_date: string | null;
  last_date: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_min: number;
  /** Live-session scope (the funnel below is a live funnel, not a project-wide one). */
  gmv: number;
  orders: number;
  items: number;
  customers: number;
  views: number;
  viewers_peak: number;
  /** null when no session carries it — uploads before this was parsed (§9). */
  impressions_live: number | null;
  product_impressions: number;
  product_clicks: number;
  add_to_cart: number;
  likes: number;
  comments: number;
  shares: number;
  new_followers: number;
  ctr: number | null;
  ctor: number | null;
  gpm: number | null;
  /** Trend Stats' own GMV total vs the Product file's — shown as a data note (§10.2 V6). */
  gmv_trend: number | null;
  gmv_trend_diff: number | null;
  timeline: { label: string; gmv: number; viewers: number | null }[];
  /**
   * Apa yang laku, bukan cuma berapa — inti angle report KREATOR. Diambil dari
   * baris file Product yang disimpan `project_live_session_products` (migrasi
   * 0062); kosong untuk sesi yang di-upload sebelum tabel itu ada.
   */
  products: { name: string; gmv: number; items: number; clicks: number }[];
  /** Jumlah produk di etalase sesi (semua baris file Product) & yang benar-benar terjual. */
  products_total: number;
  products_sold: number;
  /** Produk dengan impresi terbanyak yang belum menghasilkan pesanan sama sekali. */
  top_unsold: { name: string; impressions: number } | null;
  /** Rata-rata item per pesanan — pembeda "jualan satuan" vs "jualan paket". */
  items_per_order: number | null;
  /** CTR produk seluruh peserta live project ini, sebagai pembanding yang adil. */
  cohort_ctr: number | null;
  cohort_creators: number;
  /**
   * Catatan performa deterministik (live-notes.ts) — bukan narasi LLM, jadi
   * selalu ada walau ANTHROPIC_API_KEY tidak di-set dan boleh tampil di draft.
   */
  notes: string[];
}

export interface ProjectReportData {
  period: {
    /**
     * `project` = report peserta Special Project. `live_slot` = report live
     * stream satu slot Jadwal Live (migrasi 0066) — bentuk datanya SAMA supaya
     * satu komponen (ProjectReportView) merender keduanya; `project_id` null
     * dan `project_name` berisi brand/judul slot.
     */
    type: "project" | "live_slot";
    start: string;
    end: string;
    project_id: number | null;
    project_name: string;
    project_type: string;
  };
  /** Hanya untuk `period.type = live_slot`: identitas slot jadwal yang direport. */
  slot?: {
    id: number;
    schedule_date: string;
    brand_name: string | null;
    planned_start: string | null;
    planned_end: string | null;
    actual_start: string | null;
    actual_end: string | null;
    status: string;
  };
  creator: { id: string; name: string; username: string | null; level: number | null; niche: string | null };
  target: { personal_gmv: number; project_gmv: number };
  metrics: {
    gmv: number; live_gmv: number; video_gmv: number; orders: number; items: number;
    aov: number; live_share: number; active_days: number;
  };
  achievement: { personal_pct: number; share_of_project: number; rank: number; of: number };
  cohort_avg: { gmv: number; live_share: number; active_days: number };
  daily: { date: string; gmv: number }[];
  top_products: { name: string; gmv: number; items: number }[];
  /** Absent on reports generated before live detail existed — renderers must tolerate it. */
  live?: ProjectReportLive;
  /**
   * Rincian yang SAMA, dipecah per HARI sesi — supaya kreator bisa membaca
   * "tanggal 15 saya bagaimana" tanpa harus mengurai angka gabungan sendiri
   * (permintaan tim 2026-09-17). Hanya ada ketika sesinya lebih dari satu hari;
   * untuk project satu hari, `live` sudah merupakan harinya.
   */
  live_days?: ProjectReportLive[];
}

/**
 * Builds one participant's project report data. Throws when the project or
 * the participant isn't found — the caller (generate action) is expected to
 * have already validated both exist before calling this.
 */
export async function buildProjectReportData(
  supabase: SupabaseClient,
  projectId: number,
  creatorId: string
): Promise<ProjectReportData> {
  const [{ data: project }, { data: creator }, { data: participant }, { data: reportRow }, { data: dailyRows }, { data: productRows }] =
    await Promise.all([
      supabase.from("special_projects").select("id, name, type, start_date, end_date, target_gmv").eq("id", projectId).single(),
      supabase.from("creators").select("id, name, username, level, niche").eq("id", creatorId).single(),
      supabase.from("project_participants").select("target_gmv").eq("project_id", projectId).eq("creator_id", creatorId).single(),
      supabase
        .from("project_creator_report_v")
        .select("gmv, live_gmv, video_gmv, orders, items, active_days, live_share, rank, of, project_total_gmv, cohort_avg_gmv, cohort_avg_live_share, cohort_avg_active_days")
        .eq("project_id", projectId).eq("creator_id", creatorId).maybeSingle(),
      supabase
        .from("project_creator_metrics")
        .select("date, gmv_actual")
        .eq("project_id", projectId).eq("creator_id", creatorId).order("date"),
      supabase
        .from("project_creator_products")
        .select("product_name, gmv, items")
        .eq("project_id", projectId).eq("creator_id", creatorId)
        .order("gmv", { ascending: false }).limit(3),
    ]);

  if (!project) throw new Error("Project tidak ditemukan");
  if (!creator) throw new Error("Kreator tidak ditemukan");
  if (!participant) throw new Error("Kreator ini bukan peserta project");

  const liveDetail = await buildLiveDetail(supabase, { projectId, creatorId });
  const live = liveDetail?.live ?? null;

  // R29: peserta gmv=0 (belum pernah punya baris di project_creator_metrics,
  // sehingga TIDAK muncul di project_creator_report_v) tetap dapat report —
  // isi nol daripada gagal.
  const r = reportRow ?? {
    gmv: 0, live_gmv: 0, video_gmv: 0, orders: 0, items: 0, active_days: 0, live_share: 0,
    rank: null, of: null, project_total_gmv: 0, cohort_avg_gmv: 0, cohort_avg_live_share: 0, cohort_avg_active_days: 0,
  };

  const gmv = Number(r.gmv ?? 0);
  const orders = Number(r.orders ?? 0);
  const personalTarget = Number(participant.target_gmv ?? 0);
  const projectTotalGmv = Number(r.project_total_gmv ?? 0);

  return {
    period: {
      type: "project", start: project.start_date, end: project.end_date,
      project_id: project.id, project_name: project.name, project_type: project.type,
    },
    creator: { id: creator.id, name: creator.name, username: creator.username ?? null, level: creator.level, niche: creator.niche },
    target: { personal_gmv: personalTarget, project_gmv: Number(project.target_gmv ?? 0) },
    metrics: {
      gmv, live_gmv: Number(r.live_gmv ?? 0), video_gmv: Number(r.video_gmv ?? 0),
      orders, items: Number(r.items ?? 0), aov: orders > 0 ? gmv / orders : 0,
      live_share: Number(r.live_share ?? 0), active_days: Number(r.active_days ?? 0),
    },
    achievement: {
      personal_pct: personalTarget > 0 ? gmv / personalTarget : 0,
      share_of_project: projectTotalGmv > 0 ? gmv / projectTotalGmv : 0,
      // No row in the view = only this creator has zero activity in a project with
      // no other participants yet either; rank/of degrade to 1/1 rather than null.
      rank: r.rank ?? 1,
      of: r.of ?? 1,
    },
    cohort_avg: {
      gmv: Number(r.cohort_avg_gmv ?? 0),
      live_share: Number(r.cohort_avg_live_share ?? 0),
      active_days: Number(r.cohort_avg_active_days ?? 0),
    },
    daily: (dailyRows ?? []).map((d) => ({ date: d.date, gmv: Number(d.gmv_actual ?? 0) })),
    top_products: (productRows ?? []).map((p) => ({
      name: p.product_name ?? "—", gmv: Number(p.gmv ?? 0), items: Number(p.items ?? 0),
    })),
    ...(live ? { live } : {}),
    ...(liveDetail && liveDetail.days.length > 1 ? { live_days: liveDetail.days } : {}),
  };
}

const sum = (rows: Record<string, unknown>[], key: string): number =>
  rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

/**
 * Live-session detail for one participant, or null when they have no countable
 * session yet (R41: only verified/confirmed_manual sessions exist for a report).
 * Pure reads + sums of stored columns — no re-derivation of anything the upload
 * pipeline already computed, and no LLM anywhere (CLAUDE.md #1/#4).
 *
 * Mengembalikan gabungan SEKALIGUS pecahan per hari. Semua baris diambil sekali
 * lalu dibentuk berkali-kali di memori — memecah per hari lewat query terpisah
 * akan menjadi N+1 untuk project yang berjalan seminggu.
 */
/**
 * Lingkup sesi yang dibaca: peserta di satu project (kohort = project itu),
 * atau satu slot Jadwal Live (tanpa kohort — slot berdiri sendiri).
 */
export type LiveDetailScope =
  | { projectId: number; creatorId: string }
  | { slotId: number };

const SESSION_COLUMNS =
  "id, session_date, session_no, brand, start_time, end_time, duration_min, gmv, gmv_trend, orders, items, customers, views, viewers_peak, impressions_live, product_impressions, product_clicks, add_to_cart";

async function buildLiveDetail(
  supabase: SupabaseClient,
  scope: LiveDetailScope
): Promise<{ live: ProjectReportLive; days: ProjectReportLive[] } | null> {
  let sessionQuery = supabase
    .from("project_live_sessions")
    .select(SESSION_COLUMNS)
    .in("attribution_status", ["verified", "confirmed_manual"]);
  sessionQuery =
    "slotId" in scope
      ? sessionQuery.eq("schedule_slot_id", scope.slotId)
      : sessionQuery.eq("project_id", scope.projectId).eq("creator_id", scope.creatorId);
  const { data: sessionRows } = await sessionQuery.order("session_date").order("session_no");

  const sessions = sessionRows ?? [];
  if (sessions.length === 0) return null;

  const sessionIds = sessions.map((s) => s.id);
  const [{ data: intervalRows }, { data: productRows }, { data: cohortRows }] = await Promise.all([
    supabase
      .from("project_live_intervals")
      .select("session_id, time, gmv, viewers, likes, comments, shares, new_followers")
      .in("session_id", sessionIds)
      .order("session_id").order("time"),
    supabase
      .from("project_live_session_products")
      .select("session_id, product_id, product_name, gmv, items, orders, product_impressions, product_clicks")
      .in("session_id", sessionIds),
    // Pembanding CTR: seluruh sesi live yang dihitung di project ini (R41), bukan
    // hanya peserta ini — dipakai sebagai satu kalimat pembanding di catatan.
    // Sengaja TIDAK dipecah per hari: pembandingnya adalah project, bukan tanggal.
    // Slot jadwal tidak punya kohort: satu slot = satu kreator.
    "slotId" in scope
      ? Promise.resolve({ data: [] as LiveRow[] })
      : supabase
          .from("project_live_sessions")
          .select("creator_id, product_impressions, product_clicks")
          .eq("project_id", scope.projectId)
          .in("attribution_status", ["verified", "confirmed_manual"]),
  ]);
  const intervals = intervalRows ?? [];
  const products = productRows ?? [];
  const cohort = (cohortRows ?? []) as LiveRow[];

  const dates = [...new Set(sessions.map((s) => s.session_date as string))].sort();
  const live = shapeLive(sessions, intervals, products, cohort);

  // Satu report per hari sesi, dibentuk dari irisan baris yang sama.
  const days = dates.map((date) => {
    const daySessions = sessions.filter((s) => s.session_date === date);
    const dayIds = new Set(daySessions.map((s) => s.id));
    return shapeLive(
      daySessions,
      intervals.filter((i) => dayIds.has(i.session_id)),
      products.filter((r) => dayIds.has(r.session_id)),
      cohort
    );
  });

  return { live, days };
}

type LiveRow = Record<string, unknown>;

/**
 * Membentuk satu `ProjectReportLive` dari kumpulan baris yang sudah diambil.
 * Murni, tanpa I/O — inilah yang membuat gabungan dan tiap harinya dihitung
 * dengan definisi yang PERSIS SAMA (CLAUDE.md #4: satu sumber kebenaran, bukan
 * dua rumus yang kebetulan mirip).
 */
function shapeLive(
  sessions: LiveRow[],
  intervals: LiveRow[],
  productRows: LiveRow[],
  cohortRows: LiveRow[]
): ProjectReportLive {
  const gmv = sum(sessions, "gmv");
  const orders = sum(sessions, "orders");
  const views = sum(sessions, "views");
  const productImpressions = sum(sessions, "product_impressions");
  const productClicks = sum(sessions, "product_clicks");

  // impressions_live is null on sessions uploaded before it was parsed; a report
  // must say "unknown" there rather than draw a zero bar at the top of the funnel.
  const impressionRows = sessions.filter((s) => s.impressions_live !== null);

  const times = (key: "start_time" | "end_time") =>
    sessions.map((s) => s[key]).filter((t): t is string => Boolean(t)).map((t) => t.slice(0, 5)).sort();
  const startTimes = times("start_time");
  const endTimes = times("end_time");

  const dates = [...new Set(sessions.map((s) => s.session_date as string))].sort();
  const sessionDate = new Map(sessions.map((s) => [s.id, s.session_date as string]));
  const singleDay = dates.length <= 1;

  const gmvTrend = sessions.some((s) => s.gmv_trend !== null) ? sum(sessions, "gmv_trend") : null;

  // Satu produk bisa muncul di beberapa sesi — digabung per product_id dulu,
  // supaya "produk terlaris" berarti sepanjang report, bukan per sesi.
  const byProduct = new Map<
    string,
    { name: string; gmv: number; items: number; orders: number; impressions: number; clicks: number }
  >();
  for (const r of productRows) {
    const key = String(r.product_id);
    const acc = byProduct.get(key) ?? {
      name: (r.product_name as string | null) ?? "—", gmv: 0, items: 0, orders: 0, impressions: 0, clicks: 0,
    };
    acc.name = (r.product_name as string | null) ?? acc.name;
    acc.gmv += Number(r.gmv ?? 0);
    acc.items += Number(r.items ?? 0);
    acc.orders += Number(r.orders ?? 0);
    acc.impressions += Number(r.product_impressions ?? 0);
    acc.clicks += Number(r.product_clicks ?? 0);
    byProduct.set(key, acc);
  }
  const allProducts = [...byProduct.values()];
  const soldProducts = allProducts.filter((p) => p.items > 0 || p.gmv > 0);
  const unsold = allProducts
    .filter((p) => p.orders === 0 && p.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)[0];

  const cohortImpressions = sum(cohortRows, "product_impressions");
  const cohortClicks = sum(cohortRows, "product_clicks");
  const cohortCreators = new Set(cohortRows.map((r) => r.creator_id)).size;

  const live: ProjectReportLive = {
    sessions: sessions.length,
    session_no: sessions.length === 1 ? Number(sessions[0].session_no) : null,
    brands: [...new Set(sessions.map((s) => s.brand).filter((b): b is string => Boolean(b)))],
    first_date: dates[0] ?? null,
    last_date: dates[dates.length - 1] ?? null,
    start_time: startTimes[0] ?? null,
    end_time: endTimes[endTimes.length - 1] ?? null,
    duration_min: sum(sessions, "duration_min"),
    gmv,
    orders,
    items: sum(sessions, "items"),
    customers: sum(sessions, "customers"),
    views,
    viewers_peak: sessions.reduce((max, s) => Math.max(max, Number(s.viewers_peak ?? 0)), 0),
    impressions_live: impressionRows.length > 0 ? sum(impressionRows, "impressions_live") : null,
    product_impressions: productImpressions,
    product_clicks: productClicks,
    add_to_cart: sum(sessions, "add_to_cart"),
    likes: sum(intervals, "likes"),
    comments: sum(intervals, "comments"),
    shares: sum(intervals, "shares"),
    new_followers: sum(intervals, "new_followers"),
    ctr: productImpressions > 0 ? productClicks / productImpressions : null,
    ctor: productClicks > 0 ? orders / productClicks : null,
    gpm: views > 0 ? (gmv / views) * 1000 : null,
    gmv_trend: gmvTrend,
    gmv_trend_diff: gmvTrend === null ? null : gmvTrend - gmv,
    products: soldProducts
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 5)
      .map((p) => ({ name: p.name, gmv: p.gmv, items: p.items, clicks: p.clicks })),
    products_total: allProducts.length,
    products_sold: soldProducts.length,
    top_unsold: unsold ? { name: unsold.name, impressions: unsold.impressions } : null,
    items_per_order: orders > 0 ? sum(sessions, "items") / orders : null,
    cohort_ctr: cohortImpressions > 0 ? cohortClicks / cohortImpressions : null,
    cohort_creators: cohortCreators,
    timeline: intervals.map((i) => ({
      // One session reads as a clock; several days need the date to stay readable.
      label: singleDay
        ? String(i.time)
        : `${(sessionDate.get(i.session_id as number) ?? "").slice(5)} ${i.time}`,
      gmv: Number(i.gmv ?? 0),
      viewers: i.viewers === null ? null : Number(i.viewers),
    })),
    notes: [],
  };

  return { ...live, notes: buildLiveNotes(live) };
}

/**
 * Report live stream SATU slot Jadwal Live (migrasi 0066). Bentuk keluarannya
 * `ProjectReportData` yang sama dengan report peserta project — bukan tipe
 * baru — supaya halaman tim, portal kreator, dan catatan deterministik
 * (live-notes) dipakai apa adanya (CLAUDE.md #4). Tidak ada target pribadi,
 * peringkat, maupun kohort pada slot: kolom-kolom itu diisi netral (0 / 1 dari 1)
 * dan komponen tampilan menyembunyikannya untuk `period.type = live_slot`.
 *
 * Throws bila slot/kreator tidak ada; mengembalikan `live` undefined (angka nol)
 * bila slot belum punya sesi yang dihitung — pemanggil yang memutuskan apakah
 * report tanpa sesi layak dibuat.
 */
export async function buildSlotLiveReportData(
  supabase: SupabaseClient,
  slotId: number
): Promise<ProjectReportData> {
  const { data: slot } = await supabase
    .from("live_schedule_slots")
    .select("id, creator_id, schedule_date, start_time, end_time, actual_start, actual_end, brand_name, status")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) throw new Error("Slot jadwal tidak ditemukan");

  const { data: creator } = await supabase
    .from("creators").select("id, name, username, level, niche").eq("id", slot.creator_id).single();
  if (!creator) throw new Error("Kreator tidak ditemukan");

  const liveDetail = await buildLiveDetail(supabase, { slotId });
  const live = liveDetail?.live ?? null;

  const gmv = live?.gmv ?? 0;
  const orders = live?.orders ?? 0;
  const dates = liveDetail ? liveDetail.days.map((d) => d.first_date).filter((d): d is string => Boolean(d)) : [];
  const brand = (slot.brand_name as string | null)?.trim() || null;

  return {
    period: {
      type: "live_slot",
      start: live?.first_date ?? slot.schedule_date,
      end: live?.last_date ?? slot.schedule_date,
      project_id: null,
      project_name: brand ?? "Live Stream",
      project_type: "live_slot",
    },
    slot: {
      id: slot.id as number,
      schedule_date: slot.schedule_date as string,
      brand_name: brand,
      planned_start: (slot.start_time as string | null)?.slice(0, 5) ?? null,
      planned_end: (slot.end_time as string | null)?.slice(0, 5) ?? null,
      actual_start: (slot.actual_start as string | null)?.slice(0, 5) ?? null,
      actual_end: (slot.actual_end as string | null)?.slice(0, 5) ?? null,
      status: slot.status as string,
    },
    creator: { id: creator.id, name: creator.name, username: creator.username ?? null, level: creator.level, niche: creator.niche },
    target: { personal_gmv: 0, project_gmv: 0 },
    metrics: {
      gmv, live_gmv: gmv, video_gmv: 0,
      orders, items: live?.items ?? 0, aov: orders > 0 ? gmv / orders : 0,
      live_share: gmv > 0 ? 1 : 0, active_days: dates.length,
    },
    achievement: { personal_pct: 0, share_of_project: gmv > 0 ? 1 : 0, rank: 1, of: 1 },
    cohort_avg: { gmv: 0, live_share: 0, active_days: 0 },
    daily: (liveDetail?.days ?? []).map((d) => ({ date: d.first_date ?? slot.schedule_date, gmv: d.gmv })),
    top_products: (live?.products ?? []).slice(0, 3).map((p) => ({ name: p.name, gmv: p.gmv, items: p.items })),
    ...(live ? { live } : {}),
    ...(liveDetail && liveDetail.days.length > 1 ? { live_days: liveDetail.days } : {}),
  };
}
