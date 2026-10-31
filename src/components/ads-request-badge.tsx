import { fundingBadgeLabel, type FundingType, type PaymentMethod } from "@/lib/m10/funding-spec";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "@/lib/m10/request";

/** Warna status Request Ads — satu sumber untuk /ads, /finance, Jadwal Live, Special Project. */
export const REQUEST_STATUS_STYLES: Record<RequestStatus, string> = {
  diajukan: "bg-slate-100 text-slate-700",
  menunggu_approval_director: "bg-purple-100 text-purple-800",
  menunggu_finance: "bg-amber-100 text-amber-800",
  siap_dieksekusi: "bg-blue-100 text-blue-800",
  dikerjakan: "bg-sky-100 text-sky-800",
  selesai: "bg-green-100 text-green-800",
  ditolak: "bg-red-100 text-red-800",
  batal: "bg-slate-200 text-slate-600",
  baru: "bg-slate-100 text-slate-700",
  menunggu_approval: "bg-purple-100 text-purple-800",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${REQUEST_STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700"}`}>
      {REQUEST_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function FundingBadge({ fundingType, paymentMethod }: { fundingType: FundingType | null; paymentMethod: PaymentMethod | null }) {
  const label = fundingBadgeLabel(fundingType, paymentMethod);
  if (!label) return <span className="text-xs text-slate-400">tanpa pendanaan (brief lama)</span>;
  const tone =
    fundingType === "mea_budget" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : fundingType === "tiktok_ads_credit" ? "bg-slate-50 text-slate-700 border-slate-200"
    : "bg-orange-50 text-orange-800 border-orange-200";
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs ${tone}`}>{label}</span>;
}
