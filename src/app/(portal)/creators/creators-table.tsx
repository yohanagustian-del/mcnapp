"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCreatorFilter } from "@/components/creator-filter";
import { MAX_BULK_DELETE } from "@/lib/creators/delete";
import { creatorClassLabel } from "@/lib/creators/creator-class";
import { updateRateCard } from "./actions";
import { CreatorEditButton } from "./creator-edit-button";
import { CreatorDeleteDialog, type DeleteTarget } from "./creator-delete-dialog";

/** Master-data row rendered by the creators table (only the columns actually shown). */
export interface CreatorTableRow {
  id: string;
  name: string;
  username: string | null;
  profile_link: string | null;
  phone: string | null;
  uid: string | null;
  followers: string | null;
  content_quality: string | null;
  join_date: string | null;
  domisili: string | null;
  alamat: string | null;
  jenis_creator: string | null;
  /** reguler | top_creator | influencer — NOT NULL di DB, kosong tetap ditampilkan Reguler. */
  creator_class: string | null;
  niche: string | null;
  top_niches: string[] | null;
  level: number | null;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  platform: string | null;
  rc_live: string | null;
  rc_video: string | null;
  rate_card: number | null;
  commission_share: number | null;
  contract_end_date: string | null;
  status: string;
  owner_cpm_id: string | null;
  cmName: string | null;
}

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

/** commission_share stored as fraction (0.22 = 22%). Tolerate legacy percent values (>1). */
function formatShare(v: number | null | undefined): string {
  if (v == null) return "—";
  const pct = v <= 1 ? v * 100 : v;
  return `${Number(pct.toFixed(1))}%`;
}

/**
 * Sisa kontrak dalam hari, atau null kalau salah satu tanggal belum terisi.
 * Dipisah dari label supaya pengurutan kolom "Sisa Kontrak" memakai angka
 * (bukan teks "habis 3 hr lalu" yang urutannya tidak bermakna).
 */
