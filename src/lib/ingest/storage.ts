import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { unzipSync } from "fflate";
import {
  INGEST_BUCKET, INGEST_MAX_DECOMPRESSED_BYTES, INGEST_MAX_PARTS, ingestObjectPaths, type IngestObjectRef,
} from "./bucket";

export {
  INGEST_BUCKET, INGEST_MAX_OBJECT_BYTES, INGEST_MAX_DECOMPRESSED_BYTES, INGEST_PART_BYTES, INGEST_MAX_PARTS,
  ingestObjectPaths, type IngestObjectRef,
} from "./bucket";

/**
 * Transient bucket for large weekly platform uploads. The browser uploads the
 * WHOLE export file here directly (bypassing the Next.js/Vercel server-action
 * body limit), then a server action downloads it via the service-role client,
 * runs the existing parse → aggregate → drop-raw pipeline, and deletes the
 * object. Raw is never persisted (CLAUDE.md); the object is removed after
 * processing (or on failure). See supabase/migrations/0026_ingest_uploads_bucket.sql.
 */

/** Max object path length we accept from the client (defensive; paths are `${uid}/${uuid}...`). */
const MAX_PATH_LEN = 512;

function isValidPath(path: unknown): path is string {
  return (
    typeof path === "string" && path.length > 0 && path.length <= MAX_PATH_LEN &&
    !path.includes("..") && !path.startsWith("/")
  );
}

/**
 * Validates an object ref that arrived from the (untrusted) client. The path
 * must be a non-empty, reasonably short string with no traversal; the name is
 * only used to reconstruct the File extension; `parts` (split upload) must list
 * 1..INGEST_MAX_PARTS valid paths starting with `path`. Throws on anything suspicious so
 * a malformed/hostile ref can never reach `storage.download`.
 */
