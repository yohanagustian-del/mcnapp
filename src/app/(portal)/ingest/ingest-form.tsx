"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { RunIngestResult } from "@/lib/ingest/run";
import { uploadIngestFile } from "@/lib/ingest/upload-client";
import { LeakResultPanel } from "@/components/leak-result-panel";
import { runIngestFromStorageAction } from "./actions";

const FILE_ACCEPT =
  ".xlsx,.xls,.csv,.numbers,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.apple.numbers,text/csv";

/**
 * Single weekly upload form: MCN wajib, TAP opsional (disarankan) + Master Data Shop
 * opsional. Dengan TAP terunggah, pipeline sekaligus MENGHITUNG kebocoran link agency
 * di platform (fungsi artifak "Agency Leaked Generator" pindah ke dalam platform) —
 * jadi file mingguan cukup diupload sekali di sini. Master shop diambil dari tabel
 * cooperating_shops kecuali CM memilih mengunggah file master (untuk minggu di mana
 * master DB belum lengkap).
 */
export function IngestForm() {
  const [result, setResult] = useState<RunIngestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tapChosen, setTapChosen] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    const mcnFile = formData.get("mcn_file");
    if (!(mcnFile instanceof File) || mcnFile.size === 0) {
      setError("File MCN report (semua transaksi) wajib diunggah");
      return;
    }
    const tapRaw = formData.get("tap_file");
    const tapFile = tapRaw instanceof File && tapRaw.size > 0 ? tapRaw : null;
    const masterRaw = formData.get("master_file");
    const masterFile = masterRaw instanceof File && masterRaw.size > 0 ? masterRaw : null;

    startTransition(async () => {
      try {
        // 1. Upload whole file(s) straight to Storage (bypasses the serverless
        //    body limit so ~61k-row exports go up in one piece).
        setStage("Mengunggah file ke storage…");
        const mcnRef = await uploadIngestFile(mcnFile, "mcn");
        const tapRef = tapFile ? await uploadIngestFile(tapFile, "tap") : null;
        const masterRef = masterFile ? await uploadIngestFile(masterFile, "master") : null;

        // 2. Server downloads + processes the file WHOLE (no splitting → no
        //    replace-loss) then removes the transient objects.
        setStage("Memproses agregat + analisa kebocoran di server…");
        const res = await runIngestFromStorageAction(mcnRef, tapRef, masterRef);
        if (res.ok) {
          setResult(res.result);
        } else {
          setError(res.error);
        }
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
            File TAP report (via agency link) — opsional, disarankan
          </label>
          <input
            type="file" name="tap_file" accept={FILE_ACCEPT}
            onChange={(e) => setTapChosen((e.target.files?.length ?? 0) > 0)}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          {!tapChosen && (
            <p className="mt-1 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              ⚠ Tanpa file TAP, analisa KEBOCORAN LINK tidak dihitung (semua GMV di shop ber-deal akan
              terlihat 100% bocor) dan katalog produk (products_tap) tidak ter-update. Upload TAP
              periode yang sama.
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            File Master Data Shop — opsional (untuk analisa kebocoran)
          </label>
          <input
            type="file" name="master_file" accept={FILE_ACCEPT}
            className="mt-1 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm"
          />
          <p className="mt-1 rounded-md bg-slate-50 p-2 text-xs text-slate-500">
            Dibiarkan kosong → daftar shop ber-deal diambil dari database (tabel master shop
            platform). Upload file (wajib ada kolom &quot;Shop ID&quot;) bila master di database belum
            lengkap — file hanya dipakai untuk perhitungan minggu ini, tabel master di DB tidak diubah.
          </p>
        </div>
        <button
          type="submit" disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? (stage ?? "Memproses...") : "Proses Upload Mingguan"}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        File diunggah UTUH langsung ke storage lebih dulu (tidak lewat batas ukuran server), jadi
        file export besar sampai puluhan ribu baris bisa diunggah sekaligus — tidak perlu dipecah.
        Pipeline deterministik (0 token AI): parse → tabel agregat performa → raw dibuang (tidak
        pernah disimpan ke DB). Periode terdeteksi otomatis dari kolom Date. Idempotent per periode —
        upload ulang menimpa hasil lama. Bila file TAP diunggah, analisa KEBOCORAN LINK AGENCY ikut
        dihitung di sini (rollup masuk ke Link Leakage &amp; CM Workspace otomatis, plus backup CSV) —
        tidak perlu lagi menjalankan artifak eksternal.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-900">
          <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900">
            <p className="font-medium">✅ Upload berhasil! Data bisa langsung dicek di:</p>
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs">
              <li>
                <Link href="/reports" className="font-medium underline">
                  Report Kreator
                </Link>{" "}
                — ringkasan performa & GMV per kreator periode ini
              </li>
              <li>
                <Link href="/link-leakage" className="font-medium underline">
                  Link Leakage
                </Link>{" "}
                dan{" "}
                <Link href="/workspace/cm" className="font-medium underline">
                  CM Workspace
                </Link>{" "}
                — analisa kebocoran link agency (bila file TAP disertakan)
              </li>
              <li>
                <Link href="/products" className="font-medium underline">
                  Produk TAP
                </Link>{" "}
                — katalog produk hasil upload TAP
              </li>
            </ul>
          </div>
          <p className="font-medium">
            Batch {result.batchId} selesai — periode {result.periodStart} s/d {result.periodEnd}.
          </p>
          <ul className="mt-2 list-inside list-disc text-xs">
            <li>
              {result.rowsProcessedMcn} baris MCN + {result.rowsProcessedTap} baris TAP diproses ·{" "}
              {result.creatorsCount} creator
            </li>
            <li>
              Agregat tersimpan: {result.aggregateRows.periodSummary} ringkasan periode ·{" "}
              {result.aggregateRows.subcatSegment} subkategori×segmen ·{" "}
              {result.aggregateRows.topProducts} top produk
            </li>
            <li>
              Raw transaksi tidak disimpan ke DB — hanya agregat performa yang ditulis.
            </li>
          </ul>
          {result.createdProspects.length > 0 && (
            <p className="mt-2 text-xs">
              Creator baru dibuat otomatis: {result.createdProspects.join(", ")}
            </p>
          )}
          {result.leakSkipped && (
            <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">{result.leakSkipped}</p>
          )}
          {result.leakError && (
            <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">
              Agregat performa TERSIMPAN, tapi analisa kebocoran gagal: {result.leakError} — jalankan
              ulang analisa dari halaman Link Leakage.
            </p>
          )}
          {result.skipped.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-amber-700">
                {result.skipped.length} baris dilewati / catatan
              </summary>
              <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                {result.skipped.slice(0, 50).map((s, i) => (
                  <li key={i}>
                    {s.row > 0 ? `Baris ${s.row}: ` : ""}
                    {s.reason}
                  </li>
                ))}
                {result.skipped.length > 50 && <li>… {result.skipped.length - 50} lainnya</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {result?.leak && <LeakResultPanel result={result.leak} />}
    </div>
  );
}
