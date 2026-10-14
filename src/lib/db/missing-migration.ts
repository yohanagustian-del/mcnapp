/**
 * Deteksi "tabel/view/kolom belum ada" dari error Supabase, supaya halaman yang
 * bergantung pada migrasi baru gagal dengan pesan jelas — bukan crash — selama
 * migrasinya belum di-apply (pola generateReport M2 saat app_config belum ada).
 *
 * Kode yang dikenali:
 * - 42P01  undefined_table (Postgres, lewat rpc/sql)
 * - 42703  undefined_column
 * - PGRST205 PostgREST: "Could not find the table ... in the schema cache"
 * - PGRST204 PostgREST: kolom tidak ada di schema cache
 */
export interface SupabaseLikeError {
  code?: string | null;
  message?: string | null;
}

const MISSING_CODES = new Set(["42P01", "42703", "PGRST205", "PGRST204"]);

export function isMissingRelationError(error: SupabaseLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING_CODES.has(error.code)) return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("does not exist")) ||
    (msg.includes("column") && msg.includes("does not exist"))
  );
}

/** Pesan UI standar untuk fitur Revisi BizDev 2026-10 yang butuh migrasi 0087. */
export const MIGRATION_0087_MISSING =
  "Migrasi 0087 belum di-apply — fitur ini butuh tabel creator_shop_period_gmv / brand_bizdev_handlers / kolom Report Brand v2. Hubungi admin untuk menjalankan migrasinya.";

/** Pesan untuk GMV TAP tanpa nama kreator (K6) yang butuh migrasi 0088. */
export const MIGRATION_0088_MISSING =
  "Migrasi 0088 belum di-apply (tabel creator_shop_period_unattributed_tap). Hubungi admin untuk menjalankan migrasinya.";