export function assertValidObjectRef(ref: unknown, label: string): asserts ref is IngestObjectRef {
  if (!ref || typeof ref !== "object") throw new Error(`Referensi file ${label} tidak valid.`);
  const { path, name, parts } = ref as Record<string, unknown>;
  if (!isValidPath(path)) throw new Error(`Path file ${label} tidak valid.`);
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Nama file ${label} tidak valid.`);
  }
  if (parts !== undefined) {
    if (
      !Array.isArray(parts) || parts.length < 1 || parts.length > INGEST_MAX_PARTS ||
      parts[0] !== path || !parts.every(isValidPath)
    ) {
      throw new Error(`Bagian file ${label} tidak valid.`);
    }
  }
}

const MB = 1024 * 1024;
const SHEET_EXT = /\.(csv|xlsx|xls|numbers)$/i;

function tooLarge(name: string): Error {
  return new Error(
    `File ${name} terlalu besar setelah diekstrak (maksimum ${Math.round(INGEST_MAX_DECOMPRESSED_BYTES / MB)} MB). ` +
      `Pecah export per rentang tanggal yang lebih pendek.`
  );
}

/**
 * Turns the stored object back into the file the user picked:
 * - gzip (magic 1f 8b) — upload-client.ts compresses every CSV before upload;
 *   detected by content, not by path, so a stray suffix can't fool it. Inflated
 *   STREAMING into 1MB parts: a 200MB export never exists as a whole compressed
 *   ArrayBuffer plus a concatenated copy, only as the parts the File is built from.
 * - .zip picked by the user — must contain exactly one .csv/.xlsx entry; the
 *   returned name is that entry's so parseSheet detects its format.
 * - anything else (xlsx, plain csv from an older client) — passed through.
 * Both inflate paths are capped at INGEST_MAX_DECOMPRESSED_BYTES.
 */
export async function unpackIngestObject(blob: Blob, name: string): Promise<{ parts: BlobPart[]; name: string }> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());

  if (head[0] === 0x1f && head[1] === 0x8b) {
    const parts: Buffer[] = [];
    let total = 0;
    try {
      await pipeline(
        Readable.fromWeb(blob.stream() as unknown as NodeWebReadableStream<Uint8Array>),
        createGunzip({ chunkSize: MB }),
        async function (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            total += chunk.length;
            if (total > INGEST_MAX_DECOMPRESSED_BYTES) throw tooLarge(name);
            parts.push(chunk);
          }
        }
      );
    } catch (e) {
      if (total > INGEST_MAX_DECOMPRESSED_BYTES) throw tooLarge(name);
      throw new Error(`File ${name} rusak saat diekstrak (gzip): ${e instanceof Error ? e.message : e}. Coba unggah ulang.`);
    }
    return { parts: parts as unknown as BlobPart[], name };
  }

  if (/\.zip$/i.test(name)) {
    let entries: Record<string, Uint8Array>;
    let tooBig = false;
    try {
      entries = unzipSync(new Uint8Array(await blob.arrayBuffer()), {
        filter: (f) => {
          const base = f.name.split("/").pop() ?? "";
          const wanted = SHEET_EXT.test(base) && !f.name.startsWith("__MACOSX/") && !base.startsWith(".");
          if (wanted && f.originalSize > INGEST_MAX_DECOMPRESSED_BYTES) tooBig = true;
          return wanted && !tooBig;
        },
      });
    } catch {
      throw new Error(`File ZIP ${name} tidak bisa dibuka (rusak atau terenkripsi).`);
    }
    if (tooBig) throw tooLarge(name);
    const keys = Object.keys(entries);
    if (keys.length !== 1) {
      throw new Error(
        keys.length === 0
          ? `File ZIP ${name} tidak berisi file .csv/.xlsx.`
          : `File ZIP ${name} berisi ${keys.length} file data (${keys.join(", ")}) — ZIP harus berisi tepat SATU file.`
      );
    }
    return { parts: [entries[keys[0]] as Uint8Array<ArrayBuffer>], name: keys[0].split("/").pop()! };
  }

  return { parts: [blob], name };
}

/**
 * Downloads an uploaded object from the ingest bucket and reconstructs a File
 * carrying the ORIGINAL filename (or the CSV/XLSX inside a .zip), decompressed,
 * so downstream parsers (parseSheet) detect the format from the extension
 * identically to the old direct-FormData path.
 */
export async function downloadIngestFile(
  admin: SupabaseClient,
  ref: IngestObjectRef
): Promise<File> {
  // A split upload (upload-client.ts) is joined back in order; Blob concatenation
  // doesn't copy, so this costs no more memory than one big object would.
  const blobs: Blob[] = [];
  for (const path of ingestObjectPaths(ref)) {
    const { data, error } = await admin.storage.from(INGEST_BUCKET).download(path);
    if (error || !data) {
      throw new Error(
        `Gagal mengunduh file dari storage (${ref.name}): ${error?.message ?? "objek tidak ditemukan"}. ` +
          `Coba unggah ulang.`
      );
    }
    blobs.push(data);
  }
  const data = blobs.length === 1 ? blobs[0] : new Blob(blobs, { type: blobs[0].type });
  const unpacked = await unpackIngestObject(data, ref.name);
  // Parsers pick the format from the name; the stored type is "application/gzip" for compressed CSVs.
  const type = /\.csv$/i.test(unpacked.name) ? "text/csv" : data.type || "application/octet-stream";
  return new File(unpacked.parts, unpacked.name, { type });
}

/**
 * Best-effort cleanup: removes the transient upload objects after processing
 * (success OR failure). Never throws — a leftover object is harmless (bucket is
 * private + transient) and must not mask the real ingest result/error.
 */
export async function removeIngestFiles(admin: SupabaseClient, paths: string[]): Promise<void> {
  const clean = paths.filter((p) => p && p.length > 0);
  if (clean.length === 0) return;
  try {
    await admin.storage.from(INGEST_BUCKET).remove(clean);
  } catch {
    // swallow — cleanup is best-effort.
  }
}
