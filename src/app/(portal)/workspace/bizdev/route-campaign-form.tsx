"use client";

import { useActionState, useMemo, useState } from "react";
import { routeCampaignRequest, type RouteActionState } from "../campaign-actions";

const input = "rounded-md border border-slate-300 px-3 py-2 text-sm";

export interface RouteCreatorOption {
  id: string;
  name: string;
  username: string | null;
  hasOwner: boolean;
}

/** Searchable checkbox list — filter by name/username/id, centang yang dipilih. */
function CheckList({
  name,
  items,
  searchPlaceholder,
  emptyLabel,
  render,
  match,
}: {
  name: string;
  items: { value: string }[];
  searchPlaceholder: string;
  emptyLabel: string;
  render: (item: { value: string }) => React.ReactNode;
  match: (item: { value: string }, q: string) => boolean;
}) {
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items;
    return items.filter((it) => match(it, query));
  }, [q, items, match]);

  function toggle(value: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={searchPlaceholder}
        className={input}
      />
      {/* Hidden inputs untuk item terpilih — masuk FormData sebagai getAll(name). */}
      {[...checked].map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <div className="max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-slate-50">
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-slate-400">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((it) => (
              <li key={it.value}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-white">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={checked.has(it.value)}
                    onChange={() => toggle(it.value)}
                  />
                  <span className="min-w-0">{render(it)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      {checked.size > 0 && (
        <p className="text-xs text-slate-500">{checked.size} dipilih</p>
      )}
    </div>
  );
}

export function RouteCampaignForm({
  deals,
  creators,
  categories,
}: {
  deals: { id: string; brand_name: string }[];
  creators: RouteCreatorOption[];
  categories: string[];
}) {
  const [state, action, pending] = useActionState<RouteActionState | null, FormData>(
    routeCampaignRequest,
    null
  );

  const creatorItems = useMemo(() => creators.map((c) => ({ value: c.id })), [creators]);
  const creatorById = useMemo(() => new Map(creators.map((c) => [c.id, c])), [creators]);
  const categoryItems = useMemo(() => categories.map((c) => ({ value: c })), [categories]);

  return (
    <form action={action} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="deal_id" className={input}>
          <option value="">— deal / brand (wajib bila pilih kreator) —</option>
          {deals.map((d) => <option key={d.id} value={d.id}>{d.brand_name} ({d.id})</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" name="needs_brand_acc" className="h-4 w-4" />
          Brand minta acc creator dulu (per campaign — LOCKED §6.2)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-2">
          <input type="checkbox" name="creator_direct" className="h-4 w-4" />
          Creator dicarikan BizDev langsung (tanpa CM) — konfirmasi CM dilewati, tercatat
          sebagai kontribusi BizDev (hanya berlaku utk kolom kreator)
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Kolom 1: kreator terdaftar → route ke CM pemilik */}
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-slate-700">1. Kreator terdaftar</p>
            <p className="text-xs text-slate-500">Cari username/nama, centang → otomatis ke CM pemilik.</p>
          </div>
          <CheckList
            name="creator_ids"
            items={creatorItems}
            searchPlaceholder="Cari username / nama kreator…"
            emptyLabel="Tidak ada kreator cocok."
            match={(it, query) => {
              const c = creatorById.get(it.value);
              if (!c) return false;
              return (
                c.name.toLowerCase().includes(query) ||
                (c.username?.toLowerCase().includes(query) ?? false) ||
                c.id.toLowerCase().includes(query)
              );
            }}
            render={(it) => {
              const c = creatorById.get(it.value)!;
              return (
                <>
                  <span className="font-medium">{c.name}</span>{" "}
                  {c.username && <span className="text-xs text-slate-500">@{c.username}</span>}{" "}
                  <span className="text-xs text-slate-400">{c.id}</span>
                  {!c.hasOwner && (
                    <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">tanpa CPM</span>
                  )}
                </>
              );
            }}
          />
        </div>

        {/* Kolom 2: kategori level-2 / niche → semua CM dengan penjualan di kategori */}
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-slate-700">2. Kategori (level-2 / niche)</p>
            <p className="text-xs text-slate-500">Muncul di semua CM yang punya kreator dengan penjualan di kategori itu.</p>
          </div>
          <CheckList
            name="categories"
            items={categoryItems}
            searchPlaceholder="Cari kategori…"
            emptyLabel="Belum ada data kategori penjualan."
            match={(it, query) => it.value.toLowerCase().includes(query)}
            render={(it) => <span className="text-sm">{it.value}</span>}
          />
        </div>

        {/* Kolom 3: teks bebas → broadcast semua CM (bila kolom 1 & 2 kosong) */}
        <div className="flex flex-col gap-2">
          <div>
            <p className="text-sm font-medium text-slate-700">3. Request (teks bebas)</p>
            <p className="text-xs text-slate-500">Kebutuhan yang diminta. Bila kolom 1 & 2 kosong → broadcast ke semua CM.</p>
          </div>
          <textarea
            name="request_text"
            rows={8}
            placeholder="Tulis kebutuhan campaign / creator yang dicari…"
            className={`${input} flex-1`}
          />
        </div>
      </div>

      <input name="notes" placeholder="Catatan internal untuk CM (opsional)" className={input} />
      <button type="submit" disabled={pending}
        className="justify-self-start rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
        {pending ? "Routing…" : "Route ke CM"}
      </button>
      {state && (
        <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-600"}`}>{state.message}</p>
      )}
    </form>
  );
}
