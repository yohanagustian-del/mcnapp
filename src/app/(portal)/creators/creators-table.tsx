"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useCreatorFilter } from "@/components/creator-filter";
import { MAX_BULK_DELETE } from "@/lib/creators/delete";
import { creatorClassLabel } from "@/lib/creators/creator-class";
import { updateRateCard } from "./actions";
import { CreatorEditButton, type EditCmOption } from "./creator-edit-button";
import { CreatorDeleteDialog, type DeleteTarget } from "./creator-delete-dialog";
import { CmRequestButton } from "./cm-request-button";

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
  /** team_members.id anggota grup akuisisi yang membawa masuk kreator ini. */
  acquisitor_id: string | null;
  acquisitorName: string | null;
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

// Padding dirapatkan (px-2) dan font dikecilkan di <table>: 25 kolom tidak akan
// pernah muat di laptop, tapi preset "Ringkas" + sel yang lebih rapat membuat
// kolom yang benar-benar dipakai sehari-hari muat tanpa scroll horizontal.
const td = "px-2 py-2 whitespace-nowrap";

/** Badge per kelas kreator — Reguler netral, kelas lain diberi warna supaya menonjol. */
const CREATOR_CLASS_BADGE: Record<string, string> = {
  reguler: "rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700",
  top_creator: "rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800",
  influencer: "rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800",
  // Eksternal = kreator luar agency; warna amber (sama seperti penanda "perlu
  // perhatian" lain di app) supaya mudah dibedakan dari kreator kelolaan sendiri.
  eksternal: "rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800",
};

/** null / "" / nilai asing → gaya Reguler, sejalan dengan creatorClassLabel(). */
function creatorClassBadge(value: string | null): string {
  return CREATOR_CLASS_BADGE[value ?? ""] ?? CREATOR_CLASS_BADGE.reguler;
}

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

/** Nilai yang bisa dibandingkan untuk pengurutan; null = sel kosong. */
type SortValue = string | number | null;

/** Yang dibutuhkan sel selain barisnya sendiri. */
interface CellContext {
  nowMs: number;
  canUpload: boolean;
}

interface TableColumn {
  /** Judul kolom — sekaligus kunci identitas kolom (dipakai state urut & pilih kolom). */
  label: string;
  /** Keterangan kecil di samping judul (mis. "(avg/bln)"). */
  hint?: string;
  /**
   * Ikut tampil pada preset "Ringkas" (tampilan awal). Kolom di luar preset ini
   * tetap ada, tinggal dicentang lewat menu Kolom.
   */
  compact?: boolean;
  /**
   * Nilai pengurutan baris ini. Kolom tanpa `value` tidak bisa diklik —
   * dipakai untuk kolom aksi/centang yang tidak punya urutan bermakna.
   */
  value?: (c: CreatorTableRow, nowMs: number) => SortValue;
  /** Isi sel. Header DAN body sama-sama dibangun dari daftar ini, jadi kolom yang
   *  disembunyikan tidak mungkin membuat header & isi bergeser. */
  cell: (c: CreatorTableRow, ctx: CellContext) => ReactNode;
  /** Kelas <td>; default `td` (nowrap). */
  className?: string;
}

/**
 * Definisi kolom tabel kreator — satu sumber untuk header, isi sel, pengurutan,
 * dan menu pilih-kolom. Menambah kolom = menambah satu entri di sini.
 *
 * `compact: true` menandai kolom yang paling sering dipakai CM sehari-hari;
 * itulah yang tampil secara default supaya tabel muat di layar laptop tanpa
 * scroll horizontal (sisanya tinggal dicentang).
 */
