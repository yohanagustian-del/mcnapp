"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { assignCmToCreators } from "@/app/(portal)/workspace/cm/actions";
import { requestCmAssignmentBulk } from "@/app/(portal)/creators/cm-request-actions";
import type { CmOption, CreatorWithoutCm } from "@/lib/creators/without-cm";
import { nextSortState, sortRows, type SortDir, type SortState, type SortValue } from "@/lib/utils/table-sort";

const PAGE_SIZE = 15;

/** Kolom yang bisa diurutkan lewat header + arah klik pertamanya. */
const SORT_FIRST_DIR: Record<string, SortDir> = {
  username: "asc",
  name: "asc",
  platform: "asc",
  status: "asc",
  // Kolom angka: klik pertama menampilkan antrean terbanyak lebih dulu.
  request: "desc",
};

/** Header kolom yang bisa diklik untuk mengurutkan (naik ⇄ turun ⇄ bawaan). */
function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "px-3 py-2",
}: {
  label: string;
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  className?: string;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;

  return (
    <th
      className={className}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-amber-950"
        title={`Urutkan berdasarkan ${label} (${
          dir === "asc" ? "sekarang naik" : dir === "desc" ? "sekarang turun" : "belum diurutkan"
        })`}
      >
        {label}
        <span aria-hidden="true" className={dir ? "text-amber-900" : "text-amber-400"}>
          {dir === "asc" ? "▲" : dir === "desc" ? "▼" : "↕"}
        </span>
      </button>
    </th>
  );
}

const btnPrimary =
  "rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50";
const btnSecondary =
  "rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50";

interface Props {
  total: number;
  rows: CreatorWithoutCm[];
  cmOptions: CmOption[];
  /** m8.assign_creator — Director/Head/SPV/CM Lead. Others see the list read-only. */
  canAssign: boolean;
  /**
   * creators.request_cm tanpa izin assign (CPM): boleh MENCENTANG kreator lalu
   * mengajukan diri sebagai CM-nya. Kepemilikan tidak berubah sampai approver
   * menerima (CLAUDE.md #2).
   */
  canRequest?: boolean;
  /** creator_id yang sudah punya request pending dari user ini — tidak bisa dicentang lagi. */
  requestedCreatorIds?: string[];
  /** Jumlah request pending per creator_id — ditampilkan ke approver sebagai penanda antrean. */
  pendingRequestCountByCreator?: Record<string, number>;
}

/**
 * Alert card "Kreator belum punya CM".
 *
 * Upload data platform mingguan membuat username yang belum ada di master
 * menjadi kreator baru TANPA CM (yang mengunggah belum tentu CM-nya). Kreator
 * tanpa CM tidak masuk scope CM Workspace maupun agregasi OKR, jadi backlog-nya
 * ditampilkan di sini — bukan didiamkan.
 *
 * Pilih beberapa kreator → pilih CM → Terapkan. Hanya mengisi CM yang kosong;
 * tidak pernah memindahkan kreator dari CM yang sudah ada.
 *
 * CM (CPM) tidak boleh assign ke dirinya sendiri, jadi untuk role itu centangnya
 * berujung ke tombol "Request" — antrean yang diputuskan CM Lead / Head.
 */
