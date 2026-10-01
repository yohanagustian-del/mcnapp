import {
  partnershipTone,
  PARTNERSHIP_TONE_CLASS,
  type FeeAgreementStatus,
  type PartnershipStatus,
  type PartnershipStatusLabels,
} from "@/lib/creators/partnership-spec";

/**
 * Management Partnership / Fee Agreement badge — one rendering for CM Workspace,
 * /creators and /creators/[id] (Improvement MCN T6/T7). Labels + meanings come from
 * app_config m8.partnership_status_labels (resolved server-side, passed in).
 *
 *  - kind "fee" on a Shopee creator → "—" (Fee Agreement is TikTok-only)
 *  - no status yet → grey "Belum ada data"
 */
export function PartnershipBadge({
  kind,
  status,
  platform,
  labels,
}: {
  kind: "partnership" | "fee";
  status: PartnershipStatus | FeeAgreementStatus | null | undefined;
  platform?: string | null;
  labels: PartnershipStatusLabels;
}) {
  if (kind === "fee" && platform === "shopee") return <span className="text-slate-400">—</span>;
  const entry = status
    ? kind === "partnership"
      ? labels.partnership[status as PartnershipStatus]
      : labels.fee_agreement[status as FeeAgreementStatus]
    : undefined;
  const tone = PARTNERSHIP_TONE_CLASS[partnershipTone(status)];
  return (
    <span
      title={entry?.meaning || undefined}
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {entry?.label ?? "Belum ada data"}
    </span>
  );
}
