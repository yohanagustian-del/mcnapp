/**
 * Pemilih periode (REVISI_BIZDEV Q2) — form GET biasa, tanpa JS: memilih lalu
 * "Tampilkan". `hidden` membawa parameter URL lain (mis. shop di TAP Matchmaking).
 */
export function PeriodPicker({
  value,
  options,
  hidden = {},
  action,
}: {
  value: string;
  options: { value: string; label: string }[];
  hidden?: Record<string, string | undefined>;
  action?: string;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label className="text-xs font-medium text-slate-600" htmlFor="period-picker">
        Periode
      </label>
      <select
        id="period-picker"
        name="period"
        defaultValue={value}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200">
        Tampilkan
      </button>
    </form>
  );
}
