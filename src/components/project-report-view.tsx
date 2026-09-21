"use client";

import { useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ProjectReportData } from "@/lib/m7/report-data";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const num = (n: number) => Math.round(n).toLocaleString("id-ID");
const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")}%`;
const rupiahAxis = (v: number) => {
  if (Math.abs(v) >= 1_000_000_000) return `Rp${(v / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000_000) return `Rp${(v / 1_000_000).toFixed(0)}jt`;
  if (Math.abs(v) >= 1_000) return `Rp${(v / 1_000).toFixed(0)}rb`;
  return String(v);
};

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
/** "2026-09-15" → "15 September 2026". Report ini dibaca kreator, bukan mesin. */
const tanggal = (iso: string | null) => {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
};
/** "2026-09-15" → "15 Sep" — label tab, harus muat di layar HP. */
const tanggalSingkat = (iso: string | null) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${(BULAN[Number(m[2]) - 1] ?? m[2]).slice(0, 3)}`;
};
/** 120 → "±2 jam", 90 → "±1,5 jam". */
const durasi = (minutes: number) => {
  const hours = minutes / 60;
  return `±${Number.isInteger(hours) ? hours : hours.toFixed(1).replace(".", ",")} jam`;
};

const GREEN = "#1EA469";
const GREEN_DARK = "#0F6B44";
const ORANGE = "#F28A26";

