"use client";

import Link from "next/link";
import { DEAL_STATUS_OPTIONS } from "@/lib/deals/deal-status";
import { NON_BD_FILTER, NON_OPS_FILTER, PAGE_SIZE_OPTIONS, type BrandFilters } from "@/lib/deals/brand-table";

const selectCls = "rounded-md border border-slate-300 bg-white px-2 py-2 text-sm";

/**
 * Cari + filter tabel Deal Brand. Form GET biasa (bisa dibagikan sebagai URL); dropdown
 * langsung menerapkan filter saat diganti. Halaman kembali ke 1 karena `page` tidak ikut.
 */
export function BrandFiltersBar({
  filters,
  pageSize,
  options,
}: {
  filters: BrandFilters;
  pageSize: number;
  options: { platforms: string[]; bizdev: string[]; niches: string[]; priorities: string[]; campaignOps: { id: string; name: string }[] };
}) {
  const submit = (e: React.ChangeEvent<HTMLSelectElement>) => e.currentTarget.form?.requestSubmit();
  const active = Object.values(filters).some(Boolean);

  return (
    <form method="get" className="mt-4 flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={filters.q ?? ""}
        placeholder="Cari nama brand / Shop ID…"
        className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <select name="platform" defaultValue={filters.platform ?? ""} onChange={submit} className={selectCls} aria-label="Platform">
        <option value="">Semua platform</option>
        {options.platforms.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select name="bizdev" defaultValue={filters.bizdev ?? ""} onChange={submit} className={selectCls} aria-label="Bizdev">
        <option value="">Semua Bizdev</option>
        <option value={NON_BD_FILTER}>Non BD Handle</option>
        {options.bizdev.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select name="status" defaultValue={filters.status ?? ""} onChange={submit} className={selectCls} aria-label="Status">
        <option value="">Semua status</option>
        {DEAL_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select name="niche" defaultValue={filters.niche ?? ""} onChange={submit} className={selectCls} aria-label="Niche">
        <option value="">Semua niche</option>
        {options.niches.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      <select name="priority" defaultValue={filters.priority ?? ""} onChange={submit} className={selectCls} aria-label="Priority">
        <option value="">Semua priority</option>
        {options.priorities.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select name="ops" defaultValue={filters.ops ?? ""} onChange={submit} className={selectCls} aria-label="Campaign Ops">
        <option value="">Semua Campaign Ops</option>
        <option value={NON_OPS_FILTER}>Non Campaign Ops</option>
        {options.campaignOps.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <select name="size" defaultValue={String(pageSize)} onChange={submit} className={selectCls} aria-label="Baris per halaman">
        {PAGE_SIZE_OPTIONS.map((s) => <option key={s} value={s}>{s}/halaman</option>)}
      </select>
      <button type="submit" className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">Cari</button>
      {active && (
        <Link href="/deals" className="text-sm text-slate-500 underline">Reset</Link>
      )}
    </form>
  );
}
