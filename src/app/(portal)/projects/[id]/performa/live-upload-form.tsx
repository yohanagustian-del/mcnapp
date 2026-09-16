"use client";

import { useRef, useState, useTransition } from "react";
import {
  previewLiveSessions, saveLiveSessions,
  type SaveLiveSessionsResult, type SessionGroupPreview,
} from "./live-actions";

export interface ParticipantOption {
  creatorId: string;
  name: string;
  username: string | null;
  level: number | null;
  sessionsRecorded: number;
}

const LEVEL_STYLES: Record<string, string> = {
  ok: "bg-green-100 text-green-800", warn: "bg-amber-100 text-amber-800", block: "bg-red-100 text-red-800",
};
const LEVEL_LABELS: Record<string, string> = { ok: "Hijau", warn: "Kuning", block: "Merah" };

/**
 * Upload sesi live — SELALU berkonteks satu kreator (R40): pilih peserta dulu,
 * baru drop file (bisa banyak sekaligus: beberapa sesi, beberapa hari). Dua
 * langkah: Pratinjau (cek V1–V7, tidak menulis apa pun) → Simpan Sesi (menulis
 * yang lolos; sesi merah tidak pernah tersimpan; sesi kuning butuh centang +
 * alasan lebih dulu — §10.2).
 */
export function LiveUploadForm({
  projectId, participants,
}: { projectId: number; participants: ParticipantOption[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creatorId, setCreatorId] = useState("");
  const [brand, setBrand] = useState("");
  const [preview, setPreview] = useState<SessionGroupPreview[] | null>(null);
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, { confirmed: boolean; reason: string }>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<SaveLiveSessionsResult | null>(null);
  const [pending, startTransition] = useTransition();

  function buildFormData(): FormData | null {
    const files = fileInputRef.current?.files;
    if (!creatorId) { setPreviewError("Pilih peserta dulu"); return null; }
    if (!files || files.length === 0) { setPreviewError("Pilih minimal satu file"); return null; }
    const fd = new FormData();
    fd.set("project_id", String(projectId));
    fd.set("creator_id", creatorId);
    for (const f of Array.from(files)) fd.append("files", f);
    return fd;
  }

  function onPreview() {
    setPreviewError(null);
    setSaveResult(null);
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      const res = await previewLiveSessions(fd);
      if (!res.ok) { setPreviewError(res.error); setPreview(null); return; }
      setPreview(res.sessions);
      setUnreadable(res.unreadableFiles);
      setConfirmations({});
    });
  }

  function onSave() {
    const fd = buildFormData();
    if (!fd) return;
    fd.set("brand", brand);
    fd.set("overrides", JSON.stringify(confirmations));
    startTransition(async () => {
      const res = await saveLiveSessions(fd);
      setSaveResult(res);
      if (res.ok) {
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  const savableCount = (preview ?? []).filter((s) => s.overallLevel !== "block").length;

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={creatorId} onChange={(e) => { setCreatorId(e.target.value); setPreview(null); }}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">— Pilih peserta —</option>
          {participants.map((p) => (
            <option key={p.creatorId} value={p.creatorId}>
              {p.name} (@{p.username}){p.level ? ` · Level ${p.level}` : ""} · {p.sessionsRecorded} sesi tercatat
            </option>
          ))}
        </select>
        <input
          value={brand} onChange={(e) => setBrand(e.target.value)}
          placeholder="Brand/produk sesi ini (opsional — informasi saja, bukan cek)"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          ref={fileInputRef} type="file" multiple accept=".xlsx"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
        />
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Drop file Product + Trend Stats sekaligus (bisa banyak sesi/hari). Nama file harus format
        `{"{username}"}_product_Sesi_{"{n}"}__{"{tanggal}"}.xlsx` (§9) — username di nama file harus cocok peserta terpilih.
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onPreview} disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
          {pending ? "Memproses…" : "Pratinjau"}
        </button>
        {preview && (
          <button type="button" onClick={onSave} disabled={pending || savableCount === 0}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50">
            Simpan Sesi ({savableCount})
          </button>
        )}
      </div>

      {previewError && <p className="mt-2 text-sm text-red-700">{previewError}</p>}

      {unreadable.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Nama file tidak terbaca (dilewati): {unreadable.join(", ")}
        </p>
      )}

      {saveResult && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          {saveResult.saved.length > 0 && (
            <p className="text-green-700">Tersimpan: {saveResult.saved.join(", ")}</p>
          )}
          {saveResult.skipped.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-red-700">
              {saveResult.skipped.map((s, i) => <li key={i}>{s.key}: {s.reason}</li>)}
            </ul>
          )}
          {saveResult.error && <p className="text-red-700">{saveResult.error}</p>}
        </div>
      )}

      {preview && preview.length > 0 && (
        <div className="mt-4 space-y-3">
          {preview.map((s) => (
            <div key={s.key} className="rounded-lg border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_STYLES[s.overallLevel]}`}>
                  {LEVEL_LABELS[s.overallLevel]}
                </span>
                <span className="text-sm font-medium">
                  @{s.username} · Sesi {s.sessionNo} · {s.date}
                </span>
                <span className="text-xs text-slate-500">
                  GMV Rp{Math.round(s.gmv ?? 0).toLocaleString("id-ID")}
                  {s.gmvTrend !== null ? ` (trend Rp${Math.round(s.gmvTrend).toLocaleString("id-ID")})` : ""}
                  {s.orders !== null ? ` · ${s.orders} order` : ""}
                  {s.startTime && s.endTime ? ` · ${s.startTime}–${s.endTime}` : ""}
                </span>
              </div>
              {s.blockedReason && <p className="mt-1 text-xs text-red-700">{s.blockedReason}</p>}
              <ul className="mt-2 space-y-0.5 text-xs">
                {s.checks.map((c) => (
                  <li key={c.code} className={
                    c.level === "block" ? "text-red-700" : c.level === "warn" ? "text-amber-700" : "text-slate-500"
                  }>
                    {c.code}: {c.message}
                  </li>
                ))}
              </ul>
              {s.overallLevel === "warn" && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2">
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={confirmations[s.key]?.confirmed ?? false}
                      onChange={(e) =>
                        setConfirmations((prev) => ({
                          ...prev, [s.key]: { confirmed: e.target.checked, reason: prev[s.key]?.reason ?? "" },
                        }))
                      }
                    />
                    Saya sudah cek, data ini milik peserta ini
                  </label>
                  <input
                    value={confirmations[s.key]?.reason ?? ""}
                    onChange={(e) =>
                      setConfirmations((prev) => ({
                        ...prev, [s.key]: { confirmed: prev[s.key]?.confirmed ?? false, reason: e.target.value },
                      }))
                    }
                    placeholder="Alasan (wajib untuk konfirmasi)"
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
