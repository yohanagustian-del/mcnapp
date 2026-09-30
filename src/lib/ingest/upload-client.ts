"use client";

import { createClient } from "@/lib/supabase/client";
import { INGEST_BUCKET, INGEST_MAX_OBJECT_BYTES, type IngestObjectRef } from "./bucket";

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
 * shrinks ~3x, so a 120-200MB export uploads as ~40-65MB, well under the bucket
 * limit and much faster on a slow connection. downloadIngestFile inflates it
 * back by magic bytes; the ref keeps the ORIGINAL name. .xlsx/.zip are already
 * compressed and go up as-is.
 */
export async function uploadIngestFile(file: File, kind: string): Promise<IngestObjectRef> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userError || !uid) {
    throw new Error("Sesi tidak valid — silakan muat ulang halaman dan login kembali.");
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const gzip = ext.toLowerCase() === ".csv" && typeof CompressionStream !== "undefined";
  const body: Blob = gzip
    ? await new Response(file.stream().pipeThrough(new CompressionStream("gzip"))).blob()
    : file;
  if (body.size > INGEST_MAX_OBJECT_BYTES) {
    const mb = (n: number) => Math.round(n / (1024 * 1024));
    throw new Error(
      `File ${file.name} terlalu besar (${mb(body.size)} MB${gzip ? " setelah dikompres" : ""}; ` +
        `maksimum ${mb(INGEST_MAX_OBJECT_BYTES)} MB). Pecah export per rentang tanggal yang lebih pendek.`
    );
  }
  const path = `${uid}/${crypto.randomUUID()}-${kind}${ext}${gzip ? ".gz" : ""}`;

  const { error } = await supabase.storage
    .from(INGEST_BUCKET)
    .upload(path, body, {
      upsert: false,
      contentType: gzip ? "application/gzip" : file.type || "application/octet-stream",
    });
  if (error) {
    throw new Error(`Gagal mengunggah file ${file.name} ke storage: ${error.message}`);
  }

  return { path, name: file.name };
}
