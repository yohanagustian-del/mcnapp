import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { getConfig } from "@/lib/config";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadCreators, updateRateCard } from "./actions";
import { CreatorEditButton } from "./creator-edit-button";
import { CreatorSearch } from "./creator-search";

export const dynamic = "force-dynamic";

/** Baris yang dirender sekali muat. Search dijalankan di DB, jadi limit ini
 *  hanya membatasi tampilan — bukan jangkauan pencarian. */
const LIST_LIMIT = 200;

/** Kolom yang ikut dicari (semua bertipe text di DB → ILIKE aman). */
const SEARCH_COLUMNS = ["name", "username", "phone", "uid", "domisili"] as const;

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
function contractRemaining(end: string | null, alertDays: number): { label: string; danger: boolean } {
  if (!end) return { label: "—", danger: false };
  const days = Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { label: `habis ${-days} hr lalu`, danger: true };
  if (days <= 60) return { label: `${days} hari`, danger: days <= alertDays };
  return { label: `${Math.floor(days / 30)} bln ${days % 30} hr`, danger: false };
}

/**
 * Nilai filter `.or()` PostgREST untuk satu kata kunci.
 * Koma & tanda kurung merusak sintaks or(), sedangkan % dan _ adalah wildcard
 * ILIKE — yang pertama dibuang, yang kedua di-escape supaya pencarian literal
 * (mis. "50%") tetap literal. Return null bila tak ada sisa karakter berarti.
 */
function buildSearchFilter(raw: string): string | null {
  const cleaned = raw.replace(/[,()]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const term = `%${cleaned.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return SEARCH_COLUMNS.map((col) => `${col}.ilike.${term}`).join(",");
}

const td = "px-3 py-2 whitespace-nowrap";

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; expiring?: string }>;
}) {
  const { q, expiring } = await searchParams;
  const member = await requireMember();
  const canUpload = hasPermission("creators.bulk_upload", member.role);
  const canEdit = hasPermission("creators.edit", member.role);

  const supabase = await createClient();

  // Threshold dari app_config (CLAUDE.md). Fallback 30 supaya halaman tidak mati
  // bila migration 0027 belum dijalankan di environment ini — getConfig throw
  // saat key tidak ada.
  const alertDays = await getConfig<number>("creators.contract_alert_days").catch(() => 30);

  const todayIso = new Date().toISOString().slice(0, 10);
  const alertLimitIso = new Date(Date.now() + alertDays * 86_400_000).toISOString().slice(0, 10);

  const searchFilter = q ? buildSearchFilter(q) : null;
  const onlyExpiring = expiring === "1";

  let listQuery = supabase
    .from("creators")
    .select(
      "id, name, username, profile_link, phone, uid, followers, content_quality, join_date, domisili, jenis_creator, niche, top_niches, level, segment, gmv, gmv_live, gmv_video, platform, rc_live, rc_video, rate_card, commission_share, contract_end_date, status, tim_akuisisi, target_gmv_monthly, team_members(name)",
      { count: "exact" } // total baris yang match, mengabaikan limit → deteksi hasil terpotong
    )
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (searchFilter) listQuery = listQuery.or(searchFilter);
  if (onlyExpiring) {
    listQuery = listQuery.gte("contract_end_date", todayIso).lte("contract_end_date", alertLimitIso);
  }

  // Angka widget dihitung lintas SELURUH tabel (head:true → tanpa transfer baris),
  // bukan dari subset yang ter-render, dan sengaja TIDAK ikut kata kunci search.
  const [{ data: creators, count: matchCount }, { count: expiringCount }] = await Promise.all([
    listQuery,
    supabase
      .from("creators")
      .select("id", { count: "exact", head: true })
      .gte("contract_end_date", todayIso)
      .lte("contract_end_date", alertLimitIso),
  ]);

  const rows = creators ?? [];
  const total = matchCount ?? rows.length;
  const truncated = total > rows.length;
  const isFiltered = Boolean(searchFilter) || onlyExpiring;

  // Toggle filter widget TANPA membuang kata kunci yang sedang aktif — kalau `q`
  // ikut hilang, CreatorSearch mendeteksi selisih dengan input lalu menavigasi
  // ulang (kedip + 2x query).
  const widgetParams = new URLSearchParams();
  if (q?.trim()) widgetParams.set("q", q.trim());
  if (!onlyExpiring) widgetParams.set("expiring", "1");
  const widgetHref = widgetParams.toString() ? `/creators?${widgetParams}` : "/creators";

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

      {/* ===== Summary: kontrak akan habis (klik = filter list) ===== */}
      <Link
        href={widgetHref}
        className={`mt-6 flex w-full max-w-md items-center gap-3 rounded-lg border p-4 transition hover:shadow-sm ${
          onlyExpiring
            ? "border-amber-400 bg-amber-100 ring-2 ring-amber-300"
            : "border-amber-200 bg-amber-50 hover:border-amber-300"
        }`}
      >
        <span className="text-2xl" aria-hidden>
          ⏳
        </span>
        <span className="flex-1">
          <span className="block text-sm font-medium text-amber-900">
            {expiringCount ?? 0} kreator kontrak habis ≤ {alertDays} hari
          </span>
          <span className="block text-xs text-amber-700">
            {onlyExpiring ? "Filter aktif — klik untuk tampilkan semua" : "Klik untuk filter daftar"}
          </span>
        </span>
        {(expiringCount ?? 0) > 0 && (
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
            perlu follow-up
          </span>
        )}
      </Link>

      {canUpload && (
        <div className="mt-6">
          <CsvUploadForm
            action={uploadCreators}
            buttonLabel="Upload Master Data Creator"
            helpText="Terima sheet 'data creator' asli (xlsx/csv, header Indonesia: Username, Nama Creator, No HP, UID, Followers, Join Date, Niche (kategori 2), RC Live, RC Video, dll). Match by Username → update; belum ada → dibuat baru. GMV & sharing komisi TIDAK diambil dari sheet."
          />
        </div>
      )}

      {/* ===== Search real-time (server-side ILIKE, lintas semua kreator) ===== */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <CreatorSearch initialQuery={q ?? ""} />
        <p className="text-xs text-slate-500">
          {isFiltered
            ? `${total.toLocaleString("id-ID")} hasil${truncated ? ` — ditampilkan ${rows.length} teratas, persempit kata kunci` : ""}`
            : `${total.toLocaleString("id-ID")} kreator${truncated ? ` — ditampilkan ${rows.length} terbaru` : ""}`}
        </p>
      </div>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
            {rows.map((c) => {
              const remaining = contractRemaining(c.contract_end_date, alertDays);
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
            {rows.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 23 : 22} className="px-4 py-6 text-center text-slate-400">
                  {onlyExpiring && !searchFilter
                    ? `Tidak ada kreator yang kontraknya habis dalam ${alertDays} hari.`
                    : searchFilter
                      ? `Tidak ada kreator yang cocok dengan "${q}".`
                      : "Belum ada kreator."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
