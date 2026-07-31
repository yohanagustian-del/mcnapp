"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCreatorFilter } from "@/components/creator-filter";
import { updateRateCard } from "./actions";
import { CreatorEditButton } from "./creator-edit-button";

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
  if (!join || !end) return { label: "—", danger: false };
  const days = Math.ceil((new Date(end).getTime() - nowMs) / 86_400_000);
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= 60) return { label: `${days} hari`, danger: days <= 30 };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

const td = "px-3 py-2 whitespace-nowrap";

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;

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
}: {
  rows: CreatorTableRow[];
  nowMs: number;
  canUpload: boolean;
  canEdit: boolean;
}) {
  const { matches, isActive: filterActive } = useCreatorFilter();
  const filteredRows = useMemo(
    () => rows.filter((c) => matches(c.username, c.owner_cpm_id)),
    [rows, matches]
  );

  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const total = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Menyempitkan filter bisa membuat halaman aktif melewati akhir daftar —
  // tarik kembali ke halaman terakhir yang masih ada.
  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(total / pageSize))));
  }, [total, pageSize]);

  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const visibleRows = useMemo(
    () => filteredRows.slice(start, start + pageSize),
    [filteredRows, start, pageSize]
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3">Username</th>
              <th className="px-3 py-3">Nama Creator</th>
              <th className="px-3 py-3">No HP</th>
              <th className="px-3 py-3">Platform</th>
              <th className="px-3 py-3">Jenis</th>
              <th className="px-3 py-3">Niche (Top 3)</th>
              <th className="px-3 py-3">Followers</th>
              <th className="px-3 py-3">Kualitas</th>
              <th className="px-3 py-3">GMV Total <span className="normal-case text-slate-400">(avg/bln)</span></th>
              <th className="px-3 py-3">GMV Live <span className="normal-case text-slate-400">(avg/bln)</span></th>
              <th className="px-3 py-3">GMV Video <span className="normal-case text-slate-400">(avg/bln)</span></th>
              <th className="px-3 py-3">Sharing Komisi</th>
              <th className="px-3 py-3">RC Live</th>
              <th className="px-3 py-3">RC Video</th>
              <th className="px-3 py-3">Rate Card (Rp)</th>
              <th className="px-3 py-3">CM</th>
              <th className="px-3 py-3">Level</th>
              <th className="px-3 py-3">Join</th>
              <th className="px-3 py-3">End Date</th>
              <th className="px-3 py-3">Sisa Kontrak</th>
              <th className="px-3 py-3">Domisili</th>
              <th className="px-3 py-3">Alamat Lengkap</th>
              <th className="px-3 py-3">UID</th>
              <th className="px-3 py-3">Status</th>
              {canEdit && <th className="px-3 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((c) => {
              const remaining = contractRemaining(c.join_date, c.contract_end_date, nowMs);
              const niches: string[] = c.top_niches ?? (c.niche ? [c.niche] : []);
              return (
                <tr key={c.id}>
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
                  {canEdit && (
                    <td className={td}>
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
                    </td>
                  )}
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 25 : 24} className="px-4 py-6 text-center text-slate-400">
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
    </div>
  );
}
