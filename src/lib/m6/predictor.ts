/**
 * BD Value Predictor (M6) — pool model, port logika HTML tim "BD_Value_predictor"
 * apa adanya (keputusan user 2026-09-23). Pure, deterministic, 0 LLM. TANPA
 * skenario komisi & TANPA pitch brand (dihapus dari scope M6 versi ini) —
 * output hanya daftar kreator potensial + potensi GMV.
 *
 * Semua konstanta rumus dari app_config `m6.pool_model` — jangan hardcode
 * (CLAUDE.md). File referensi HTML tim tidak ada di upload sesi penulisan file
 * ini; implementasi & test mengikuti spesifikasi tertulis di rencana §B.
 */

export interface PoolModelConfig {
  rampDefault: number;
  spreadBase: number;
  spreadPerCreator: number;
  spreadRoasFactor: number;
  spreadMin: number;
  spreadMax: number;
  confidencePerCreator: number;
  confidenceRoasFactor: number;
  confidenceRoasBase: number;
  confidenceRoasCap: number;
  confidenceLowMax: number;
  confidenceMediumMax: number;
  roasBenchmarkPct: number;
}

export type DealType = "tap" | "paid";

export interface PredictorInput {
  dealType: DealType;
  /** GMV sel (kategori × segmen) per kreator terpilih, dalam window (28 hari). */
  selectedCreatorGmv: number[];
  /** Anchor campaign (Rp) — dipakai hanya saat dealType !== 'tap'. 0 = tidak ada. */
  anchor: number;
  /** Ramp-up 0..1 (slider; default dari config.rampDefault). */
  ramp: number;
  /** ROAS manual (override), 0 = tidak diisi. */
  roas: number;
  /** Ads budget (Rp), dipakai bersama roas untuk adUpside. */
  budget: number;
}

export type ConfidenceLabel = "Rendah" | "Sedang" | "Tinggi";

export interface PredictorResult {
  hist: number;
  withHist: number;
  organic: number;
  adUpside: number;
  likely: number;
  spread: number;
  conservative: number;
  optimistic: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rumus HTML persis (lihat rencana §B):
 *   hist = Σ gmv sel kreator terpilih; withHist = jumlah kreator dgn gmv sel > 0
 *   organic = tap ? hist×ramp : (anchor>0 ? 0.5×hist×ramp + 0.5×anchor : hist)
 *   adUpside = roas>0 && budget>0 ? roas×budget : 0; likely = organic + adUpside
 *   spread = clamp(spreadBase − withHist×spreadPerCreator − (roas>0 ? (roas−benchmark)×spreadRoasFactor : 0), spreadMin, spreadMax)
 *   cons = likely×(1−spread); opt = likely×(1+spread)
 *   confidence = likely<=0 ? 0 : min(100, round(withHist×confidencePerCreator + (roas>0 ? min(roas,cap)×roasFactor + roasBase : 0)))
 */
export function compute(input: PredictorInput, config: PoolModelConfig): PredictorResult {
  const hist = input.selectedCreatorGmv.reduce((sum, g) => sum + g, 0);
  const withHist = input.selectedCreatorGmv.filter((g) => g > 0).length;

  const organic =
    input.dealType === "tap"
      ? hist * input.ramp
      : input.anchor > 0
        ? 0.5 * hist * input.ramp + 0.5 * input.anchor
        : hist;

  const adUpside = input.roas > 0 && input.budget > 0 ? input.roas * input.budget : 0;
  const likely = organic + adUpside;

  const roasSpreadAdj = input.roas > 0 ? (input.roas - config.roasBenchmarkPct) * config.spreadRoasFactor : 0;
  const spread = clamp(
    config.spreadBase - withHist * config.spreadPerCreator - roasSpreadAdj,
    config.spreadMin,
    config.spreadMax
  );

  const conservative = likely * (1 - spread);
  const optimistic = likely * (1 + spread);

  let confidence = 0;
  if (likely > 0) {
    const roasConfidence = input.roas > 0 ? Math.min(input.roas, config.confidenceRoasCap) * config.confidenceRoasFactor + config.confidenceRoasBase : 0;
    confidence = Math.min(100, Math.round(withHist * config.confidencePerCreator + roasConfidence));
  }

  const confidenceLabel: ConfidenceLabel =
    confidence < config.confidenceLowMax ? "Rendah" : confidence < config.confidenceMediumMax ? "Sedang" : "Tinggi";

  return { hist, withHist, organic, adUpside, likely, spread, conservative, optimistic, confidence, confidenceLabel };
}

/** Rata-rata ROAS histori (deal_live_sessions.roas) untuk saran default — hanya baris roas > 0. Null bila tidak ada. */
export function averageRoas(roasValues: (number | null | undefined)[]): number | null {
  const positive = roasValues.filter((r): r is number => typeof r === "number" && r > 0);
  if (positive.length === 0) return null;
  return positive.reduce((sum, r) => sum + r, 0) / positive.length;
}

// ---------- ekspor daftar kreator pool ----------

export interface CreatorPoolRow {
  creatorId: string;
  username: string;
  gmvCell: number;
  orders: number;
  liveShare: number | null;
  roasRef: number | null;
}

const formatRupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const formatPct = (n: number | null) => (n == null ? "-" : `${(n * 100).toFixed(1)}%`);

export function buildTextExport(rows: CreatorPoolRow[]): string {
  return rows
    .map((r) => `${r.username} — GMV ${formatRupiah(r.gmvCell)} · ${r.orders} order · live ${formatPct(r.liveShare)}`)
    .join("\n");
}

export function buildTableExport(rows: CreatorPoolRow[]): string {
  const header = ["Username", "GMV Sel", "Order", "% Live", "ROAS Ref"].join("\t");
  const lines = rows.map((r) =>
    [r.username, Math.round(r.gmvCell), r.orders, formatPct(r.liveShare), r.roasRef ?? "-"].join("\t")
  );
  return [header, ...lines].join("\n");
}

function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsvExport(rows: CreatorPoolRow[]): string {
  const header = ["Username", "GMV Sel", "Order", "% Live", "ROAS Ref"].map(csvField).join(",");
  const lines = rows.map((r) =>
    [r.username, Math.round(r.gmvCell), r.orders, formatPct(r.liveShare), r.roasRef ?? "-"].map(csvField).join(",")
  );
  return [header, ...lines].join("\n");
}
