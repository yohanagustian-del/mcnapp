"use client";

import { useMemo, useState, useTransition } from "react";
import {
  buildCsvExport,
  buildTableExport,
  buildTextExport,
  compute,
  type DealType,
  type PoolModelConfig,
  type PredictorResult,
} from "@/lib/m6/predictor";
import type { PriceSegment } from "@/lib/projection/gmv";
import { loadPoolForCategory, saveScenario, type CategoryOption, type SegmentPool } from "./pool-actions";

const SEGMENT_LABELS: Record<PriceSegment, string> = {
  low: "Low-ticket",
  entry: "Entry/mid-low",
  sweet: "Sweet spot",
  high: "High-ticket",
  premium: "Premium",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** BD Value Predictor (M6, pool model): pilih kategori+segmen → pool kreator (centang) → proyeksi. 0 token AI. */
export function PredictorForm({
  categories,
  config,
}: {
  categories: CategoryOption[];
  config: PoolModelConfig;
}) {
  const [category, setCategory] = useState("");
  const [pools, setPools] = useState<SegmentPool[] | null>(null);
  const [segment, setSegment] = useState<PriceSegment | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dealType, setDealType] = useState<DealType>("tap");
  const [brandName, setBrandName] = useState("");
  const [anchor, setAnchor] = useState(0);
  const [ramp, setRamp] = useState(config.rampDefault);
  const [roas, setRoas] = useState(0);
  const [budget, setBudget] = useState(0);
  const [pending, startTransition] = useTransition();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  function onCategoryChange(cat: string) {
    setCategory(cat);
    setPools(null);
    setSegment(null);
    setSelected(new Set());
    setSaveMsg(null);
    if (!cat) return;
    startTransition(async () => {
      const result = await loadPoolForCategory(cat);
      setPools(result);
    });
  }

  const currentPool = pools?.find((p) => p.segment === segment) ?? null;

  function onSegmentChange(seg: PriceSegment) {
    setSegment(seg);
    setSaveMsg(null);
    const pool = pools?.find((p) => p.segment === seg);
    setSelected(new Set((pool?.rows ?? []).map((r) => r.creatorId))); // autoSelect: default semua tercentang
  }

  const selectedRows = useMemo(
    () => (currentPool?.rows ?? []).filter((r) => selected.has(r.creatorId)),
    [currentPool, selected]
  );

  const result: PredictorResult | null = useMemo(() => {
    if (!currentPool) return null;
    return compute({ dealType, selectedCreatorGmv: selectedRows.map((r) => r.gmvCell), anchor, ramp, roas, budget }, config);
  }, [currentPool, selectedRows, dealType, anchor, ramp, roas, budget, config]);

  function toggleCreator(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!category || !segment || !result) return;
    setSaveMsg(null);
    try {
      await saveScenario({
        dealType, brandName, category, segment,
        selectedCreatorIds: [...selected], ramp, roas, budget, anchor, result,
      });
      setSaveMsg("Skenario tersimpan.");
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Gagal menyimpan skenario.");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ---- Kolom kiri: Setup Deal + Creator Pool ---- */}
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-800">Setup Deal</h3>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <label className="block text-xs text-slate-500">Tipe Deal</label>
              <select
                value={dealType}
                onChange={(e) => setDealType(e.target.value as DealType)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="tap">TAP</option>
                <option value="paid">Paid Campaign</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">Nama Brand (catatan)</label>
              <input
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder="Opsional"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">Kategori (Level 2)</label>
              <select
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Pilih kategori —</option>
                {categories.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category} ({c.creatorCount} kreator)
                  </option>
                ))}
              </select>
            </div>
            {pending && <p className="text-xs text-slate-400">Memuat pool kreator...</p>}
            {pools && (
              <div>
                <label className="block text-xs text-slate-500">Segmen Harga</label>
                <div className="mt-1 flex flex-wrap gap-2">
                  {pools.map((p) => (
                    <button
                      key={p.segment}
                      type="button"
                      onClick={() => onSegmentChange(p.segment)}
                      className={`rounded-full px-3 py-1 text-xs ${
                        segment === p.segment ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {SEGMENT_LABELS[p.segment]} · {p.rows.length} kreator · {rupiah(p.totalGmv)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dealType !== "tap" && (
              <div>
                <label className="block text-xs text-slate-500">Anchor Campaign (Rp, opsional)</label>
                <input
                  type="number" min={0}
                  value={anchor || ""}
                  onChange={(e) => setAnchor(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-500">Ramp-up ({Math.round(ramp * 100)}%)</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={ramp}
                onChange={(e) => setRamp(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-slate-500">ROAS (opsional)</label>
                <input
                  type="number" min={0} step={0.1}
                  value={roas || ""}
                  onChange={(e) => setRoas(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500">Ads Budget (Rp)</label>
                <input
                  type="number" min={0}
                  value={budget || ""}
                  onChange={(e) => setBudget(Number(e.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
            </div>
          </div>
        </div>

        {currentPool && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">
                Creator Pool ({selectedRows.length}/{currentPool.rows.length} terpilih)
              </h3>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => download(buildTextExport(selectedRows), "creator-pool.txt")} className="text-blue-600 hover:underline">Teks</button>
                <button type="button" onClick={() => download(buildTableExport(selectedRows), "creator-pool.tsv")} className="text-blue-600 hover:underline">TSV</button>
                <button type="button" onClick={() => download(buildCsvExport(selectedRows), "creator-pool.csv")} className="text-blue-600 hover:underline">CSV</button>
              </div>
            </div>
            <div className="mt-3 max-h-72 overflow-y-auto">
              <table className="min-w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1"></th>
                    <th className="py-1">Username</th>
                    <th className="py-1">GMV Sel</th>
                    <th className="py-1">Order</th>
                    <th className="py-1">% Live</th>
                    <th className="py-1">ROAS Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {currentPool.rows.map((r) => (
                    <tr key={r.creatorId}>
                      <td className="py-1">
                        <input type="checkbox" checked={selected.has(r.creatorId)} onChange={() => toggleCreator(r.creatorId)} />
                      </td>
                      <td className="py-1">{r.username}</td>
                      <td className="py-1">{rupiah(r.gmvCell)}</td>
                      <td className="py-1">{r.orders}</td>
                      <td className="py-1">{r.liveShare != null ? `${(r.liveShare * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-1">{r.roasRef != null ? r.roasRef.toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                  {currentPool.rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-slate-400">Tidak ada kreator di segmen ini.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ---- Kolom kanan: Output ---- */}
      <div className="h-fit rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Output</h3>
        {!result || !segment ? (
          <p className="mt-3 text-sm text-slate-500">Pilih kategori & segmen untuk melihat proyeksi.</p>
        ) : (
          <div className="mt-3 space-y-4 text-sm">
            <p className="text-xs text-slate-500">
              {result.withHist} kreator punya histori real di kategori &ldquo;{category}&rdquo; segmen{" "}
              {SEGMENT_LABELS[segment]}, total GMV {rupiah(result.hist)} (window berjalan).
            </p>
            <div>
              <p className="text-xs uppercase text-slate-500">Potensi GMV (Likely)</p>
              <p className="text-xl font-semibold">{rupiah(result.likely)}</p>
              <p className="text-xs text-slate-500">
                Konservatif {rupiah(result.conservative)} – Optimis {rupiah(result.optimistic)}
              </p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full bg-slate-900"
                  style={{ width: `${result.optimistic > 0 ? Math.min(100, (result.likely / result.optimistic) * 100) : 0}%` }}
                />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Confidence</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full ${
                      result.confidenceLabel === "Rendah" ? "bg-red-400" : result.confidenceLabel === "Sedang" ? "bg-amber-400" : "bg-green-500"
                    }`}
                    style={{ width: `${result.confidence}%` }}
                  />
                </div>
                <span className="text-sm font-medium">
                  {result.confidence}% ({result.confidenceLabel})
                </span>
              </div>
            </div>
            {result.adUpside > 0 && (
              <p className="text-xs text-slate-500">
                Termasuk ads upside {rupiah(result.adUpside)} (ROAS {roas} × budget {rupiah(budget)}).
              </p>
            )}
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Simpan Skenario
            </button>
            {saveMsg && <p className="text-xs text-slate-500">{saveMsg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
