// M3 OKR scoring engine — pure functions, 0 LLM, 0 DB deps.
// PRD §2.2: achievement biner (≥100%), progress tampil partial.

export type AggregationRule = "pribadi" | "tim" | "pribadi_tim";
export type GatingDecision  = "pending" | "gugur" | "tidak_gugur";

export interface RewardTier {
  role: string;
  kr_achieved_count: number;
  reward_amount: number | null; // null = TBD belum ditetapkan Director
}

export interface CpmActivity {
  creator_id: string;
  gmv_delta: number;  // positive = naik, negative = turun
  has_activity: boolean; // ada aktivitas CPM tercatat dalam window
}

// §2.2 LOCKED: % progres = actual / target (boleh > 100%).
export function computePctProgress(actual: number, target: number): number {
  if (target <= 0) return 0;
  return actual / target;
}

// §2.2 LOCKED: KR "achieve" hanya bila ≥ 100%.
export function isAchieved(pctProgress: number): boolean {
  return pctProgress >= 1.0;
}

// Hitung jumlah KR yang achieve dari daftar aktuals.
export function countAchievedKrs(actuals: { achieved: boolean }[]): number {
  return actuals.filter((a) => a.achieved).length;
}

// §2.5: map jumlah KR achieved → reward (ambil tier tertinggi yang eligible).
// Mengembalikan null bila tidak ada tier cocok atau reward_amount masih TBD (null).
export function mapRewardTier(
  role: string,
  achievedCount: number,
  tiers: RewardTier[]
): number | null {
  const eligible = tiers
    .filter((t) => t.role === role && t.kr_achieved_count <= achievedCount)
    .sort((a, b) => b.kr_achieved_count - a.kr_achieved_count);
  if (!eligible.length) return null;
  return eligible[0].reward_amount ?? null; // null = TBD
}

// §2.5: apakah reward_amount di tier TBD (belum ditetapkan Director)?
export function isRewardTbd(
  role: string,
  achievedCount: number,
  tiers: RewardTier[]
): boolean {
  const eligible = tiers
    .filter((t) => t.role === role && t.kr_achieved_count <= achievedCount)
    .sort((a, b) => b.kr_achieved_count - a.kr_achieved_count);
  if (!eligible.length) return false;
  return eligible[0].reward_amount === null;
}

// §2.7: hands-on GMV ratio per CPM.
// Hitung: GMV_naik_creator_dengan_aktivitas_CPM / total_GMV_naik_creator.
// Hanya menghitung creator dengan gmv_delta > 0. Korelasional, bukan kausal.
export function handsOnRatio(activities: CpmActivity[]): number | null {
  const total = activities.reduce(
    (s, a) => s + (a.gmv_delta > 0 ? a.gmv_delta : 0),
    0
  );
  if (total <= 0) return null;
  const handsOn = activities
    .filter((a) => a.has_activity && a.gmv_delta > 0)
    .reduce((s, a) => s + a.gmv_delta, 0);
  return handsOn / total;
}

// §2.3 LOCKED: gating = TANDAI "berisiko gugur" + log — TIDAK auto-gugur.
// gating_rule: { type: "any_occurrence" } = keberadaan evidence saja sudah memicu.
export function isGatingTriggered(
  gatingRule: Record<string, unknown> | null | undefined,
  hasEvidence: boolean
): boolean {
  if (!gatingRule) return false;
  if (gatingRule.type === "any_occurrence") return hasEvidence;
  return false;
}

// Label status OKR per KR (untuk UI badge).
export function okrStatusLabel(
  pct: number,
  gatingFlagged: boolean
): "achieved" | "berisiko-gugur" | "on-track" | "at-risk" | "belum-ada-data" {
  if (pct < 0) return "belum-ada-data";
  if (gatingFlagged) return "berisiko-gugur";
  if (pct >= 1.0) return "achieved";
  if (pct >= 0.7) return "on-track";
  return "at-risk";
}

// Warna badge status (Tailwind classes).
export function statusBadgeClass(status: ReturnType<typeof okrStatusLabel>): string {
  switch (status) {
    case "achieved":        return "bg-green-100 text-green-800";
    case "berisiko-gugur":  return "bg-red-100 text-red-800";
    case "on-track":        return "bg-blue-100 text-blue-800";
    case "at-risk":         return "bg-amber-100 text-amber-800";
    case "belum-ada-data":  return "bg-slate-100 text-slate-500";
  }
}

// Format pct_progress untuk tampilan (0.82 → "82%", 1.15 → "115%").
export function formatPct(pct: number): string {
  if (pct < 0) return "—";
  return `${Math.round(pct * 100)}%`;
}