const COLUMNS: TableColumn[] = [
  {
    label: "Username",
    compact: true,
    value: (c) => c.username,
    className: `${td} font-medium`,
    cell: (c) => (
      <>
        {c.profile_link ? (
          <a href={c.profile_link} target="_blank" className="text-blue-700 hover:underline">
            {c.username ?? "—"}
          </a>
        ) : (
          c.username ?? "—"
        )}
        <span className="ml-1 font-mono text-[10px] text-slate-400">{c.id}</span>
      </>
    ),
  },
  {
    label: "Nama Creator",
    compact: true,
    value: (c) => c.name,
    cell: (c) => (
      <Link href={`/creators/${c.id}`} className="text-blue-700 hover:underline">
        {c.name}
      </Link>
    ),
  },
  { label: "No HP", value: (c) => c.phone, cell: (c) => c.phone ?? "—" },
  {
    label: "Platform",
    value: (c) => c.platform,
    className: `${td} capitalize`,
    cell: (c) => c.platform ?? "—",
  },
  { label: "Jenis", value: (c) => c.jenis_creator, cell: (c) => c.jenis_creator ?? "—" },
  {
    label: "Kelas Kreator",
    compact: true,
    value: (c) => creatorClassLabel(c.creator_class),
    cell: (c) => (
      <span className={creatorClassBadge(c.creator_class)}>{creatorClassLabel(c.creator_class)}</span>
    ),
  },
  {
    label: "Niche (Top 3)",
    value: (c) => c.top_niches?.[0] ?? c.niche,
    className: "px-2 py-2",
    cell: (c) => {
      const niches: string[] = c.top_niches ?? (c.niche ? [c.niche] : []);
      if (!niches.length) return "—";
      return (
        <span className="flex flex-wrap gap-1">
          {niches.slice(0, 3).map((n) => (
            <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {n}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    label: "Followers",
    compact: true,
    value: (c) => followersValue(c.followers),
    cell: (c) => c.followers ?? "—",
  },
  { label: "Kualitas", value: (c) => c.content_quality, cell: (c) => c.content_quality ?? "—" },
  { label: "GMV Total", hint: "(avg/bln)", compact: true, value: (c) => c.gmv, cell: (c) => formatRp(c.gmv) },
  { label: "GMV Live", hint: "(avg/bln)", value: (c) => c.gmv_live, cell: (c) => formatRp(c.gmv_live) },
  { label: "GMV Video", hint: "(avg/bln)", value: (c) => c.gmv_video, cell: (c) => formatRp(c.gmv_video) },
  {
    label: "Sharing Komisi",
    compact: true,
    // Fraksi (0,22) dan nilai legacy persen (22) disamakan dulu, seperti formatShare.
    value: (c) =>
      c.commission_share == null
        ? null
        : c.commission_share <= 1
          ? c.commission_share * 100
          : c.commission_share,
    cell: (c) => formatShare(c.commission_share),
  },
  {
    label: "RC Live",
    value: (c) => c.rc_live,
    className: `${td} max-w-[160px] truncate`,
    cell: (c) => <span title={c.rc_live ?? ""}>{c.rc_live ?? "—"}</span>,
  },
  {
    label: "RC Video",
    value: (c) => c.rc_video,
    className: `${td} max-w-[160px] truncate`,
    cell: (c) => <span title={c.rc_video ?? ""}>{c.rc_video ?? "—"}</span>,
  },
  {
    label: "Rate Card (Rp)",
    value: (c) => c.rate_card,
    className: "px-2 py-2",
    cell: (c, ctx) =>
      ctx.canUpload ? (
        <form action={updateRateCard} className="flex items-center gap-1">
          <input type="hidden" name="creator_id" value={c.id} />
          <input
            name="rate_card"
            defaultValue={c.rate_card ?? ""}
            placeholder="—"
            aria-label={`Rate card ${c.username ?? c.name}`}
            className="w-20 rounded border border-slate-200 px-1.5 py-1 text-xs"
          />
          <button type="submit" className="rounded bg-slate-100 px-1.5 py-1 text-xs hover:bg-slate-200">
            ✓
          </button>
        </form>
      ) : (
        formatRp(c.rate_card)
      ),
  },
  { label: "CM", compact: true, value: (c) => c.cmName, cell: (c) => c.cmName ?? "—" },
  // Akuisitor = anggota tim grup "acquisition" yang membawa kreator ini masuk.
  { label: "Akuisitor", compact: true, value: (c) => c.acquisitorName, cell: (c) => c.acquisitorName ?? "—" },
  { label: "Level", compact: true, value: (c) => c.level, cell: (c) => (c.level ? `L${c.level}` : "—") },
  // Tanggal ISO ("2026-01-31") urut leksikografis = urut kronologis.
  { label: "Join", value: (c) => c.join_date, cell: (c) => c.join_date ?? "—" },
  {
    label: "End Date",
    compact: true,
    value: (c) => c.contract_end_date,
    cell: (c) => c.contract_end_date ?? "—",
  },
  {
    label: "Sisa Kontrak",
    compact: true,
    value: (c, nowMs) => contractDays(c.join_date, c.contract_end_date, nowMs),
    cell: (c, ctx) => {
      const r = contractRemaining(c.join_date, c.contract_end_date, ctx.nowMs);
      return <span className={r.danger ? "font-medium text-red-600" : undefined}>{r.label}</span>;
    },
  },
  { label: "Domisili", value: (c) => c.domisili, cell: (c) => c.domisili ?? "—" },
  {
    label: "Alamat Lengkap",
    value: (c) => c.alamat,
    className: "max-w-[220px] truncate px-2 py-2",
    cell: (c) => <span title={c.alamat ?? ""}>{c.alamat ?? "—"}</span>,
  },
  {
    label: "UID",
    value: (c) => c.uid,
    className: `${td} font-mono text-[10px] text-slate-400`,
    cell: (c) => c.uid ?? "—",
  },
  { label: "Status", compact: true, value: (c) => c.status, cell: (c) => c.status },
];

/** Label kolom yang tampil pada preset "Ringkas". */
const COMPACT_LABELS = COLUMNS.filter((c) => c.compact).map((c) => c.label);
const ALL_LABELS = COLUMNS.map((c) => c.label);
/**
 * Pilihan kolom disimpan per-browser supaya tidak perlu diatur ulang tiap kunjungan.
 *
 * Versinya dinaikkan setiap ada kolom BARU yang harus terlihat: preferensi lama
 * disaring terhadap ALL_LABELS, jadi tanpa dinaikkan kolom baru tidak akan pernah
 * muncul untuk user yang pernah menyentuh menu Kolom (v2 = kolom "Akuisitor").
 */
const COLUMN_PREF_KEY = "mcn.creators.columns.v2";

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
  canAssignCm = false,
  cmOptions = [],
  acquisitorOptions = [],
  canRequestCm = false,
  viewerId = null,
  requestedCreatorIds,
}: {
  rows: CreatorTableRow[];
  nowMs: number;
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Izin m8.assign_creator — menampilkan dropdown CM di modal Edit. */
  canAssignCm?: boolean;
  /** Daftar CM aktif untuk dropdown CM di modal Edit. */
  cmOptions?: EditCmOption[];
  /** Anggota grup akuisisi aktif untuk dropdown Akuisitor di modal Edit. */
  acquisitorOptions?: EditCmOption[];
  /**
   * Izin creators.request_cm TANPA izin assign (CPM). Menampilkan tombol "Request"
   * per baris — satu-satunya jalur CPM mendapatkan kreator, karena assign mandiri
   * memang tidak diizinkan.
   */
  canRequestCm?: boolean;
  /** team_members.id user yang login — untuk menyembunyikan tombol di kreator sendiri. */
  viewerId?: string | null;
  /** creator_id yang sudah punya request pending dari user ini. */
  requestedCreatorIds?: string[];
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

  // Kolom yang ditampilkan. Nilai awal = preset "Ringkas" (sama di server & klien
  // supaya tidak hydration-mismatch); preferensi tersimpan dibaca setelah mount.
  const [shownLabels, setShownLabels] = useState<string[]>(COMPACT_LABELS);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLUMN_PREF_KEY);
      if (!saved) return;
      const parsed: unknown = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      // Saring terhadap ALL_LABELS: kolom yang sudah dihapus/diganti namanya di
      // kode tidak boleh menghidupkan kembali entri usang dari localStorage.
      const valid = ALL_LABELS.filter((l) => parsed.includes(l));
      if (valid.length > 0) setShownLabels(valid);
    } catch {
      // localStorage diblokir / JSON rusak → pakai preset bawaan saja.
    }
  }, []);

  const applyColumns = useCallback((labels: string[]) => {
    const ordered = ALL_LABELS.filter((l) => labels.includes(l));
    setShownLabels(ordered);
    try {
      window.localStorage.setItem(COLUMN_PREF_KEY, JSON.stringify(ordered));
    } catch {
      // Preferensi gagal disimpan bukan alasan membatalkan perubahan tampilan.
    }
  }, []);

  const toggleColumn = useCallback(
    (labelToToggle: string) => {
      const next = shownLabels.includes(labelToToggle)
        ? shownLabels.filter((l) => l !== labelToToggle)
        : [...shownLabels, labelToToggle];
      // Minimal satu kolom harus tersisa — tabel tanpa kolom tidak bisa dipulihkan
      // lewat UI-nya sendiri.
      if (next.length === 0) return;
      applyColumns(next);
    },
    [shownLabels, applyColumns]
  );

  const visibleColumns = useMemo(
    () => COLUMNS.filter((c) => shownLabels.includes(c.label)),
    [shownLabels]
  );

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

  const showActions = canEdit || canDelete || canRequestCm;
  const requestedIds = useMemo(() => new Set(requestedCreatorIds ?? []), [requestedCreatorIds]);

  /** Kolom data terlihat + kolom centang + kolom Aksi — dipakai colSpan baris "kosong". */
  const colCount = visibleColumns.length + (canDelete ? 1 : 0) + (showActions ? 1 : 0);
  const cellCtx: CellContext = { nowMs, canUpload };

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

      {/* Pemilih kolom: 25 kolom mustahil muat di laptop, jadi defaultnya preset
          "Ringkas" dan sisanya dinyalakan sesuai kebutuhan. Pilihan tersimpan di
          browser masing-masing. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setColumnMenuOpen((v) => !v)}
            aria-expanded={columnMenuOpen}
            className="rounded-md border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50"
          >
            Kolom ({shownLabels.length}/{ALL_LABELS.length}) {columnMenuOpen ? "▴" : "▾"}
          </button>
          {columnMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setColumnMenuOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                <div className="flex gap-1 border-b border-slate-100 pb-2">
                  <button
                    type="button"
                    onClick={() => applyColumns(COMPACT_LABELS)}
                    className="flex-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Ringkas
                  </button>
                  <button
                    type="button"
                    onClick={() => applyColumns(ALL_LABELS)}
                    className="flex-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  >
                    Semua kolom
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto pt-1">
                  {COLUMNS.map((col) => (
                    <label
                      key={col.label}
                      className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={shownLabels.includes(col.label)}
                        onChange={() => toggleColumn(col.label)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-slate-700">{col.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        <span className="text-xs text-slate-400">
          Klik judul kolom untuk mengurutkan · pilihan kolom tersimpan di browser ini
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs sm:text-sm">
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
              {visibleColumns.map((col) => {
                const active = sort?.label === col.label;
                const title = (
                  <>
                    {col.label}
                    {col.hint && <span className="normal-case text-slate-400"> {col.hint}</span>}
                  </>
                );
                if (!col.value) return <th key={col.label} className="px-2 py-3">{title}</th>;
                return (
                  <th
                    key={col.label}
                    className="px-2 py-3"
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
              {showActions && <th className="px-2 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((c) => {
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
                  {visibleColumns.map((col) => (
                    <td key={col.label} className={col.className ?? td}>
                      {col.cell(c, cellCtx)}
                    </td>
                  ))}
                  {showActions && (
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        {canRequestCm && (
                          <CmRequestButton
                            creatorId={c.id}
                            creatorLabel={labelOf(c)}
                            ownerName={c.cmName}
                            alreadyRequested={requestedIds.has(c.id)}
                            isMine={Boolean(viewerId) && c.owner_cpm_id === viewerId}
                          />
                        )}
                        {canEdit && (
                          // CreatorTableRow memuat semua field EditableCreator,
                          // jadi barisnya diteruskan apa adanya — tidak ada daftar
                          // field kedua yang bisa ketinggalan saat kolom ditambah.
                          <CreatorEditButton
                            creator={c}
                            cms={cmOptions}
                            acquisitors={acquisitorOptions}
                            canAssignCm={canAssignCm}
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
