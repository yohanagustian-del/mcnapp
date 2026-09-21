"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { saveReportEdits, resetReportSection } from "@/app/(portal)/reports/actions";
import {
  applyReportEdits, isEdited,
  type BenchmarkRow, type InsightBox, type ReportDataV2, type ReportEdits,
  type ReportEditSection, type ReportLiveSession, type ReportProduct,
} from "@/lib/report/types";

const rupiah = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const rupiahShort = (n: number | null) => {
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `Rp${(n / 1_000_000_000).toFixed(1).replace(".", ",")} M`;
  if (abs >= 1_000_000) return `Rp${(n / 1_000_000).toFixed(1).replace(".", ",")} jt`;
  if (abs >= 1_000) return `Rp${Math.round(n / 1_000).toLocaleString("id-ID")} rb`;
  return rupiah(n);
};
const num = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("id-ID"));
const pct = (n: number | null, digits = 1) => (n === null ? "—" : `${(n * 100).toFixed(digits).replace(".", ",")}%`);
const jam = (minutes: number | null) => {
  if (minutes === null) return "—";
  const h = minutes / 60;
  return `${(Number.isInteger(h) ? h : Number(h.toFixed(1))).toString().replace(".", ",")} jam`;
};
const delta = (d: number | null) => (d === null ? "—" : `${d >= 0 ? "+" : ""}${pct(d)}`);

const GREEN = "#1EA469";
const GREEN_DARK = "#0F6B44";
const ORANGE = "#F28A26";
const CATEGORY_COLORS = ["#1EA469", "#F28A26", "#3B82F6", "#A855F7", "#EF4444", "#64748B"];

const TONE_STYLES: Record<InsightBox["tone"], string> = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-900",
  info: "border-slate-200 bg-slate-50 text-slate-800",
};

const STATUS_STYLES: Record<BenchmarkRow["status"], string> = {
  above: "text-emerald-700", near: "text-amber-700", below: "text-red-700", unknown: "text-slate-400",
};
const STATUS_LABELS: Record<BenchmarkRow["status"], string> = {
  above: "Di atas benchmark", near: "Mendekati benchmark", below: "Di bawah benchmark", unknown: "Data belum ada",
};

type TabKey = "ringkasan" | "video" | "live" | "deepdive" | "produk";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ringkasan", label: "Ringkasan" },
  { key: "video", label: "Short Video" },
  { key: "live", label: "Live Performance" },
  { key: "deepdive", label: "Analisa Live Terbaik" },
  { key: "produk", label: "Produk Optimal" },
];

function Kpi({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2.5">
      <p className="text-lg font-extrabold leading-tight">{value}</p>
      <p className="mt-0.5 text-xs opacity-85">{label}</p>
      {sub && <p className="text-[11px] opacity-70">{sub}</p>}
    </div>
  );
}

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-[#F7FAF8] px-3 py-2">
      <p className="text-xs text-[#5F6F66]">{label}</p>
      <p className="text-base font-bold text-[#1B2A22]">{value}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/**
 * Bar benchmark dengan jarum: posisi bar = nilai kreator relatif terhadap
 * 2× benchmark (jadi benchmark selalu jatuh di tengah), jarum = benchmark-nya.
 * Nilai yang tidak ada TIDAK digambar sebagai nol.
 */
function BenchmarkBar({ row }: { row: BenchmarkRow }) {
  const fmt = (v: number | null) => (row.unit === "pct" ? pct(v, 2) : rupiahShort(v));
  const scaleMax = Math.max(row.benchmark * 2, row.value ?? 0);
  const width = row.value === null || scaleMax <= 0 ? 0 : Math.min(100, (row.value / scaleMax) * 100);
  const needle = scaleMax > 0 ? Math.min(100, (row.benchmark / scaleMax) * 100) : 50;
  const barColor = row.status === "above" ? GREEN : row.status === "near" ? ORANGE : "#EF4444";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-1">
        <span className="text-xs font-medium text-slate-700">{row.label}</span>
        <span className={`text-xs font-semibold ${STATUS_STYLES[row.status]}`}>
          {fmt(row.value)} <span className="font-normal text-slate-400">vs {fmt(row.benchmark)}</span>
        </span>
      </div>
      <div className="relative mt-1 h-2.5 w-full rounded-full bg-slate-100">
        <div className="h-2.5 rounded-full" style={{ width: `${width}%`, backgroundColor: barColor }} />
        <div className="absolute top-[-3px] h-4 w-[2px] bg-slate-700" style={{ left: `${needle}%` }} title="Benchmark niche" />
      </div>
      <p className={`mt-0.5 text-[11px] ${STATUS_STYLES[row.status]}`}>{STATUS_LABELS[row.status]}</p>
    </div>
  );
}