function contractDays(join: string | null, end: string | null, nowMs: number): number | null {
  if (!join || !end) return null;
  const days = Math.ceil((new Date(end).getTime() - nowMs) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

/**
 * Sisa kontrak per hari ini (computed, tidak disimpan). `nowMs` comes from the server
 * render so SSR and hydration agree on the day count.
 *
 * Butuh join_date DAN contract_end_date terisi: kontrak tanpa salah satu tanggal =
 * data belum lengkap, jadi ditampilkan "—" daripada hitungan yang menyesatkan.
 */
function contractRemaining(
  join: string | null,
  end: string | null,
  nowMs: number
): { label: string; danger: boolean } {
  const days = contractDays(join, end, nowMs);
  if (days === null) return { label: "—", danger: false };
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= 60) return { label: `${days} hari`, danger: days <= 30 };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

/** Suffix jumlah follower yang lazim ditulis manual di sheet. */
const FOLLOWER_MULTIPLIER: Record<string, number> = {
  k: 1e3, rb: 1e3, ribu: 1e3, m: 1e6, jt: 1e6, juta: 1e6,
};

/**
 * `followers` disimpan sebagai teks bebas ("595000", "595.000", "120K", "1,2jt"),
 * jadi pengurutan apa adanya akan menaruh "1,2jt" di bawah "999". Diubah ke angka
 * supaya kolomnya bisa diurutkan; format yang tidak dikenali → null (paling bawah).
 */
function followersValue(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase().replace(/\s+/g, "").match(/^([\d.,]+)(k|rb|ribu|m|jt|juta)?$/);
  if (!m) return null;
  const mult = m[2] ? FOLLOWER_MULTIPLIER[m[2]] : 1;
  // Tanpa suffix, titik/koma pasti pemisah ribuan ("595.000"). Dengan suffix,
  // pemisah terakhir dibaca sebagai desimal ("1,2jt" = 1.200.000).
  const digits =
    mult === 1
      ? m[1].replace(/[.,]/g, "")
      : m[1].replace(/,/g, ".").replace(/\.(?=.*\.)/g, "");
  const n = Number(digits);
  return Number.isFinite(n) ? n * mult : null;
}

const td = "px-3 py-2 whitespace-nowrap";

/** Badge per kelas kreator — Reguler netral, dua kelas lain diberi warna supaya menonjol. */
const CREATOR_CLASS_BADGE: Record<string, string> = {
  reguler: "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700",
  top_creator: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800",
  influencer: "rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800",
};

/** null / "" / nilai asing → gaya Reguler, sejalan dengan creatorClassLabel(). */
function creatorClassBadge(value: string | null): string {
  return CREATOR_CLASS_BADGE[value ?? ""] ?? CREATOR_CLASS_BADGE.reguler;
}

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

/** Nilai yang bisa dibandingkan untuk pengurutan; null = sel kosong. */
type SortValue = string | number | null;

interface TableColumn {
  /** Judul kolom. */
  label: string;
  /** Keterangan kecil di samping judul (mis. "(avg/bln)"). */
  hint?: string;
  /**
   * Nilai pengurutan baris ini. Kolom tanpa `value` tidak bisa diklik —
   * dipakai untuk kolom aksi/centang yang tidak punya urutan bermakna.
   */
  value?: (c: CreatorTableRow, nowMs: number) => SortValue;
}

/**
 * Definisi kolom tabel — URUTANNYA HARUS SAMA dengan urutan <td> di body.
 * Header dibangun dari daftar ini supaya tombol urut tidak perlu ditulis 25 kali,
 * dan supaya menambah kolom tidak bisa lupa menambah pengurutnya.
 */
const COLUMNS: TableColumn[] = [
  { label: "Username", value: (c) => c.username },
  { label: "Nama Creator", value: (c) => c.name },
  { label: "No HP", value: (c) => c.phone },
  { label: "Platform", value: (c) => c.platform },
  { label: "Jenis", value: (c) => c.jenis_creator },
  { label: "Kelas Kreator", value: (c) => creatorClassLabel(c.creator_class) },
  { label: "Niche (Top 3)", value: (c) => c.top_niches?.[0] ?? c.niche },
  { label: "Followers", value: (c) => followersValue(c.followers) },
  { label: "Kualitas", value: (c) => c.content_quality },
  { label: "GMV Total", hint: "(avg/bln)", value: (c) => c.gmv },
  { label: "GMV Live", hint: "(avg/bln)", value: (c) => c.gmv_live },
  { label: "GMV Video", hint: "(avg/bln)", value: (c) => c.gmv_video },
  // Fraksi (0,22) dan nilai legacy persen (22) disamakan dulu, seperti formatShare.
  {
    label: "Sharing Komisi",
    value: (c) => (c.commission_share == null ? null : c.commission_share <= 1 ? c.commission_share * 100 : c.commission_share),
  },
  { label: "RC Live", value: (c) => c.rc_live },
  { label: "RC Video", value: (c) => c.rc_video },
  { label: "Rate Card (Rp)", value: (c) => c.rate_card },
  { label: "CM", value: (c) => c.cmName },
  { label: "Level", value: (c) => c.level },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  { label: "Join", value: (c) => c.join_date },
  { label: "End Date", value: (c) => c.contract_end_date },
  { label: "Sisa Kontrak", value: (c, nowMs) => contractDays(c.join_date, c.contract_end_date, nowMs) },
  { label: "Domisili", value: (c) => c.domisili },
  { label: "Alamat Lengkap", value: (c) => c.alamat },
  { label: "UID", value: (c) => c.uid },
  { label: "Status", value: (c) => c.status },
];

type SortDir = "asc" | "desc";

/** String kosong diperlakukan sama dengan null supaya sel kosong selalu di bawah. */
function normalizeSortValue(v: SortValue): SortValue {
  return v === "" ? null : v;
}

/**
 * Bandingkan dua sel. Sel kosong SELALU di bawah, baik urut naik maupun turun —
 * kalau ikut dibalik, klik "Z→A" hanya menampilkan satu halaman penuh "—".
 * Teks dibandingkan dengan locale Indonesia + `numeric` supaya "L2" < "L10".
 */
function compareRows(
  a: CreatorTableRow,
  b: CreatorTableRow,
  column: TableColumn,
  dir: SortDir,
  nowMs: number
): number {
  const av = normalizeSortValue(column.value!(a, nowMs));
  const bv = normalizeSortValue(column.value!(b, nowMs));
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  const cmp =
    typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "id", { numeric: true, sensitivity: "base" });
  return dir === "asc" ? cmp : -cmp;
}

/**
 * Master creator table. Rows are filtered client-side by the shared username search +
 * CM multi-select (see @/components/creator-filter) — the full list is already loaded
 * by the server component, so typing does not re-query Supabase.
 */
export function CreatorsTable({
  rows,
  nowMs,
  canUpload,
  canEdit,
  canDelete,
}: {
  rows: CreatorTableRow[];
  nowMs: number;
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const { matches, isActive: filterActive } = useCreatorFilter();

  // Baris yang baru dihapus disembunyikan langsung, tanpa menunggu RSC payload
  // hasil revalidatePath sampai — jadi tabel tidak sempat menampilkan kreator
  // yang sudah tidak ada. Setelah props baru datang, filter ini jadi no-op.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogTargets, setDialogTargets] = useState<DeleteTarget[] | null>(null);

  const filteredRows = useMemo(
    () => rows.filter((c) => !removedIds.has(c.id) && matches(c.username, c.owner_cpm_id)),
    [rows, removedIds, matches]
  );

  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  // null = urutan bawaan dari server (terbaru dulu). Klik header: naik → turun →
  // kembali ke urutan bawaan, jadi user selalu bisa membatalkan pengurutan.
  const [sort, setSort] = useState<{ label: string; dir: SortDir } | null>(null);

  const toggleSort = useCallback((label: string) => {
    setSort((prev) => {
      if (prev?.label !== label) return { label, dir: "asc" };
      return prev.dir === "asc" ? { label, dir: "desc" } : null;
    });
    setPage(1);
  }, []);

  // Pengurutan dilakukan setelah filter dan SEBELUM pagination, jadi yang diurutkan
  // seluruh hasil filter — bukan cuma 10 baris yang kebetulan tampil.
  const sortedRows = useMemo(() => {
    const column = sort ? COLUMNS.find((c) => c.label === sort.label) : undefined;
    if (!sort || !column?.value) return filteredRows;
    return [...filteredRows].sort((a, b) => compareRows(a, b, column, sort.dir, nowMs));
  }, [filteredRows, sort, nowMs]);

  const total = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Menyempitkan filter bisa membuat halaman aktif melewati akhir daftar —
  // tarik kembali ke halaman terakhir yang masih ada.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, pageSize]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => sortedRows.slice(start, start + pageSize),
    [sortedRows, start, pageSize]
  );

  const labelOf = (c: CreatorTableRow) => c.username || c.name || c.id;

  /** Kolom data + kolom centang + kolom Aksi — dipakai colSpan baris "kosong". */
  const colCount = COLUMNS.length + (canDelete ? 1 : 0) + (canEdit || canDelete ? 1 : 0);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Centang header = pilih/lepas SEMUA baris di halaman ini saja. Centang di
  // halaman lain tetap tersimpan supaya user bisa mengumpulkan lintas halaman.
  const pageIds = visibleRows.map((c) => c.id);
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const pageSomeSelected = pageIds.some((id) => selected.has(id));

  const togglePage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageIds.every((id) => next.has(id))) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
    // pageIds diturunkan dari visibleRows; identitasnya berubah tiap render halaman.
  }, [pageIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Centang yang menunjuk kreator hilang (terhapus / tersaring habis) dibuang. */
  const selectedTargets: DeleteTarget[] = useMemo(() => {
    const byId = new Map(rows.map((c) => [c.id, c]));
    return [...selected]
      .filter((id) => byId.has(id) && !removedIds.has(id))
      .map((id) => ({ id, label: labelOf(byId.get(id)!) }));
  }, [selected, rows, removedIds]);

  const onDeleted = useCallback((ids: string[]) => {
    setRemovedIds((prev) => new Set([...prev, ...ids]));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {canDelete && selectedTargets.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-red-50 px-3 py-2 text-sm">
          <span className="text-red-900">
            <strong>{selectedTargets.length}</strong> kreator dipilih
            {selectedTargets.length > MAX_BULK_DELETE && (
              <span className="ml-1 text-xs">(maksimal {MAX_BULK_DELETE} per sekali hapus)</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-md px-3 py-1 text-sm text-slate-600 hover:bg-white"
            >
              Bersihkan pilihan
            </button>
            <button
              type="button"
              onClick={() => setDialogTargets(selectedTargets)}
              className="rounded-md bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Hapus terpilih
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {canDelete && (
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={pageAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !pageAllSelected && pageSomeSelected;
                    }}
                    onChange={togglePage}
                    aria-label="Pilih semua kreator di halaman ini"
                    className="h-4 w-4 cursor-pointer rounded border-slate-300"
                  />
                </th>
              )}
              {COLUMNS.map((col) => {
                const active = sort?.label === col.label;
                const title = (
                  <>
                    {col.label}
                    {col.hint && <span className="normal-case text-slate-400"> {col.hint}</span>}
                  </>
                );
                if (!col.value) return <th key={col.label} className="px-3 py-3">{title}</th>;
                return (
                  <th
                    key={col.label}
                    className="px-3 py-3"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.label)}
                      title={
                        active && sort!.dir === "desc"
                          ? `Klik untuk kembali ke urutan bawaan (${col.label})`
                          : `Urutkan berdasarkan ${col.label}`
                      }
                      className={`flex w-full items-center gap-1 text-left uppercase hover:text-slate-800 ${
                        active ? "text-slate-800" : ""
                      }`}
                    >
                      <span>{title}</span>
                      <span
                        aria-hidden
                        className={`text-[10px] ${active ? "text-slate-700" : "text-slate-300"}`}
                      >
                        {active ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
              {(canEdit || canDelete) && <th className="px-3 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((c) => {
              const remaining = contractRemaining(c.join_date, c.contract_end_date, nowMs);
              const niches: string[] = c.top_niches ?? (c.niche ? [c.niche] : []);
              return (
                <tr key={c.id} className={selected.has(c.id) ? "bg-red-50/60" : undefined}>
                  {canDelete && (
                    <td className={td}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        aria-label={`Pilih ${labelOf(c)}`}
                        className="h-4 w-4 cursor-pointer rounded border-slate-300"
                      />
                    </td>
                  )}
                  <td className={`${td} font-medium`}>
                    {c.profile_link ? (
                      <a href={c.profile_link} target="_blank" className="text-blue-700 hover:underline">
                        {c.username ?? "—"}
                      </a>
                    ) : (
                      c.username ?? "—"
                    )}
                    <span className="ml-1 font-mono text-[10px] text-slate-400">{c.id}</span>
                  </td>
                  <td className={td}>
                    <Link href={`/creators/${c.id}`} className="text-blue-700 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className={td}>{c.phone ?? "—"}</td>
                  <td className={`${td} capitalize`}>{c.platform ?? "—"}</td>
                  <td className={td}>{c.jenis_creator ?? "—"}</td>
                  <td className={td}>
                    <span className={creatorClassBadge(c.creator_class)}>
                      {creatorClassLabel(c.creator_class)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {niches.length ? (
                      <span className="flex flex-wrap gap-1">
                        {niches.slice(0, 3).map((n) => (
                          <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                            {n}
                          </span>
                        ))}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={td}>{c.followers ?? "—"}</td>
                  <td className={td}>{c.content_quality ?? "—"}</td>
                  <td className={td}>{formatRp(c.gmv)}</td>
                  <td className={td}>{formatRp(c.gmv_live)}</td>
                  <td className={td}>{formatRp(c.gmv_video)}</td>
                  <td className={td}>{formatShare(c.commission_share)}</td>
                  <td className={`${td} max-w-[180px] truncate`} title={c.rc_live ?? ""}>{c.rc_live ?? "—"}</td>
                  <td className={`${td} max-w-[180px] truncate`} title={c.rc_video ?? ""}>{c.rc_video ?? "—"}</td>
                  <td className="px-3 py-2">
                    {canUpload ? (
                      <form action={updateRateCard} className="flex items-center gap-1">
                        <input type="hidden" name="creator_id" value={c.id} />
                        <input
                          name="rate_card"
                          defaultValue={c.rate_card ?? ""}
                          placeholder="—"
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                        />
                        <button type="submit" className="rounded bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200">
                          ✓
                        </button>
                      </form>
                    ) : (
                      formatRp(c.rate_card)
                    )}
                  </td>
                  <td className={td}>{c.cmName ?? "—"}</td>
                  <td className={td}>{c.level ? `L${c.level}` : "—"}</td>
                  <td className={td}>{c.join_date ?? "—"}</td>
                  <td className={td}>{c.contract_end_date ?? "—"}</td>
                  <td className={`${td} ${remaining.danger ? "font-medium text-red-600" : ""}`}>
                    {remaining.label}
                  </td>
                  <td className={td}>{c.domisili ?? "—"}</td>
                  <td className="max-w-[240px] truncate px-3 py-2" title={c.alamat ?? ""}>
                    {c.alamat ?? "—"}
                  </td>
                  <td className={`${td} font-mono text-[10px] text-slate-400`}>{c.uid ?? "—"}</td>
                  <td className={td}>{c.status}</td>
                  {(canEdit || canDelete) && (
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <CreatorEditButton
                            creator={{
                              id: c.id,
                              name: c.name,
                              username: c.username,
                              phone: c.phone,
                              rc_live: c.rc_live,
                              rc_video: c.rc_video,
                              rate_card: c.rate_card,
                              level: c.level,
                              domisili: c.domisili,
                              uid: c.uid,
                              status: c.status,
                            }}
                          />
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDialogTargets([{ id: c.id, label: labelOf(c) }])}
                            className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                          >
                            Hapus
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-6 text-center text-slate-400">
                  {filterActive
                    ? "Tidak ada kreator yang cocok dengan pencarian username / filter CM."
                    : "Belum ada kreator."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          Baris per halaman
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            aria-label="Baris per halaman"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-3">
          <span className="text-slate-500">
            {total === 0 ? "0 kreator" : `${start + 1}–${Math.min(start + pageSize, total)} dari ${total} kreator`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              ‹ Sebelumnya
            </button>
            <span className="px-2 text-slate-600">
              Hal. {safePage} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={safePage >= pageCount}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Berikutnya ›
            </button>
          </div>
        </div>
      </div>

      {dialogTargets && (
        <CreatorDeleteDialog
          targets={dialogTargets}
          onClose={() => setDialogTargets(null)}
          onDeleted={onDeleted}
        />
      )}
    </div>
  );
}
