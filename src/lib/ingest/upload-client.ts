"use client";

import { createClient } from "@/lib/supabase/client";
import {
  INGEST_BUCKET, INGEST_MAX_OBJECT_BYTES, INGEST_MAX_PARTS, INGEST_PART_BYTES, type IngestObjectRef,
} from "./bucket";

/**
 * Client-side direct-to-Storage upload for weekly platform files. The browser
 * pushes the WHOLE file straight to Supabase Storage (not through the Next.js
 * server action), so the ~4,5MB serverless body limit on Vercel no longer caps
 * how many rows can be uploaded — a ~61k-row export goes up in one piece. The
 * server action then only receives the returned {path, name} ref, downloads the
 * file server-side, and runs the existing aggregate pipeline.
 *
 * Objects are namespaced under the caller's uid folder (RLS in migration 0026
 * only lets an authenticated user write inside `${uid}/`). A random uuid per
 * upload avoids collisions between concurrent uploads / retries.
 *
 * CSVs are gzip-compressed in the browser first (native CompressionStream,
 * streamed — no full copy on the main thread): a Shopee Conversion Report
 * shrinks ~3x, so a 120-200MB export uploads as ~40-65MB — much faster on a
 * slow connection. downloadIngestFile inflates it
 * back by magic bytes; the ref keeps the ORIGINAL name. .xlsx/.zip are already
 * compressed and go up as-is.
 *
 * Anything over INGEST_PART_BYTES is uploaded as consecutive byte-range parts
 * (Supabase caps one upload at 50MB while the org spend cap is on); the ref
 * lists them in order and downloadIngestFile joins them. If a part fails, the
 * parts already uploaded are removed (best-effort) before the error surfaces.
 * `onProgress` receives an Indonesian status line for the form's button.
 */
export async function uploadIngestFile(
  file: File,
  kind: string,
  onProgress?: (stage: string) => void
): Promise<IngestObjectRef> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userError || !uid) {
    throw new Error("Sesi tidak valid — silakan muat ulang halaman dan login kembali.");
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const gzip = ext.toLowerCase() === ".csv" && typeof CompressionStream !== "undefined";
  if (gzip) onProgress?.("Mengompres file…");
  const body: Blob = gzip
    ? await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob()
    : file;
  const mb = (n: number) => Math.round(n / (1024 * 1024));
  const partCount = Math.max(1, Math.ceil(body.size / INGEST_PART_BYTES));
  if (body.size > INGEST_MAX_OBJECT_BYTES || partCount > INGEST_MAX_PARTS) {
    throw new Error(
      `File ${file.name} terlalu besar (${mb(body.size)} MB${gzip ? " setelah dikompres" : ""}; ` +
        `maksimum ${mb(INGEST_MAX_OBJECT_BYTES)} MB). Pecah export per rentang tanggal yang lebih pendek.`
    );
  }

  const base = `${uid}/${crypto.randomUUID()}-${kind}${ext}${gzip ? ".gz" : ""}`;
  const paths = partCount === 1
    ? [base]
    : Array.from({ length: partCount }, (_, i) => `${base}.part${String(i).padStart(3, "0")}`);
  const contentType = gzip ? "application/gzip" : file.type || "application/octet-stream";
  const bucket = supabase.storage.from(INGEST_BUCKET);

  for (const [i, path] of paths.entries()) {
    onProgress?.(
      partCount === 1
        ? "Mengunggah file ke storage…"
        : `Mengunggah bagian ${i + 1}/${partCount} ke storage…`
    );
    const chunk = body.slice(i * INGEST_PART_BYTES, (i + 1) * INGEST_PART_BYTES, contentType);
    const { error } = await bucket.upload(path, chunk, { upsert: false, contentType });
    if (error) {
      if (i > 0) await bucket.remove(paths.slice(0, i)).catch(() => undefined);
      throw new Error(`Gagal mengunggah file ${file.name} ke storage: ${error.message}`);
    }
  }

  return partCount === 1
    ? { path: base, name: file.name }
    : { path: paths[0], name: file.name, parts: paths };
}
