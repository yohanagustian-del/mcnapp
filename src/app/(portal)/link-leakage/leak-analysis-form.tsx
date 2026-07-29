"use client";

import { useState, useTransition } from "react";
import { uploadIngestFile } from "@/lib/ingest/upload-client";
import { LeakResultPanel } from "@/components/leak-result-panel";
import type { LeakAnalysisResult } from "@/lib/m4/leak-analysis";
import { runLeakAnalysisFromStorageAction } from "./actions";

const FILE_ACCEPT =
  ".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers,text/csv";

type MasterMode = "db" | "file";

/**
 * Analisa kebocoran link agency DI PLATFORM (menggantikan artifak HTML eksternal).
 * Input sama seperti artifak: file MCN + file TAP + (opsional) Master Data Shop —
 * bedanya master bisa diambil dari database platform, dan hasilnya langsung mengisi
 * rollup Link Leakage + CM Workspace (tidak ada langkah download/upload Excel lagi).
 *
 * File diunggah UTUH ke Storage lebih dulu (bypass batas body serverless), lalu
 * server menjalankan pipeline deterministik (0 token AI) dan menghapus objeknya.
 */
export function LeakAnalysisForm() {
  const [result, setResult] = useState<LeakAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [masterMode, setMasterMode] = useState<MasterMode>("db");
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);

    const mcnRaw = formData.get("mcn_file");
    const tapRaw = formData.get("tap_file");
    if (!(mcnRaw instanceof File) || mcnRaw.size === 0) {
      setError("File MCN report (semua transaksi) wajib diunggah.");
      return;
    }
    if (!(tapRaw instanceof File) || tapRaw.size === 0) {
      setError(
        "File TAP (via agency link) wajib untuk analisa kebocoran — tanpa TAP semua GMV di shop " +
          "ber-deal akan terlihat 100% bocor."
      );
      return;
    }
    const masterRaw = formData.get("master_file");
    const masterFile =
      masterMode === "file" && masterRaw instanceof File && masterRaw.size > 0 ? masterRaw : null;
    if (masterMode === "file" && !masterFile) {
      setError("Mode master dari file dipilih, tapi file Master Data Shop belum diunggah.");
      return;
    }

    startTransition(async () => {
      try {
        setStage("Mengunggah file ke storage…");
        const mcnRef = await uploadIngestFile(mcnRaw, "leak-mcn");
        const tapRef = await uploadIngestFile(tapRaw, "leak-tap");
        const masterRef = masterFile ? await uploadIngestFile(masterFile, "leak-master") : null;

        setStage("Menghitung kebocoran di server…");
        const res = await runLeakAnalysisFromStorageAction(mcnRef, tapRef, masterRef);
        if (res.ok) setResult(res.result);
        else setError(res.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga saat mengunggah.");
      } finally {
        setStage(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <form action={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File MCN TikTok report (semua transaksi) — wajib
          </label>
          <input
            type="file" name="mcn_file" required accept={FILE_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File TAP report (via agency link) — wajib
          </label>
          <input
            type="file" name="tap_file" required accept={FILE_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
        </div>

        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
            Sumber daftar shop ber-deal
          </legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio" name="master_mode" value="db" checked={masterMode === "db"}
              onChange={() => setMasterMode("db")} className="mt-1"
            />
            <span>
              <span className="font-medium text-slate-700">Dari database platform</span>
              <span className="block text-xs text-slate-500">
                Pakai tabel master shop platform (cooperating_shops). Kelebihan: deal yang sudah
                kadaluarsa (deal_end lewat) otomatis jadi peluang BD + alert.
              </span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="radio" name="master_mode" value="file" checked={masterMode === "file"}
              onChange={() => setMasterMode("file")} className="mt-1"
            />
            <span>
              <span className="font-medium text-slate-700">Upload file Master Data Shop</span>
              <span className="block text-xs text-slate-500">
                Seperti artifak lama (kolom wajib &quot;Shop ID&quot;). Dipakai kalau master di
                database belum lengkap — file hanya untuk perhitungan minggu ini, tabel master di DB
                tidak diubah.
              </span>
            </span>
          </label>
          {masterMode === "file" && (
            <input
              type="file" name="master_file" accept={FILE_ACCEPT}
              className="mt-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
            />
          )}
        </fieldset>

        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? (stage ?? "Memproses...") : "Jalankan Analisa Kebocoran"}
        </button>
      </form>

      <p className="mt-2 text-xs text-slate-500">
        Deterministik, 0 token AI: parse file platform → validasi periode W1-W5 → join per
        (product_id, shop_id) → hitung bocor / peluang BD / status link pakai ambang app_config →
        simpan ROLLUP per kreator per minggu + lead BizDev + alert. Detail produk tidak disimpan di
        database, tapi diekspor sebagai backup CSV. Upload ulang minggu yang sama akan menimpa
        rollup kreator di file tersebut (kreator CM lain di minggu yang sama tidak tersentuh).
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {result && <LeakResultPanel result={result} />}
    </div>
  );
}