export function CreatorsWithoutCmAlert({
  total,
  rows,
  cmOptions,
  canAssign,
  canRequest = false,
  requestedCreatorIds = [],
  pendingRequestCountByCreator = {},
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cmId, setCmId] = useState("");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  // null = urutan bawaan server (kreator terbaru dulu).
  const [sort, setSort] = useState<SortState | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Request yang baru dikirim di sesi ini — ditambahkan ke daftar pending supaya
  // barisnya langsung terkunci tanpa menunggu revalidate halaman selesai.
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());

  const alreadyRequested = useMemo(
    () => new Set([...requestedCreatorIds, ...justRequested]),
    [requestedCreatorIds, justRequested]
  );
  /** Centang aktif untuk approver (assign) MAUPUN CM (request). */
  const canPick = canAssign || canRequest;

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || (r.username ?? "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  // Sorting client-side: daftar lengkapnya sudah ada di klien, jadi mengurutkan
  // tidak memicu query baru. Nilai kosong selalu turun ke bawah (compareSortValues).
  const filtered = useMemo(() => {
    if (!sort) return searched;
    const accessors: Record<string, (r: CreatorWithoutCm) => SortValue> = {
      username: (r) => r.username,
      name: (r) => r.name,
      platform: (r) => r.platform ?? "tiktok",
      status: (r) => r.status,
      request: (r) => pendingRequestCountByCreator[r.id] ?? 0,
    };
    const accessor = accessors[sort.key];
    return accessor ? sortRows(searched, accessor, sort.dir) : searched;
  }, [searched, sort, pendingRequestCountByCreator]);

  /** Klik header: naik → turun → kembali ke urutan bawaan server. */
  function toggleSort(key: string) {
    setSort((prev) =>
      nextSortState(prev, key, SORT_FIRST_DIR[key] ?? "asc", { resettable: true, fallback: null })
    );
    setShown(PAGE_SIZE);
  }

  const visible = filtered.slice(0, shown);

  if (total === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Baris yang sudah diajukan tidak ikut "Pilih semua" — request-nya sudah ada. */
  const pickableVisible = visible.filter((r) => canAssign || !alreadyRequested.has(r.id));

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allPicked = pickableVisible.every((r) => next.has(r.id));
      for (const r of pickableVisible) {
        if (allPicked) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  function onApply() {
    setError(null);
    setDone(null);
    const ids = [...selected];
    startTransition(async () => {
      try {
        const res = await assignCmToCreators(ids, cmId);
        const cmName = cmOptions.find((c) => c.id === cmId)?.name ?? "CM terpilih";
        setDone(
          `${res.assigned} kreator ditugaskan ke ${cmName}` +
            (res.skipped > 0 ? ` — ${res.skipped} dilewati (sudah punya CM).` : ".")
        );
        setSelected(new Set());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal menyimpan CM");
      }
    });
  }

  function onRequest() {
    setError(null);
    setDone(null);
    const ids = [...selected];
    startTransition(async () => {
      try {
        const res = await requestCmAssignmentBulk(ids, reason.trim() || null);
        setDone(res.message);
        setJustRequested((prev) => {
          const next = new Set(prev);
          for (const id of ids) next.add(id);
          return next;
        });
        setSelected(new Set());
        setReason("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal mengirim request");
      }
    });
  }

  const allVisiblePicked =
    pickableVisible.length > 0 && pickableVisible.every((r) => selected.has(r.id));

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-amber-900">
          ⚠ {total.toLocaleString("id-ID")} kreator belum punya CM
        </h2>
        <Link href="/creators" className="text-xs text-amber-800 underline">
          Kelola di halaman Kreator
        </Link>
      </div>
      <p className="mt-1 text-xs text-amber-900">
        Kreator ini dibuat otomatis dari upload data platform mingguan — username-nya belum ada di
        master, jadi ditambahkan dengan <strong>CM dikosongkan</strong> (yang mengunggah belum tentu
        CM-nya). Selama CM kosong, kreator tidak muncul di CM Workspace dan tidak ikut agregasi OKR.
      </p>

      {!canAssign && canRequest && (
        <p className="mt-3 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          Anda tidak bisa menetapkan CM sendiri. <strong>Centang</strong> kreator yang ingin Anda
          pegang lalu klik <strong>Request</strong> — CM Lead / Head yang menyetujui, dan setelah
          disetujui kreatornya otomatis masuk ke Anda.
        </p>
      )}
      {!canAssign && !canRequest && (
        <p className="mt-3 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          Role Anda tidak bisa menetapkan CM — hubungi CM Lead / Head untuk mengisi daftar di bawah.
        </p>
      )}

      {done && <p className="mt-3 rounded-md bg-green-50 p-2 text-sm text-green-800">{done}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE_SIZE);
          }}
          placeholder="Cari username / nama…"
          className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
        />
        {canPick && (
          <button type="button" onClick={selectAllVisible} className={btnSecondary} disabled={pending}>
            {allVisiblePicked ? "Batal pilih" : `Pilih ${pickableVisible.length} tampil`}
          </button>
        )}

        {canAssign && (
          <>
            <select
              value={cmId}
              onChange={(e) => setCmId(e.target.value)}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— Pilih CM —</option>
              {cmOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.role})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onApply}
              disabled={pending || !cmId || selected.size === 0}
              className={btnPrimary}
            >
              {pending ? "Menyimpan…" : `Terapkan ke ${selected.size} terpilih`}
            </button>
          </>
        )}

        {!canAssign && canRequest && (
          <>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Alasan (opsional) — mis. sudah handle live-nya"
              aria-label="Alasan request"
              className="w-72 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={onRequest}
              disabled={pending || selected.size === 0}
              className={btnPrimary}
            >
              {pending ? "Mengirim…" : `Request ${selected.size} terpilih`}
            </button>
          </>
        )}
      </div>

      {cmOptions.length === 0 && canAssign && (
        <p className="mt-2 text-xs text-red-700">
          Belum ada CPM/CM Lead aktif di tabel Tim — daftarkan dulu sebelum menetapkan CM.
        </p>
      )}

      <div className="mt-3 max-h-72 overflow-auto rounded-md border border-amber-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-amber-100 text-left text-xs uppercase text-amber-900">
            <tr>
              {canPick && <th className="w-10 px-3 py-2" />}
              <SortTh label="Username" sortKey="username" sort={sort} onSort={toggleSort} />
              <SortTh label="Nama" sortKey="name" sort={sort} onSort={toggleSort} />
              <SortTh label="Platform" sortKey="platform" sort={sort} onSort={toggleSort} />
              <SortTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
              <SortTh label="Request CM" sortKey="request" sort={sort} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {visible.map((r) => {
              const mine = alreadyRequested.has(r.id);
              const queued = pendingRequestCountByCreator[r.id] ?? 0;
              return (
                <tr key={r.id} className={selected.has(r.id) ? "bg-amber-50" : undefined}>
                  {canPick && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        // CM: baris yang sudah diajukan tidak perlu diajukan lagi.
                        disabled={!canAssign && mine}
                        onChange={() => toggle(r.id)}
                        aria-label={`Pilih ${r.username ?? r.name}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 font-medium text-slate-800">{r.username ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{r.name}</td>
                  <td className="px-3 py-2 text-slate-500">{r.platform ?? "tiktok"}</td>
                  <td className="px-3 py-2 text-slate-500">{r.status}</td>
                  <td className="px-3 py-2 text-xs">
                    {mine ? (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                        Anda — menunggu ACC
                      </span>
                    ) : queued > 0 ? (
                      // Penanda untuk approver: sudah ada CM yang minta kreator ini.
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                        {queued} request menunggu
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={canPick ? 6 : 5} className="px-3 py-4 text-center text-slate-400">
                  Tidak ada kreator yang cocok dengan pencarian.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {shown < filtered.length && (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE_SIZE)}
          className="mt-2 text-xs text-amber-800 underline"
        >
          Tampilkan {Math.min(PAGE_SIZE, filtered.length - shown)} lagi ({filtered.length - shown} tersisa)
        </button>
      )}
    </div>
  );
}
