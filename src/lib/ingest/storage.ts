import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Transient bucket for large weekly platform uploads. The browser uploads the
 * WHOLE export file here directly (bypassing the Next.js/Vercel server-action
 * body limit), then a server action downloads it via the service-role client,
 * runs the existing parse → aggregate → drop-raw pipeline, and deletes the
 * object. Raw is never persisted (CLAUDE.md); the object is removed after
 * processing (or on failure). See supabase/migrations/0026_ingest_uploads_bucket.sql.
 */
export const INGEST_BUCKET = "ingest-uploads";

/** Max object path length we accept from the client (defensive; paths are `${uid}/${uuid}...`). */
const MAX_PATH_LEN = 512;

/**
 * A storage object reference handed from the client to a server action: the
 * bucket path plus the original filename (needed so parseSheet's extension
 * detection — .xlsx/.csv/.numbers — behaves exactly as for a FormData File).
 */
export interface IngestObjectRef {
  path: string;
  name: string;
}

/**
 * Validates an object ref that arrived from the (untrusted) client. The path
 * must be a non-empty, reasonably short string with no traversal; the name is
 * only used to reconstruct the File extension. Throws on anything suspicious so
 * a malformed/hostile ref can never reach `storage.download`.
 */
export function assertValidObjectRef(ref: unknown, label: string): asserts ref is IngestObjectRef {
  if (!ref || typeof ref !== "object") throw new Error(`Referensi file ${label} tidak valid.`);
  const { path, name } = ref as Record<string, unknown>;
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_LEN) {
    throw new Error(`Path file ${label} tidak valid.`);
  }
  if (path.includes("..") || path.startsWith("/")) {
    throw new Error(`Path file ${label} tidak valid.`);
  }
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`Nama file ${label} tidak valid.`);
  }
}

/**
 * Downloads an uploaded object from the ingest bucket and reconstructs a File
 * carrying the ORIGINAL filename, so downstream parsers (parseSheet) detect the
 * format from the extension identically to the old direct-FormData path.
 */
export async function downloadIngestFile(
  admin: SupabaseClient,
  ref: IngestObjectRef
): Promise<File> {
  const { data, error } = await admin.storage.from(INGEST_BUCKET).download(ref.path);
  if (error || !data) {
    throw new Error(
      `Gagal mengunduh file dari storage (${ref.name}): ${error?.message ?? "objek tidak ditemukan"}. ` +
        `Coba unggah ulang.`
    );
  }
  const bytes = new Uint8Array(await data.arrayBuffer());
  return new File([bytes], ref.name, { type: data.type || "application/octet-stream" });
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
