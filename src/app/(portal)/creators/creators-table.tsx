"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { CreatorEditButton } from "./creator-edit-button";
import { updateRateCard } from "./actions";

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

function formatShare(v: number | null | undefined): string {
  if (v == null) return "—";
  const pct = v <= 1 ? v * 100 : v;
  return `${Number(pct.toFixed(1))}%`;
}

function contractRemaining(end: string | null): { label: string; danger: boolean } {
  if (!end) return { label: "—", danger: false };
  const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= 60) return { label: `${days} hari`, danger: days <= 30 };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

const td = "px-3 py-2 whitespace-nowrap";

interface CreatorRow {
  id: string;
  name: string | null;
  username: string | null;
  profile_link: string | null;
  phone: string | null;
  uid: string | null;
  followers: number | null;
  content_quality: string | null;
  join_date: string | null;
  domisili: string | null;
  jenis_creator: string | null;
  niche: string | null;
  top_niches: string[] | null;
  level: number | null;
  segment: string | null;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  platform: string | null;
  rc_live: string | null;
  rc_video: string | null;
  rate_card: number | null;
  commission_share: number | null;
  contract_end_date: string | null;
  status: string | null;
  tim_akuisisi: string | null;
  target_gmv_monthly: number | null;
  team_members: { name?: string } | null;
}

export function CreatorsTable({
  creators,
  expiringSoon,
  canEdit,
  canUpload,
}: {
  creators: CreatorRow[];
  expiringSoon: number;
  canEdit: boolean;
  canUpload: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCreators = useMemo(() => {
    if (!searchQuery.trim()) return creators;
    const query = searchQuery.toLowerCase();
    return creators.filter((c) => {
      return (
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.username && c.username.toLowerCase().includes(query)) ||
        (c.phone && c.phone.includes(query)) ||
        (c.uid && c.uid.toLowerCase().includes(query)) ||
        (c.domisili && c.domisili.toLowerCase().includes(query))
      );
    });
  }, [creators, searchQuery]);

  return (
    <div className="mt-6 space-y-4">
      {/* Summary Widget */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-semibold text-amber-900">{expiringSoon}</div>
          <div>
            <p className="text-sm font-medium text-amber-900">Kontrak berakhir dalam 30 hari</p>
            <p className="text-xs text-amber-700">Butuh follow-up atau perpanjangan kontrak</p>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div>
        <input
          type="text"
          placeholder="Cari kreator berdasarkan nama, username, no HP, UID, atau domisili..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm placeholder-slate-500 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
        {searchQuery && (
          <p className="mt-1 text-xs text-slate-500">
            Menampilkan {filteredCreators.length} dari {creators.length} kreator
          </p>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
              <th className="px-3 py-3">Sisa Kontrak</th>
              <th className="px-3 py-3">Domisili</th>
              <th className="px-3 py-3">UID</th>
              <th className="px-3 py-3">Status</th>
              {canEdit && <th className="px-3 py-3">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredCreators.map((c) => {
              const remaining = contractRemaining(c.contract_end_date);
              const niches: string[] =
                (c.top_niches as string[] | null) ?? (c.niche ? [c.niche] : []);
              const cm = (c.team_members as unknown as { name?: string } | null)?.name;
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
                  <td className={td}>{cm ?? "—"}</td>
                  <td className={td}>{c.level ? `L${c.level}` : "—"}</td>
                  <td className={td}>{c.join_date ?? "—"}</td>
                  <td className={`${td} ${remaining.danger ? "font-medium text-red-600" : ""}`}>
                    {remaining.label}
                  </td>
                  <td className={td}>{c.domisili ?? "—"}</td>
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
            {filteredCreators.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 23 : 22} className="px-4 py-6 text-center text-slate-400">
                  {searchQuery ? "Tidak ada kreator yang sesuai dengan pencarian." : "Belum ada kreator."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
