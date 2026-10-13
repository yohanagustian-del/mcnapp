import { NON_BD_HANDLE_LABEL } from "@/lib/deals/bizdev-handler-spec";

/**
 * BizDev penanggung jawab brand (REVISI_BIZDEV T5). Tanpa handler → badge abu
 * "Non BD Handle". `names = null` = data handler tidak tersedia (migrasi 0087 belum
 * di-apply) → "—", bukan "Non BD Handle" yang menyesatkan.
 */
export function BizdevHandlerBadge({ names }: { names: string[] | null }) {
  if (names === null) return <span className="text-slate-400">—</span>;
  if (names.length === 0) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
        {NON_BD_HANDLE_LABEL}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {names.map((n) => (
        <span key={n} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
          {n}
        </span>
      ))}
    </span>
  );
}