function ProductTable({ rows, dimension }: { rows: ReportProduct[]; dimension: "live" | "video" | "total" }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">Belum ada data produk untuk periode ini.</p>;
  }
  const gmvOf = (p: ReportProduct) => (dimension === "live" ? p.live_gmv : dimension === "video" ? p.video_gmv : p.gmv);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="py-2 pr-3">Produk</th>
            <th className="py-2 pr-3">GMV</th>
            <th className="py-2 pr-3">Item</th>
            <th className="py-2 pr-3">AOV</th>
            <th className="py-2 pr-3">CTR</th>
            <th className="py-2 pr-3">CTOR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p, i) => (
            <tr key={p.product_id}>
              <td className="py-2 pr-3">
                <span className="text-slate-400">{i + 1}. </span>
                <span className="font-medium text-slate-800">{p.name}</span>
                {p.category && <span className="block text-[11px] text-slate-400">{p.category}</span>}
                {p.badges.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {p.badges.map((b) => (
                      <span key={b} className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">{b}</span>
                    ))}
                  </span>
                )}
              </td>
              <td className="py-2 pr-3">{rupiahShort(gmvOf(p))}</td>
              <td className="py-2 pr-3">{num(p.items)}</td>
              <td className="py-2 pr-3">{rupiahShort(p.aov)}</td>
              <td className="py-2 pr-3">{pct(p.ctr, 2)}</td>
              <td className="py-2 pr-3">{pct(p.ctor, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionTable({ rows }: { rows: ReportLiveSession[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="py-2 pr-3">Sesi</th>
            <th className="py-2 pr-3">Jam</th>
            <th className="py-2 pr-3">Durasi</th>
            <th className="py-2 pr-3">GMV</th>
            <th className="py-2 pr-3">GMV/jam</th>
            <th className="py-2 pr-3">Order</th>
            <th className="py-2 pr-3">CVR</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((s) => (
            <tr key={s.session_id}>
              <td className="py-2 pr-3">
                <span className="font-medium text-slate-800">{s.date}</span>
                <span className="block text-[11px] text-slate-400">Sesi #{s.session_no}{s.brand ? ` · ${s.brand}` : ""}</span>
              </td>
              <td className="py-2 pr-3">{s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : "—"}</td>
              <td className="py-2 pr-3">{jam(s.duration_min)}</td>
              <td className="py-2 pr-3">{rupiahShort(s.gmv)}</td>
              <td className="py-2 pr-3">{rupiahShort(s.gmv_per_hour)}</td>
              <td className="py-2 pr-3">{num(s.orders)}</td>
              <td className="py-2 pr-3">{pct(s.cvr, 2)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-4 text-center text-slate-400">Belum ada sesi live.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Textarea inline untuk satu bagian teks + tombol "Kembalikan ke otomatis". */
function EditableText({
  reportId, section, editKey, title, text, edited, onDone,
}: {
  reportId: number;
  section: ReportEditSection;
  editKey?: string;
  title?: string;
  text: string;
  edited: boolean;
  onDone: () => void;
}) {
  const [draftTitle, setDraftTitle] = useState(title ?? "");
  const [draftText, setDraftText] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("report_id", String(reportId));
    fd.set("section", section);
    if (editKey) fd.set("key", editKey);
    if (title !== undefined) fd.set("title", draftTitle);
    fd.set("text", draftText);
    startTransition(async () => {
      const res = await saveReportEdits(null, fd);
      if (!res.ok) { setError(res.message); return; }
      onDone();
    });
  }

  function reset() {
    setError(null);
    const fd = new FormData();
    fd.set("report_id", String(reportId));
    fd.set("section", section);
    if (editKey) fd.set("key", editKey);
    startTransition(async () => {
      const res = await resetReportSection(null, fd);
      if (!res.ok) { setError(res.message); return; }
      onDone();
    });
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-slate-300 bg-white p-2 print:hidden">
      {title !== undefined && (
        <input
          value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm font-medium"
          placeholder="Judul"
        />
      )}
      <textarea
        value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={3}
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending}
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {pending ? "Menyimpan…" : "Simpan teks"}
        </button>
        {edited && (
          <button type="button" onClick={reset} disabled={pending}
            className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 disabled:opacity-50">
            Kembalikan ke otomatis
          </button>
        )}
        <span className="text-[11px] text-slate-400">Angka tidak bisa disunting — hanya teks.</span>
      </div>
    </div>
  );
}

/**
 * Report Kreator (M2) versi 2 — SATU komponen dipakai halaman tim
 * (`/reports/[id]`) dan portal kreator (`/portal/reports/[id]`).
 *
 * Seluruh isinya berasal dari `data_json` (schema_version 2) yang sudah dirakit
 * server: tidak ada satu angka pun yang dihitung di komponen ini, dan tidak ada
 * teks yang lahir dari LLM. `edits` = suntingan teks tim yang ditempelkan di
 * atas teks otomatis (applyReportEdits).
 */
export function CreatorReportView({
  data: raw, edits, status, editable = false, audience = "creator", reportId,
}: {
  data: ReportDataV2;
  edits: ReportEdits | null;
  status: "draft" | "final";
  /** true = tim boleh menyunting teks (izin reports.finalize, report masih draft). */
  editable?: boolean;
  audience?: "creator" | "team";
  reportId: number;
}) {
  const [tab, setTab] = useState<TabKey>("ringkasan");
  const [editMode, setEditMode] = useState(false);
  const [version, setVersion] = useState(0); // memaksa render ulang setelah simpan
  const data = useMemo(() => applyReportEdits(raw, edits), [raw, edits]);

  const hourChart = data.live.by_start_hour.map((b) => ({
    label: `${String(b.hour).padStart(2, "0")}.00`,
    gmv: b.gmv,
    per_jam: b.gmv_per_hour ?? 0,
  }));
  const categoryChart = data.categories.map((c) => ({ name: c.sub_category, value: c.gmv }));
  const handle = data.creator.username ? `@${data.creator.username}` : data.creator.name;
  const onDone = () => setVersion((v) => v + 1);

  return (
    <div className="mx-auto max-w-4xl" key={version}>
      <header className="rounded-t-2xl bg-[#0F6B44] px-6 py-5 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs opacity-85">MCN MEA · Report Kreator · {data.period.label}</p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            status === "final" ? "bg-white text-[#0F6B44]" : "bg-white/20 text-white"
          }`}>
            {status === "final" ? "Final" : "Draft"}
          </span>
        </div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{handle}</h1>
        <p className="text-sm opacity-90">
          {data.creator.name}
          {data.creator.niche ? ` · ${data.creator.niche}` : ""}
          {data.creator.level ? ` · Level L${data.creator.level}` : ""}
          {` · ${data.period.weeks_counted} minggu data`}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Kpi value={rupiahShort(data.metrics.gmv)} label="GMV" sub={`Δ ${delta(data.deltas.gmv)}`} />
          <Kpi value={num(data.metrics.orders)} label="Order" sub={`Δ ${delta(data.deltas.orders)}`} />
          <Kpi value={rupiahShort(data.metrics.aov)} label="AOV" />
          <Kpi value={pct(data.metrics.live_share)} label="Kontribusi live" />
          <Kpi
            value={data.live.available ? String(data.live.sessions) : "—"}
            label="Sesi live terekam"
            sub={data.live.available ? jam(data.live.duration_total_min) : "belum diunggah"}
          />
        </div>
      </header>

      <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto rounded-b-none border-x border-b border-slate-200 bg-white px-2 py-2 print:hidden">
        {TABS.map((t) => (
          <button
            key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === t.key ? "bg-[#0F6B44] text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </button>
        ))}
        {editable && (
          <button type="button" onClick={() => setEditMode((v) => !v)}
            className={`ml-auto whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium ${
              editMode ? "bg-amber-500 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-100"
            }`}>
            {editMode ? "Selesai Edit" : "Edit Report"}
          </button>
        )}
      </nav>

      <div className="space-y-4 rounded-b-2xl border border-t-0 border-slate-200 bg-slate-50 p-4">
        {/* ===== RINGKASAN ===== */}
        {tab === "ringkasan" && (
          <>
            <Card title="Ringkasan eksekutif">
              <p className="whitespace-pre-wrap text-sm text-slate-700">{data.summary}</p>
              {editMode && (
                <EditableText reportId={reportId} section="summary" text={data.summary}
                  edited={isEdited(edits, "summary")} onDone={onDone} />
              )}
            </Card>

            {(data.contract_alert || (data.link_leakage && data.link_leakage.link_status !== "via_agency")) && audience === "team" && (
              <div className="space-y-2">
                {data.contract_alert && (
                  <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
                    ⚠ Kontrak {data.contract_alert.expired ? "SUDAH berakhir" : "hampir berakhir"}: {data.contract_alert.contract_end_date}
                  </p>
                )}
                {data.link_leakage && data.link_leakage.link_status !== "via_agency" && (
                  <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                    ⚠ Status link (M4, minggu {data.link_leakage.week}): {data.link_leakage.link_status}
                    {data.link_leakage.leak_ratio !== null && <> — rasio bocor {pct(data.link_leakage.leak_ratio)}</>}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              {data.insights.map((box) => (
                <div key={box.key} className={`rounded-xl border p-3 ${TONE_STYLES[box.tone]}`}>
                  <p className="text-sm font-semibold">{box.title}</p>
                  <p className="mt-1 text-sm">{box.text}</p>
                  {editMode && (
                    <EditableText reportId={reportId} section="insight" editKey={box.key}
                      title={box.title} text={box.text}
                      edited={isEdited(edits, "insight", box.key)} onDone={onDone} />
                  )}
                </div>
              ))}
            </div>

            <Card title="Perbandingan dengan periode sebelumnya">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr><th className="py-2 pr-3">Metrik</th><th className="py-2 pr-3">Periode ini</th><th className="py-2 pr-3">Periode lalu</th><th className="py-2 pr-3">Δ</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {([
                      ["GMV", data.metrics.gmv, data.previous.gmv, data.deltas.gmv, rupiahShort],
                      ["GMV Live", data.metrics.live_gmv, data.previous.live_gmv, data.deltas.live_gmv, rupiahShort],
                      ["GMV Video", data.metrics.video_gmv, data.previous.video_gmv, data.deltas.video_gmv, rupiahShort],
                      ["Order", data.metrics.orders, data.previous.orders, data.deltas.orders, num],
                      ["Item terjual", data.metrics.items, data.previous.items, data.deltas.items, num],
                      ["AOV", data.metrics.aov, data.previous.aov, data.deltas.aov, rupiahShort],
                    ] as [string, number | null, number | null, number | null, (n: number | null) => string][]).map(
                      ([label, now, before, d, fmt]) => (
                        <tr key={label}>
                          <td className="py-2 pr-3 font-medium text-slate-700">{label}</td>
                          <td className="py-2 pr-3">{fmt(now)}</td>
                          <td className="py-2 pr-3 text-slate-500">{fmt(before)}</td>
                          <td className={`py-2 pr-3 ${d === null ? "text-slate-400" : d >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                            {delta(d)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {categoryChart.length > 0 && (
              <Card title="Komposisi kategori" note="Level 2 category, dari agregat ingest.">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryChart} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                        {categoryChart.map((_, i) => (
                          <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => rupiah(Number(v ?? 0))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}

            {data.recommendations.length > 0 && (
              <Card title="Rekomendasi untuk periode berikutnya">
                <ol className="list-inside list-decimal space-y-2 text-sm text-slate-700">
                  {data.recommendations.map((r) => (
                    <li key={r.key}>
                      {r.text}
                      {editMode && (
                        <EditableText reportId={reportId} section="recommendation" editKey={r.key} text={r.text}
                          edited={isEdited(edits, "recommendation", r.key)} onDone={onDone} />
                      )}
                    </li>
                  ))}
                </ol>
              </Card>
            )}

            {audience === "team" && data.benchmark && (
              <Card title="Benchmark peer (anonim)">
                <p className="text-sm text-slate-700">
                  Rata-rata GMV {data.benchmark.peers} kreator niche “{data.benchmark.niche}”:{" "}
                  <strong>{rupiahShort(data.benchmark.peer_avg_gmv)}</strong> vs kreator ini{" "}
                  <strong>{rupiahShort(data.metrics.gmv)}</strong>.
                </p>
              </Card>
            )}

            <Card title="Catatan data">
              <ul className="list-inside list-disc space-y-1 text-xs text-slate-500">
                {data.data_notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </Card>
          </>
        )}

        {/* ===== SHORT VIDEO ===== */}
        {tab === "video" && (
          <>
            <Card title="Performa short video">
              <div className="grid gap-2 sm:grid-cols-4">
                <Stat label="GMV video" value={rupiahShort(data.video.gmv)} />
                <Stat label="Order video" value={num(data.video.orders)} />
                <Stat label="Kontribusi" value={pct(data.video.share)} />
                <Stat label="AOV video" value={rupiahShort(data.video.aov)} />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Jumlah video, durasi tonton, dan AWD tidak tersedia di export platform — tidak ditampilkan
                supaya tidak ada angka karangan.
              </p>
            </Card>
            <Card title="Produk terbaik lewat video">
              {data.products.split_unavailable ? (
                <p className="text-sm text-slate-500">
                  Pecahan GMV live vs video per produk belum tersedia untuk periode ini (data produk diunggah
                  sebelum kolomnya ada). Lihat tab Produk Optimal untuk peringkat GMV total.
                </p>
              ) : (
                <ProductTable rows={data.products.top_video} dimension="video" />
              )}
            </Card>
          </>
        )}

        {/* ===== LIVE PERFORMANCE ===== */}
        {tab === "live" && (
          <>
            {!data.live.available ? (
              <Card title="Live performance">
                <p className="text-sm text-slate-600">
                  Belum ada file sesi live yang diunggah untuk periode ini lewat Jadwal Live.
                  {data.metrics.live_gmv > 0 && (
                    <> Data platform mencatat GMV live {rupiahShort(data.metrics.live_gmv)}, tapi rincian per sesi
                    (jam terbaik, CVR, alur 30 menit) butuh file TikTok LIVE Center.</>
                  )}
                </p>
              </Card>
            ) : (
              <>
                <Card title="Ringkasan sesi live"
                  note={`Dari ${data.live.sessions} sesi di ${data.live.days} hari yang file-nya sudah diunggah.`}>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat label="GMV live" value={rupiahShort(data.live.gmv)}
                      hint={data.live.coverage_ratio !== null ? `${pct(data.live.coverage_ratio)} dari GMV live platform` : undefined} />
                    <Stat label="GMV per jam" value={rupiahShort(data.live.gmv_per_hour)} />
                    <Stat label="Durasi rata-rata" value={jam(data.live.duration_avg_min)} />
                    <Stat label="Sesi terpanjang" value={jam(data.live.longest_session_min)} />
                    <Stat label="Views" value={num(data.live.views)} />
                    <Stat label="Puncak penonton" value={num(data.live.viewers_peak)} />
                    <Stat label="Order" value={num(data.live.orders)} />
                    <Stat label="GMV per sesi" value={rupiahShort(data.live.gmv_per_session)} />
                  </div>
                </Card>

                <Card title="Benchmark niche" note="Jarum hitam = benchmark industri untuk niche kreator ini (app_config).">
                  <div className="space-y-3">
                    {data.live.benchmarks.map((b) => <BenchmarkBar key={b.key} row={b} />)}
                  </div>
                </Card>

                {hourChart.length > 0 && (
                  <Card title="Jam mulai live"
                    note={data.live.best_start_hour !== null
                      ? `Paling produktif: mulai pukul ${String(data.live.best_start_hour).padStart(2, "0")}.00.`
                      : undefined}>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={hourChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E7EEE9" />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                          <YAxis tickFormatter={(v: number) => rupiahShort(v)} tick={{ fontSize: 10 }} width={70} />
                          <Tooltip formatter={(v) => rupiah(Number(v ?? 0))} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="gmv" name="GMV" fill={GREEN} radius={[4, 4, 0, 0]} />
                          <Bar dataKey="per_jam" name="GMV per jam" fill={ORANGE} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                )}

                <Card title="Peringkat sesi">
                  <SessionTable rows={data.live.top_sessions} />
                </Card>
              </>
            )}
          </>
        )}

        {/* ===== ANALISA LIVE TERBAIK ===== */}
        {tab === "deepdive" && (
          data.live_deep_dive.length === 0 ? (
            <Card title="Analisa live terbaik">
              <p className="text-sm text-slate-600">Belum ada sesi live yang bisa dibedah untuk periode ini.</p>
            </Card>
          ) : (
            <>
              {data.live_deep_dive.map((dd) => (
                <Card
                  key={dd.session.session_id}
                  title={`${dd.session.date} · Sesi #${dd.session.session_no}${dd.session.brand ? ` · ${dd.session.brand}` : ""}`}
                  note={dd.session.start_time && dd.session.end_time
                    ? `${dd.session.start_time}–${dd.session.end_time} WIB · ${jam(dd.session.duration_min)}`
                    : jam(dd.session.duration_min)}
                >
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Stat label="GMV" value={rupiahShort(dd.session.gmv)} />
                    <Stat label="GMV per jam" value={rupiahShort(dd.session.gmv_per_hour)} />
                    <Stat label="Order" value={num(dd.session.orders)} />
                    <Stat label="Views" value={num(dd.session.views)} />
                  </div>

                  <div className="mt-4 space-y-3">
                    {dd.benchmarks.map((b) => <BenchmarkBar key={b.key} row={b} />)}
                  </div>

                  {dd.timeline.length > 0 && (
                    <div className="mt-4 h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={dd.timeline}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E7EEE9" />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" tickFormatter={(v: number) => rupiahShort(v)} tick={{ fontSize: 10 }} width={70} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} width={45} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar yAxisId="left" dataKey="gmv" name="GMV" fill={GREEN} radius={[3, 3, 0, 0]} />
                          <Line yAxisId="right" dataKey="viewers" name="Penonton" stroke={GREEN_DARK} dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {dd.top_products.length > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left text-xs uppercase text-slate-400">
                          <tr>
                            <th className="py-2 pr-3">Produk sesi ini</th>
                            <th className="py-2 pr-3">GMV</th>
                            <th className="py-2 pr-3">Item</th>
                            <th className="py-2 pr-3">CTR</th>
                            <th className="py-2 pr-3">CTOR</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {dd.top_products.map((p, i) => (
                            <tr key={i}>
                              <td className="py-2 pr-3 font-medium text-slate-800">{p.name}</td>
                              <td className="py-2 pr-3">{rupiahShort(p.gmv)}</td>
                              <td className="py-2 pr-3">{num(p.items)}</td>
                              <td className="py-2 pr-3">{pct(p.ctr, 2)}</td>
                              <td className="py-2 pr-3">{pct(p.ctor, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {dd.notes.length > 0 && (
                    <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-slate-600">
                      {dd.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  )}
                </Card>
              ))}
            </>
          )
        )}

        {/* ===== PRODUK OPTIMAL ===== */}
        {tab === "produk" && (
          <>
            <Card
              title={data.products.split_unavailable ? "Produk terbaik (GMV total)" : "Produk terbaik untuk LIVE"}
              note={data.products.split_unavailable
                ? "Pecahan live/video per produk belum tersedia untuk periode ini."
                : undefined}
            >
              <ProductTable rows={data.products.top_live} dimension={data.products.split_unavailable ? "total" : "live"} />
            </Card>
            {!data.products.split_unavailable && (
              <Card title="Produk terbaik untuk VIDEO">
                <ProductTable rows={data.products.top_video} dimension="video" />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
