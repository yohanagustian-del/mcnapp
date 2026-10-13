/**
 * TAP Matchmaking (REVISI_BIZDEV T7) — murni, 0 LLM: baris view `creator_shop_perf`
 * (per kreator × shop × periode, diagregasi SQL) untuk SATU shop → header + dua tabel.
 *
 *  - Kreator "pakai TAP" = GMV TAP > 0 di periode itu.
 *  - GAP = GMV MCN − GMV TAP (GMV kreator itu di shop ini yang TIDAK lewat link agency).
 *  - Shopee fase 1 (Q4): GMV TAP null → status "GMV TAP belum tersedia", bukan 0.
 */

export interface CreatorShopPerfRow {
  platform: string;
  creator_id: string;
  shop_id: string;
  shop_name: string | null;
  gmv_mcn: number | string | null;
  gmv_mcn_live: number | string | null;
  gmv_mcn_video: number | string | null;
  gmv_tap: number | string | null;
  gmv_tap_live: number | string | null;
  gmv_tap_video: number | string | null;
}

export interface CreatorInfo {
  name: string;
  username: string | null;
  cmName: string | null;
}

export type TapStatus = "tap" | "no_tap" | "unknown";

export interface MatchCreatorRow {
  creatorId: string;
  name: string;
  username: string | null;
  cmName: string;
  gmvMcn: number;
  gmvTap: number | null;
  gap: number | null;
  /** Pecahan sumber GMV TAP (kreator pakai TAP) atau GMV MCN (lainnya). */
  livePct: number | null;
  videoPct: number | null;
  status: TapStatus;
}

export interface TapMatchResult {
  shopName: string;
  platform: string;
  tapKnown: boolean;
  header: {
    totalCreatorTap: number;
    totalGmvTap: number | null;
    totalGmvMcnTapUsers: number;
    totalGmvAllCreators: number;
    totalCreators: number;
  };
  /** Tabel kiri: kreator pakai TAP, GMV TAP terbesar dulu. */
  tapCreators: MatchCreatorRow[];
  /** Tabel kanan: semua kreator dengan GMV di shop, GMV MCN terbesar dulu. */
  allCreators: MatchCreatorRow[];
}

export const TAP_STATUS_LABEL: Record<TapStatus, string> = {
  tap: "MCN · pakai TAP",
  no_tap: "Belum pakai TAP",
  unknown: "GMV TAP belum tersedia",
};

const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const share = (part: number | null, total: number | null) =>
  part !== null && total !== null && total > 0 ? part / total : null;

export function buildTapMatch(rows: CreatorShopPerfRow[], creators: Map<string, CreatorInfo>): TapMatchResult {
  // Satu shop bisa tercatat dengan 2 baris per kreator bila shop_id-nya sama di 2
  // platform — pemanggil sudah memfilter satu platform, tapi tetap dijumlah per kreator.
  const byCreator = new Map<string, MatchCreatorRow & { liveSrc: number; videoSrc: number; tapLive: number | null; tapVideo: number | null }>();
  let shopName = "";
  let platform = "";
  for (const r of rows) {
    if (!shopName && r.shop_name) shopName = r.shop_name;
    if (!platform) platform = r.platform;
    const info = creators.get(r.creator_id);
    const acc =
      byCreator.get(r.creator_id) ??
      {
        creatorId: r.creator_id, name: info?.name ?? r.creator_id, username: info?.username ?? null,
        cmName: info?.cmName ?? "—", gmvMcn: 0, gmvTap: null, gap: null, livePct: null, videoPct: null,
        status: "unknown" as TapStatus, liveSrc: 0, videoSrc: 0, tapLive: null, tapVideo: null,
      };
    acc.gmvMcn += n(r.gmv_mcn) ?? 0;
    acc.liveSrc += n(r.gmv_mcn_live) ?? 0;
    acc.videoSrc += n(r.gmv_mcn_video) ?? 0;
    const tap = n(r.gmv_tap);
    if (tap !== null) {
      acc.gmvTap = (acc.gmvTap ?? 0) + tap;
      acc.tapLive = (acc.tapLive ?? 0) + (n(r.gmv_tap_live) ?? 0);
      acc.tapVideo = (acc.tapVideo ?? 0) + (n(r.gmv_tap_video) ?? 0);
    }
    byCreator.set(r.creator_id, acc);
  }

  const all: MatchCreatorRow[] = [];
  for (const { liveSrc, videoSrc, tapLive, tapVideo, ...c } of byCreator.values()) {
    c.status = c.gmvTap === null ? "unknown" : c.gmvTap > 0 ? "tap" : "no_tap";
    c.gap = c.gmvTap === null ? null : c.gmvMcn - c.gmvTap;
    if (c.status === "tap") {
      c.livePct = share(tapLive, c.gmvTap);
      c.videoPct = share(tapVideo, c.gmvTap);
    } else {
      c.livePct = share(liveSrc, c.gmvMcn);
      c.videoPct = share(videoSrc, c.gmvMcn);
    }
    all.push(c);
  }
  all.sort((a, b) => b.gmvMcn - a.gmvMcn);
  const tapCreators = all.filter((c) => c.status === "tap").sort((a, b) => (b.gmvTap ?? 0) - (a.gmvTap ?? 0));
  const tapKnown = all.some((c) => c.gmvTap !== null);

  return {
    shopName,
    platform,
    tapKnown,
    header: {
      totalCreatorTap: tapCreators.length,
      totalGmvTap: tapKnown ? tapCreators.reduce((s, c) => s + (c.gmvTap ?? 0), 0) : null,
      totalGmvMcnTapUsers: tapCreators.reduce((s, c) => s + c.gmvMcn, 0),
      totalGmvAllCreators: all.reduce((s, c) => s + c.gmvMcn, 0),
      totalCreators: all.length,
    },
    tapCreators,
    allCreators: all,
  };
}

/** Ekspor CSV satu tombol (semua kreator di shop) — kolom sama dengan tabel kanan + GMV TAP/GAP. */
export function tapMatchCsv(result: TapMatchResult): string {
  const esc = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["Kreator", "Username", "CM", "Status", "GMV MCN", "GMV TAP", "GAP", "Live %", "Video %"].join(",")];
  for (const c of result.allCreators) {
    lines.push(
      [
        c.name, c.username ?? "", c.cmName, TAP_STATUS_LABEL[c.status], String(Math.round(c.gmvMcn)),
        c.gmvTap === null ? "" : String(Math.round(c.gmvTap)), c.gap === null ? "" : String(Math.round(c.gap)),
        c.livePct === null ? "" : (c.livePct * 100).toFixed(1), c.videoPct === null ? "" : (c.videoPct * 100).toFixed(1),
      ].map(esc).join(",")
    );
  }
  return lines.join("\n");
}
