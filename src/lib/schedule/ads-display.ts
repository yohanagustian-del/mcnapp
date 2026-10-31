// Tampilan "Ads" satu slot Jadwal Live — dipakai bersama kalender (`schedule-board.tsx`)
// dan daftar ringkas CM/BizDev Workspace (`compact-list.tsx`), supaya keduanya membaca
// sumber yang sama (D-2026-10-31-7): Request Ads (0100) menang; slot lama tanpa request
// tetap menampilkan `ads_payer`/`ads_note` lama dengan penanda "(lama)". Client-safe.

import { adsPayerLabel } from "./indicators";
import type { LiveScheduleSlot, SlotAdsRequestSummary } from "./types";
import { fundingBadgeLabel } from "@/lib/m10/funding-spec";
import { REQUEST_STATUS_LABELS } from "@/lib/m10/request";

export type SlotAdsSource = "request" | "legacy" | "none" | "off";

export interface SlotAdsDisplay {
  source: SlotAdsSource;
  /** "Budget MEA · Menunggu ACC" / "Brand (lama)" / null (OFF atau belum ada). */
  label: string | null;
  /** Nilai facet pendanaan: funding_type request, `legacy:<ads_payer>`, atau null. */
  facetValue: string | null;
  facetLabel: string | null;
  /** Nominal request (disetujui, fallback diminta); null untuk slot lama. */
  budget: number | null;
  /** Catatan bebas slot lama (`ads_note`); null bila slot punya request. */
  legacyNote: string | null;
  requestId: number | null;
}

export function slotAdsDisplay(
  slot: Pick<LiveScheduleSlot, "status" | "ads_payer" | "ads_note">,
  adsRequest: SlotAdsRequestSummary | null | undefined
): SlotAdsDisplay {
  if (slot.status === "off") {
    return { source: "off", label: null, facetValue: null, facetLabel: null, budget: null, legacyNote: null, requestId: null };
  }
  if (adsRequest) {
    const funding = fundingBadgeLabel(adsRequest.fundingType, adsRequest.paymentMethod);
    const status = REQUEST_STATUS_LABELS[adsRequest.status] ?? adsRequest.status;
    return {
      source: "request",
      label: `${funding ?? "Request"} · ${status}`,
      facetValue: adsRequest.fundingType ?? "request_lama",
      facetLabel: funding ?? "Request tanpa pendanaan",
      budget: adsRequest.budget,
      legacyNote: null,
      requestId: adsRequest.requestId,
    };
  }
  const payer = adsPayerLabel(slot.ads_payer);
  const note = slot.ads_note?.trim() || null;
  if (payer || note) {
    return {
      source: "legacy",
      label: payer ? `${payer} (lama)` : null,
      facetValue: slot.ads_payer ? `legacy:${slot.ads_payer}` : null,
      facetLabel: payer ? `${payer} (lama)` : null,
      budget: null,
      legacyNote: note,
      requestId: null,
    };
  }
  return { source: "none", label: null, facetValue: null, facetLabel: null, budget: null, legacyNote: null, requestId: null };
}