function Kpi({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-[#F7FAF8] px-3 py-2.5">
      <p className="text-lg font-extrabold leading-tight text-[#1B2A22]">{value}</p>
      <p className="mt-0.5 text-xs text-[#5F6F66]">{label}</p>
    </div>
  );
}

/**
 * Report peserta project (PRD §6.13 / addendum §9): satu komponen dipakai halaman
 * tim (`/projects/[id]/report/[creatorId]`) DAN tab portal kreator
 * (`/portal/projects/report/[projectId]`) — presentasi murni, semua angka SUDAH
 * dihitung server-side (report-data.ts). Tidak ada angka yang ditampilkan di luar
 * `data_json` (R27).
 *
 * `audience` menentukan ANGLE, bukan sekadar gaya (revisi user 2026-09-17): versi
 * kreator berhenti di "apa yang bisa saya perbaiki sesi depan", sementara
 * peringkat peserta / kontribusi ke GMV project / rata-rata peserta lain adalah
 * bahan rapat tim dan HANYA muncul di halaman tim. Default-nya `creator` supaya
 * pemanggil baru tidak diam-diam membocorkan angle internal ke kreator.
 *
 * Blok live (alur sesi, funnel, efisiensi, produk) hanya muncul kalau `data.live`
 * ada: report yang dibuat sebelum detail live masuk kontrak tetap ter-render,
 * cukup tanpa bagian-bagian itu sampai di-generate ulang.
 */
export function ProjectReportView({
  data, insight, status, audience = "creator",
}: {
  data: ProjectReportData;
  insight: string | null;
  status: "draft" | "final";
  audience?: "creator" | "team";
}) {
  // Pemilih hari (permintaan tim 2026-09-17): kreator ingin membaca performanya
  // PER HARI, bukan hanya angka gabungan seluruh project. `null` = Gabungan.
  const days = data.live_days ?? [];
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const selectedDay = dayIndex === null ? null : days[dayIndex] ?? null;
  const live = selectedDay ?? data.live;

  const dailyChart = data.daily.map((d) => ({ date: d.date.slice(5), gmv: d.gmv }));

  // Funnel tayang → beli: langkah yang datanya belum ada (impresi live pada sesi
  // lama) dihilangkan, bukan digambar sebagai nol.
  const funnel = live
    ? [
        { label: "Impresi live", value: live.impressions_live },
        { label: "Views", value: live.views },
        { label: "Impresi produk", value: live.product_impressions },
        { label: "Klik produk", value: live.product_clicks },
        { label: "Masuk keranjang", value: live.add_to_cart },
        { label: "Pesanan", value: live.orders },
      ].filter((s): s is { label: string; value: number } => s.value !== null)
    : [];
  const funnelMax = Math.max(...funnel.map((s) => s.value), 1);

  // Produk dari sesi live (migrasi 0062) kalau ada; kalau tidak, jatuh ke daftar
  // produk jalur upload metrik — supaya report lama tetap menampilkan sesuatu.
  const products =
    live && live.products.length > 0
      ? live.products.map((p) => ({ name: p.name, gmv: p.gmv, items: p.items, clicks: p.clicks as number | null }))
      : data.top_products.map((p) => ({ name: p.name, gmv: p.gmv, items: p.items, clicks: null }));
  const maxProductGmv = Math.max(...products.map((p) => p.gmv), 1);

  const isSlot = data.period.type === "live_slot";
  const judul =
    (isSlot
      ? `MCN MEA · Live Stream Report · ${data.period.project_name}`
      : `MCN MEA · Special Project · ${data.period.project_name}`) +
    (live?.session_no !== null && live?.session_no !== undefined ? ` — Sesi ${live.session_no}` : "");
  const handle = data.creator.username ? `@${data.creator.username}` : data.creator.name;

  const meta = live
    ? [
        // Jadwal yang direncanakan vs yang terjadi — hanya untuk report slot.
        isSlot && data.slot?.planned_start && data.slot?.planned_end
          ? `Jadwal ${data.slot.planned_start}–${data.slot.planned_end}`
          : null,
        live.brands.length > 0 ? `Brand ${live.brands.join(", ")}` : null,
        live.first_date === live.last_date
          ? tanggal(live.first_date)
          : `${tanggal(live.first_date)} – ${tanggal(live.last_date)}`,
        live.start_time && live.end_time ? `${live.start_time}–${live.end_time} WIB` : null,
        live.duration_min > 0 ? durasi(live.duration_min) : null,
        live.sessions > 1 ? `${live.sessions} sesi live` : null,
      ].filter(Boolean).join(" · ")
    : isSlot
      ? `${tanggal(data.slot?.schedule_date ?? data.period.start)} · belum ada data sesi yang dihitung`
      : `${tanggal(data.period.start)} – ${tanggal(data.period.end)}`;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="relative overflow-hidden rounded-t-2xl bg-[#0F6B44] px-6 py-5 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs opacity-85">{judul}</p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            status === "final" ? "bg-white text-[#0F6B44]" : "bg-white/20 text-white"
          }`}>
            {status === "final" ? "Final" : "Draft"}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{handle}</h1>
        <p className="text-sm opacity-90">{meta}</p>
      </header>

      <div className="rounded-b-2xl border border-t-0 border-[#DCE7E1] bg-white p-6">
        {/* ===== Pemilih hari ===== */}
        {days.length > 1 && (
          <div className="-mt-1 mb-4 flex flex-wrap gap-1.5">
            <button
              type="button" onClick={() => setDayIndex(null)}
              className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                dayIndex === null ? "bg-[#0F6B44] text-white" : "bg-[#F0F5F2] text-[#1B2A22] hover:bg-[#E6F5EE]"
              }`}
            >
              Gabungan
            </button>
            {days.map((d, i) => (
              <button
                key={d.first_date ?? i} type="button" onClick={() => setDayIndex(i)}
                className={`rounded-full px-3 py-1 text-[13px] font-medium ${
                  dayIndex === i ? "bg-[#0F6B44] text-white" : "bg-[#F0F5F2] text-[#1B2A22] hover:bg-[#E6F5EE]"
                }`}
              >
                {tanggalSingkat(d.first_date)}
              </button>
            ))}
          </div>
        )}

        {/* ===== Hero ===== */}
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#DCE7E1] pb-4">
          <div>
            <p className="text-sm text-[#5F6F66]">
              {selectedDay ? `GMV ${tanggal(selectedDay.first_date)}` : live ? "GMV sesi live" : "GMV project"}
            </p>
            <p className="text-4xl font-extrabold leading-tight tracking-tight text-[#0F6B44]">
              {rupiah(selectedDay ? selectedDay.gmv : data.metrics.gmv)}
            </p>
            <p className="mt-1 text-sm text-[#5F6F66]">
              {num(selectedDay ? selectedDay.orders : data.metrics.orders)} pesanan ·{" "}
              {num(selectedDay ? selectedDay.items : data.metrics.items)} item
              {live ? ` · ${num(live.customers)} pembeli` : ""}
            </p>
          </div>
          {/* Sehari tidak diukur terhadap target seluruh project — itu akan terbaca
              seolah kreatornya jauh tertinggal. Yang relevan: porsi hari itu. */}
          {selectedDay ? (
            <div className="text-right text-sm text-[#5F6F66]">
              <span>dari {rupiah(data.metrics.gmv)} sepanjang project</span>
              <b className="block text-2xl font-extrabold leading-tight text-[#1B2A22]">
                {data.metrics.gmv > 0 ? pct(selectedDay.gmv / data.metrics.gmv) : "—"}
              </b>
            </div>
          ) : data.target.personal_gmv > 0 ? (
            <div className="text-right text-sm text-[#5F6F66]">
              <span>terhadap target pribadi {rupiah(data.target.personal_gmv)}</span>
              <b className="block text-2xl font-extrabold leading-tight text-[#1B2A22]">
                {pct(data.achievement.personal_pct)}
              </b>
            </div>
          ) : null}
        </div>

        {/* ===== Alur sesi (timeline 30 menit) ===== */}
        {live && live.timeline.length > 0 && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">
              Alur sesi <span className="ml-1 text-[13px] font-medium text-[#5F6F66]">GMV per 30 menit vs penonton</span>
            </h2>
            <div style={{ height: 260 }} className="mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={live.timeline} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#EEF3F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#5F6F66" }} />
                  <YAxis yAxisId="gmv" tickFormatter={rupiahAxis} tick={{ fontSize: 11, fill: "#5F6F66" }} width={60} />
                  <YAxis yAxisId="viewers" orientation="right" tick={{ fontSize: 11, fill: "#5F6F66" }} width={36} />
                  <Tooltip
                    formatter={(v, name) => [name === "GMV" ? rupiah(Number(v)) : num(Number(v)), name]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #DCE7E1" }}
                  />
                  <Bar yAxisId="gmv" dataKey="gmv" name="GMV" fill={GREEN} radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="viewers" type="monotone" dataKey="viewers" name="Penonton"
                    stroke={ORANGE} strokeWidth={2} dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* ===== Funnel tayang → beli ===== */}
        {funnel.length > 0 && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">Dari tayang sampai beli</h2>
            <div className="mt-2 grid gap-1.5">
              {funnel.map((step) => (
                <div key={step.label} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
                  <div>
                    <p className="text-[#1B2A22]">{step.label}</p>
                    <div className="mt-1 h-2 rounded-md bg-[#E6F5EE]">
                      <div
                        className="h-full rounded-md bg-[#1EA469]"
                        // Skala logaritmik: tanpa ini batang "Pesanan" (10) tidak
                        // terlihat sama sekali di samping "Impresi live" (15.051).
                        style={{ width: `${(Math.log(step.value + 1) / Math.log(funnelMax + 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-right font-bold tabular-nums">{num(step.value)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ===== Efisiensi ===== */}
        {live && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">Efisiensi</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi value={live.ctr === null ? "—" : pct(live.ctr)} label="CTR produk" />
              <Kpi value={live.ctor === null ? "—" : pct(live.ctor)} label="CTOR (klik → order)" />
              <Kpi value={rupiah(data.metrics.aov)} label="Nilai per pesanan" />
              <Kpi value={live.gpm === null ? "—" : rupiah(live.gpm)} label="GMV per 1.000 views" />
              <Kpi value={num(live.new_followers)} label="Follower baru" />
              <Kpi value={num(live.comments)} label="Komentar" />
              <Kpi value={num(live.likes)} label="Likes" />
              <Kpi value={num(live.shares)} label="Share" />
            </div>
          </>
        )}

        {/* ===== Produk terlaris ===== */}
        {products.length > 0 && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">
              Produk terlaris
              {live && live.products_total > 0 && (
                <span className="ml-1 text-[13px] font-medium text-[#5F6F66]">
                  {num(live.products_sold)} dari {num(live.products_total)} produk etalase terjual
                </span>
              )}
            </h2>
            <div className="mt-2 grid gap-2">
              {products.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate text-[#1B2A22]" title={p.name}>{p.name}</p>
                    <div className="mt-1 h-2 rounded-md bg-[#E6F5EE]">
                      <div className="h-full rounded-md bg-[#1EA469]" style={{ width: `${(p.gmv / maxProductGmv) * 100}%` }} />
                    </div>
                  </div>
                  <span className="text-right font-bold">
                    {rupiah(p.gmv)}
                    <small className="block font-medium text-[#5F6F66]">
                      {num(p.items)} item{p.clicks !== null ? ` · ${num(p.clicks)} klik` : ""}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ===== Tren harian: hanya berguna kalau project jalan lebih dari satu hari ===== */}
        {dayIndex === null && dailyChart.length > 1 && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">
              Tren GMV harian <span className="ml-1 text-[13px] font-medium text-[#5F6F66]">{data.metrics.active_days} hari aktif</span>
            </h2>
            <div style={{ height: 200 }} className="mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyChart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#EEF3F0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#5F6F66" }} />
                  <YAxis tickFormatter={rupiahAxis} tick={{ fontSize: 11, fill: "#5F6F66" }} width={60} />
                  <Tooltip
                    formatter={(v) => [rupiah(Number(v)), "GMV"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #DCE7E1" }}
                  />
                  <Bar dataKey="gmv" fill={GREEN_DARK} radius={[4, 4, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {/* ===== Catatan performa =====
            Catatan deterministik (live.notes) selalu tampil — dihitung dari angka
            report itu sendiri, 0 token, tidak bisa mengarang. Narasi LLM tetap
            tunduk R28: hanya ikut setelah report difinalkan tim. */}
        {(live?.notes.length || insight) && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">Catatan performa</h2>
            <div className="mt-2 grid gap-2">
              {(live?.notes ?? []).map((note, i) => (
                <p key={i} className="rounded-r-xl border-l-[3px] border-[#F28A26] bg-[#FFFAF3] px-4 py-3 text-sm">
                  {note}
                </p>
              ))}
              {insight && (
                <p className="whitespace-pre-wrap rounded-r-xl border-l-[3px] border-[#1EA469] bg-[#F7FAF8] px-4 py-3 text-sm">
                  {insight}
                </p>
              )}
            </div>
          </>
        )}

        {/* ===== Posisi di project (PRD §6.8) — bahan rapat tim, BUKAN angle kreator ===== */}
        {audience === "team" && dayIndex === null && !isSlot && (
          <>
            <h2 className="mt-6 text-[15px] font-bold">
              Posisi di project
              <span className="ml-1 text-[13px] font-medium text-[#5F6F66]">internal, tidak tampil di portal kreator</span>
            </h2>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Kpi value={`#${data.achievement.rank} dari ${data.achievement.of}`} label="Peringkat peserta" />
              <Kpi value={pct(data.achievement.share_of_project)} label="Kontribusi ke GMV project" />
              <Kpi value={rupiah(data.cohort_avg.gmv)} label="Rata-rata peserta lain" />
            </div>
          </>
        )}

        <div className="mt-5 border-t border-dashed border-[#DCE7E1] pt-3 text-xs text-[#5F6F66]">
          {live && live.gmv_trend_diff !== null && live.gmv_trend_diff !== 0 && (
            <p>
              <b className="text-[#9A5300]">Catatan data:</b> total GMV di file Trend Stats ({rupiah(live.gmv_trend ?? 0)})
              berbeda {rupiah(Math.abs(live.gmv_trend_diff))} dari file Product ({rupiah(live.gmv)}). Report memakai
              angka file Product sebagai sumber GMV; timeline memakai Trend Stats.
            </p>
          )}
          <p className="mt-1">
            Data: {isSlot ? "export TikTok LIVE Center (Product + Trend Stats) yang diunggah tim MCN MEA dari Jadwal Live" : "upload tim MCN MEA"} · #meabikinumkmjadiraja
          </p>
        </div>
      </div>
    </div>
  );
}
