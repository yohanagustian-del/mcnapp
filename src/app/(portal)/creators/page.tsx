import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadCreators, updateRateCard } from "./actions";
import { CreatorEditButton } from "./creator-edit-button";

export const dynamic = "force-dynamic";

function formatRp(v: number | null | undefined): string {
  return v ? `Rp${Number(v).toLocaleString("id-ID")}` : "—";
}

/** commission_share stored as fraction (0.22 = 22%). Tolerate legacy percent values (>1). */
function formatShare(v: number | null | undefined): string {
  if (v == null) return "—";
  const pct = v <= 1 ? v * 100 : v;
  return `${Number(pct.toFixed(1))}%`;
}

/** Sisa kontrak dari contract_end_date (computed, tidak disimpan). */
function contractRemaining(end: string | null): { label: string; danger: boolean } {
  if (!end) return { label: "—", danger: false };
  const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= 60) return { label: `${days} hari`, danger: days <= 30 };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

const td = "px-3 py-2 whitespace-nowrap";

export default async function CreatorsPage() {
  const member = await requireMember();
  const canUpload = hasPermission("creators.bulk_upload", member.role);
  const canEdit = hasPermission("creators.edit", member.role);

  const supabase = await createClient();
  const { data: creators } = await supabase
    .from("creators")
    .select(
      "id, name, username, profile_link, phone, uid, followers, content_quality, join_date, domisili, jenis_creator, niche, top_niches, level, segment, gmv, gmv_live, gmv_video, platform, rc_live, rc_video, rate_card, commission_share, contract_end_date, status, tim_akuisisi, target_gmv_monthly, team_members(name)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Kreator</h1>
      <p className="mt-1 text-sm text-slate-500">
        Master data kreator (format sheet &quot;data creator&quot;). GMV total / live / video adalah
        RATA-RATA BULANAN — dihitung otomatis dari upload data platform mingguan di{" "}
        <a href="/ingest" className="underline">/ingest</a> (rata-rata dari seluruh bulan yang punya
        data, bukan total sekali batch). Sharing komisi sync dari platform (read-only) — turun =
        alert, bukan edit.
        {canEdit && (
          <>
            {" "}
            CM bisa mengedit data kreator (username, no HP, RC, rate card, level, domisili, UID,
            status) lewat tombol <strong>Edit</strong> di setiap baris — setiap perubahan tercatat di
            audit log.
          </>
        )}
      </p>

      {canUpload && (
        <div className="mt-6">
          <CsvUploadForm
            action={uploadCreators}
            buttonLabel="Upload Master Data Creator"
            helpText="Terima sheet 'data creator' asli (xlsx/csv, header Indonesia: Username, Nama Creator, No HP, UID, Followers, Join Date, Niche (kategori 2), RC Live, RC Video, dll). Match by Username → update; belum ada → dibuat baru. GMV & sharing komisi TIDAK diambil dari sheet."
          />
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
            {(creators ?? []).map((c) => {
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
            {(creators ?? []).length === 0 && (
              <tr>
                <td colSpan={canEdit ? 23 : 22} className="px-4 py-6 text-center text-slate-400">
                  Belum ada kreator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
