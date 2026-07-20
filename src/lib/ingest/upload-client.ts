"use client";

import { createClient } from "@/lib/supabase/client";
import { INGEST_BUCKET, type IngestObjectRef } from "./storage";

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
 */
export async function uploadIngestFile(file: File, kind: string): Promise<IngestObjectRef> {
  const supabase = createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (userError || !uid) {
    throw new Error("Sesi tidak valid — silakan muat ulang halaman dan login kembali.");
  }

  const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
  const path = `${uid}/${crypto.randomUUID()}-${kind}${ext}`;

  const { error } = await supabase.storage
    .from(INGEST_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) {
    throw new Error(`Gagal mengunggah file ${file.name} ke storage: ${error.message}`);
  }

  return { path, name: file.name };
}
