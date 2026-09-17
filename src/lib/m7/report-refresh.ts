/**
 * M7 v2 — menyegarkan ANGKA report peserta yang sudah ada.
 *
 * Temuan QA produksi 2026-09-17 (project #12/#13): `creator_reports.data_json`
 * adalah rekaman angka saat report dibuat, dan halaman report — tim maupun
 * portal kreator — selalu menampilkan baris `final` bila ada. Akibatnya sesi
 * yang diupload SESUDAH sebuah report difinalkan tidak pernah terlihat: tim
 * mengunggah data 16 September, halamannya tetap memperlihatkan angka 15
 * September, tanpa satu tanda pun bahwa yang dilihat sudah basi.
 *
 * Pemisahannya begini: `data_json` = ANGKA, dan angka harus selalu mengikuti
 * data terbaru. Finalisasi (R28) mengatur NARASI — sebelum final kreator lihat
 * angka tanpa narasi, sesudah final narasinya ikut — bukan membekukan angka
 * pada satu momen. Karena itu fungsi ini menulis ulang `data_json` di SEMUA
 * baris report yang ada (draft dan final) dan tidak pernah menyentuh
 * `insight_draft`/`insight_final`/`status`: tulisan tim tetap milik tim.
 *
 * Tidak pernah MEMBUAT report baru. Membuat report adalah aksi sadar tim
 * ("Generate Report Peserta"); fungsi ini hanya menjaga yang sudah terbit
 * supaya tidak membohongi pembacanya. 0 token (CLAUDE.md #1).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProjectReportData } from "./report-data";

export async function refreshCreatorReportData(
  supabase: SupabaseClient,
  projectId: number,
  creatorId: string
): Promise<number> {
  const { data: rows } = await supabase
    .from("creator_reports")
    .select("id")
    .eq("project_id", projectId).eq("creator_id", creatorId)
    .in("status", ["draft", "final"]);

  const reports = rows ?? [];
  if (reports.length === 0) return 0;

  const dataJson = await buildProjectReportData(supabase, projectId, creatorId);
  const generatedAt = new Date().toISOString();
  let refreshed = 0;
  for (const r of reports) {
    const { error } = await supabase
      .from("creator_reports")
      .update({ data_json: dataJson, generated_at: generatedAt })
      .eq("id", r.id);
    if (!error) refreshed++;
  }
  return refreshed;
}

/**
 * Versi tahan-gagal untuk dipanggil dari jalur upload: report yang gagal
 * disegarkan TIDAK boleh menggagalkan penyimpanan sesi yang sudah sah
 * (CLAUDE.md #7 — jangan crash). Kegagalannya cukup tidak mengubah apa pun;
 * tombol "Generate Report Peserta" tetap jadi jalan manualnya.
 */
export async function refreshCreatorReportDataSafe(
  supabase: SupabaseClient,
  projectId: number,
  creatorId: string
): Promise<number> {
  try {
    return await refreshCreatorReportData(supabase, projectId, creatorId);
  } catch {
    return 0;
  }
}
