/**
 * Client-safe constants for the transient ingest bucket (no Node imports here —
 * upload-client.ts runs in the browser). Server-side download/decompression
 * lives in storage.ts, which re-exports these.
 */
export const INGEST_BUCKET = "ingest-uploads";

/**
 * Max object size the bucket accepts — must match `file_size_limit` of
 * `ingest-uploads` (migration 0083). Technical storage limit, not a business
 * threshold, so it is not in app_config. CSVs are gzip-compressed in the browser
 * before upload (upload-client.ts), so this caps the COMPRESSED size: a Shopee
 * Conversion Report compresses ~3x, i.e. a ~200MB CSV uploads as ~65MB.
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
}
