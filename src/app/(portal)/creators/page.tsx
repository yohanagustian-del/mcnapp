import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadCreators } from "./actions";
import { CreatorsTable } from "./creators-table";

export const dynamic = "force-dynamic";

export default async function CreatorsPage() {
  const member = await requireMember();
  const canUpload = hasPermission("creators.bulk_upload", member.role);
  const canEdit = hasPermission("creators.edit", member.role);

  const supabase = await createClient();
  const { data: creators } = await supabase
    .from("creators")
    .select(
      "id, name, username, profile_link, phone, uid, followers, content_quality, join_date, domisili, jenis_creator, niche, top_niches, level, segment, gmv, gmv_live, gmv_video, platform, rc_live, rc_video, rate_card, commission_share, contract_end_date, status, tim_akuisisi, target_gmv_monthly, team_members(name)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const creatorsData = creators ?? [];
  const expiringSoon = creatorsData.filter((c) => {
    if (!c.contract_end_date) return false;
    const days = Math.ceil((new Date(c.contract_end_date).getTime() - Date.now()) / 86_400_000);
    return days >= 0 && days <= 30;
  }).length;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Kreator</h1>
      <p className="mt-1 text-sm text-slate-500">
        Master data kreator (format sheet &quot;data creator&quot;). GMV total / live / video adalah
        RATA-RATA BULANAN — dihitung otomatis dari upload data platform mingguan di{" "}
        <a href="/ingest" className="underline">/ingest</a> (rata-rata dari seluruh bulan yang punya
        data, bukan total sekali batch). Sharing komisi sync dari platform (read-only) — turun =
        alert, bukan edit.
        {canEdit && (
          <>
            {" "}
            CM bisa mengedit data kreator (username, no HP, RC, rate card, level, domisili, UID,
            status) lewat tombol <strong>Edit</strong> di setiap baris — setiap perubahan tercatat di
            audit log.
          </>
        )}
      </p>

      {canUpload && (
        <div className="mt-6">
          <CsvUploadForm
            action={uploadCreators}
            buttonLabel="Upload Master Data Creator"
            helpText="Terima sheet 'data creator' asli (xlsx/csv, header Indonesia: Username, Nama Creator, No HP, UID, Followers, Join Date, Niche (kategori 2), RC Live, RC Video, dll). Match by Username → update; belum ada → dibuat baru. GMV & sharing komisi TIDAK diambil dari sheet."
          />
        </div>
      )}

      <CreatorsTable
        creators={creatorsData}
        expiringSoon={expiringSoon}
        canEdit={canEdit}
        canUpload={canUpload}
      />
    </div>
  );
}
