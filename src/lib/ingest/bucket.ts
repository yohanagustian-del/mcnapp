/**
 * Client-safe constants for the transient ingest bucket (no Node imports here —
 * upload-client.ts runs in the browser). Server-side download/decompression
 * lives in storage.ts, which re-exports these.
 */
export const INGEST_BUCKET = "ingest-uploads";

/**
 * Size of each uploaded part. Supabase caps a single upload at 50MB while the
 * org spend cap is on (whatever the global/bucket limit says), so anything
 * bigger is split client-side into parts of at most this size and joined back
 * on the server (downloadIngestFile). Technical storage limit, not a business
 * threshold, so it is not in app_config.
 */
export const INGEST_PART_BYTES = 45 * 1024 * 1024;

/** Max parts per upload — bounds the ref the server accepts from the client. */
export const INGEST_MAX_PARTS = 10;

/**
 * Max total uploaded (i.e. COMPRESSED) size. CSVs are gzip-compressed in the
 * browser before upload (upload-client.ts); a Shopee Conversion Report
 * compresses ~3x, so a ~200MB CSV uploads as ~61MB in two parts.
 */
export const INGEST_MAX_OBJECT_BYTES = 200 * 1024 * 1024;

/**
 * Max DECOMPRESSED size the server will inflate (guards against zip bombs and
 * serverless OOM). Sized for a 200MB Shopee export with headroom; the streaming
 * Shopee parser peaks well under the function memory at this size.
 */
export const INGEST_MAX_DECOMPRESSED_BYTES = 400 * 1024 * 1024;

/**
 * A storage object reference handed from the client to a server action: the
 * bucket path plus the original filename (needed so parseSheet's extension
 * detection — .xlsx/.csv/.numbers — behaves exactly as for a FormData File).
 */
export interface IngestObjectRef {
  path: string;
  name: string;
  /**
   * Present only for a split upload: the ordered object paths whose bytes,
   * concatenated, form the file (`parts[0] === path`).
   */
  parts?: string[];
}

/** Every storage object behind a ref — what cleanup must remove. */
export function ingestObjectPaths(ref: IngestObjectRef): string[] {
  return ref.parts && ref.parts.length > 0 ? ref.parts : [ref.path];
}
