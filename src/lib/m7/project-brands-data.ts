import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { isMissingRelationError } from "@/lib/db/missing-migration";

/** Target vs realisasi brand per project — realisasi dihitung dari baris, tidak disimpan. */
export interface ProjectBrandSummary {
  targetBrands: Map<number, number | null>;
  joinedBrands: Map<number, number>;
  /** true = migrasi 0091 belum di-apply; halaman tetap jalan tanpa kolom brand. */
  migrationMissing: boolean;
}

/**
 * Muat target & jumlah brand bergabung untuk sekumpulan project. Dipisah dari query
 * utama special_projects supaya daftar/detail project tidak ikut rusak selama
 * migrasi 0091 belum di-apply.
 */
export async function loadProjectBrandSummary(
  supabase: SupabaseClient,
  projectIds: number[]
): Promise<ProjectBrandSummary> {
  const summary: ProjectBrandSummary = { targetBrands: new Map(), joinedBrands: new Map(), migrationMissing: false };
  if (projectIds.length === 0) return summary;

  const { data: targets, error } = await supabase
    .from("special_projects").select("id, target_brands").in("id", projectIds);
  if (error) {
    if (isMissingRelationError(error)) return { ...summary, migrationMissing: true };
    throw new Error(`Gagal memuat target brand: ${error.message}`);
  }
  for (const t of targets ?? []) summary.targetBrands.set(t.id, t.target_brands);

  const rows = await fetchAll<{ project_id: number }>(supabase, "special_project_brands", "project_id", (q) =>
    q.in("project_id", projectIds)
  );
  for (const r of rows) summary.joinedBrands.set(r.project_id, (summary.joinedBrands.get(r.project_id) ?? 0) + 1);
  return summary;
}
