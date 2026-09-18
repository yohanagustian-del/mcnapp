"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  PLATFORM_OPTIONS,
  CHANNEL_OPTIONS,
  fromWaContact,
  type ExternalApproachRow,
} from "@/lib/workspace/external-approach";
import { updateApproach, deleteApproach, type ApproachFormState } from "./actions";
import { ApproachFields, inputCls } from "./approach-fields";

const platformLabel = (v: string | null) => PLATFORM_OPTIONS.find((p) => p.value === v)?.label ?? v ?? "—";
const channelLabel = (v: string | null) => CHANNEL_OPTIONS.find((c) => c.value === v)?.label ?? v ?? "—";
const rupiah = (n: number | null) => (n === null || n === undefined ? "—" : `Rp${Math.round(Number(n)).toLocaleString("id-ID")}`);

interface ColumnDef {
  key: string;
  label: string;
  defaultVisible: boolean;
  get: (r: ExternalApproachRow) => string | number | null;
  render?: (r: ExternalApproachRow) => React.ReactNode;
}

const COLUMNS: ColumnDef[] = [
  { key: "creator_name", label: "Username", defaultVisible: true, get: (r) => r.creator_name },
  { key: "brand", label: "Brand", defaultVisible: true, get: (r) => r.brand },
  { key: "niche", label: "Niche", defaultVisible: true, get: (r) => r.niche },
  { key: "platform", label: "Platform", defaultVisible: true, get: (r) => r.platform, render: (r) => platformLabel(r.platform) },
  { key: "followers", label: "Followers", defaultVisible: true, get: (r) => r.followers },
  { key: "wa_contact", label: "Kontak WA", defaultVisible: false, get: (r) => r.wa_contact, render: (r) => (r.wa_contact ? `+${r.wa_contact}` : "—") },
  { key: "gmv", label: "GMV", defaultVisible: true, get: (r) => r.gmv, render: (r) => rupiah(r.gmv) },
  { key: "channel", label: "Channel", defaultVisible: true, get: (r) => r.channel, render: (r) => channelLabel(r.channel) },
  { key: "approach_date", label: "Scouting", defaultVisible: true, get: (r) => r.approach_date },
  { key: "reachout_date", label: "Reachout", defaultVisible: true, get: (r) => r.reachout_date },
  { key: "respon_date", label: "Respon", defaultVisible: false, get: (r) => r.respon_date },
  { key: "follow_up_1_date", label: "Follow Up 1", defaultVisible: false, get: (r) => r.follow_up_1_date },
  { key: "follow_up_2_date", label: "Follow Up 2", defaultVisible: false, get: (r) => r.follow_up_2_date },
  { key: "follow_up_3_date", label: "Follow Up 3", defaultVisible: false, get: (r) => r.follow_up_3_date },
  { key: "using_tap_date", label: "Using TAP", defaultVisible: true, get: (r) => r.using_tap_date },
  { key: "prove_link", label: "Prove", defaultVisible: false, get: (r) => r.prove_link, render: (r) => (r.prove_link ? <a href={r.prove_link} target="_blank" rel="noreferrer" className="underline">Link</a> : "—") },
  { key: "notes", label: "Notes", defaultVisible: false, get: (r) => r.notes },
];

const PAGE_SIZES = [10, 20, 50, 100] as const;

export function ApproachTable({ rows, canEdit }: { rows: ExternalApproachRow[]; canEdit: boolean }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string>("approach_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState(1);
  const [visible, setVisible] = useState<Set<string>>(new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)));
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.creator_name?.toLowerCase().includes(q) || (r.brand ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const visibleColumns = COLUMNS.filter((c) => visible.has(c.key));

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const toggleColumn = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari username atau brand…"
          className={`${inputCls} mt-0 max-w-xs`}
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowColumnPicker((s) => !s)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Kolom
          </button>
          {showColumnPicker && (
            <div className="absolute z-10 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 px-2 py-1 text-sm">
                  <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
          Tampilkan
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          baris
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="cursor-pointer select-none whitespace-nowrap px-4 py-3" onClick={() => toggleSort(c.key)}>
                  {c.label} {sortKey === c.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </th>
              ))}
              {canEdit && <th className="px-4 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {paged.map((r) => (
              <RowOrEdit key={r.id} row={r} visibleColumns={visibleColumns} canEdit={canEdit} editing={editingId === r.id} onEdit={() => setEditingId(r.id)} onCancel={() => setEditingId(null)} />
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length + (canEdit ? 1 : 0)} className="px-4 py-6 text-center text-slate-400">
                  Belum ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>
          {sorted.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} dari {sorted.length}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <span>Hal {currentPage} / {totalPages}</span>
          <button
            type="button"
            disabled={currentPage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function RowOrEdit({
  row,
  visibleColumns,
  canEdit,
  editing,
  onEdit,
  onCancel,
}: {
  row: ExternalApproachRow;
  visibleColumns: ColumnDef[];
  canEdit: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState<ApproachFormState | null, FormData>(updateApproach, null);

  useEffect(() => {
    if (state?.ok && editing) onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!editing) {
    return (
      <tr>
        {visibleColumns.map((c) => (
          <td key={c.key} className="whitespace-nowrap px-4 py-2">
            {c.render ? c.render(row) : (c.get(row) ?? "—")}
          </td>
        ))}
        {canEdit && (
          <td className="whitespace-nowrap px-4 py-2">
            <div className="flex gap-2">
              <button type="button" onClick={onEdit} className="rounded-md px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                Edit
              </button>
              <form
                action={deleteApproach}
                onSubmit={(e) => {
                  if (!confirm(`Hapus approach "${row.creator_name}"?`)) e.preventDefault();
                }}
              >
                <input type="hidden" name="id" value={row.id} />
                <button type="submit" className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50">
                  Hapus
                </button>
              </form>
            </div>
          </td>
        )}
      </tr>
    );
  }

  const err = (field: string) => state?.fieldErrors?.[field];

  return (
    <tr>
      <td colSpan={visibleColumns.length + 1} className="bg-slate-50 px-4 py-4">
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={row.id} />
          {state && !state.ok && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{state.message}</p>
          )}
          <ApproachFields
            defaults={{
              username: row.creator_name,
              brand: row.brand ?? "",
              creator_id: row.creator_id ?? "",
              niche: row.niche ?? "",
              platform: row.platform ?? "",
              followers: row.followers ?? "",
              wa_number: fromWaContact(row.wa_contact),
              gmv: row.gmv ?? "",
              channel: row.channel ?? "",
              scouting_date: row.approach_date ?? "",
              reachout_date: row.reachout_date ?? "",
              respon_date: row.respon_date ?? "",
              follow_up_1_date: row.follow_up_1_date ?? "",
              follow_up_2_date: row.follow_up_2_date ?? "",
              follow_up_3_date: row.follow_up_3_date ?? "",
              using_tap_date: row.using_tap_date ?? "",
              prove_link: row.prove_link ?? "",
              notes: row.notes ?? "",
            }}
            err={err}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              {pending ? "Menyimpan..." : "Simpan"}
            </button>
            <button type="button" onClick={onCancel} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100">
              Batal
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}
