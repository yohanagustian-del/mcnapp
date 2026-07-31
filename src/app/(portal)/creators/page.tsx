import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { loadCreatorsWithoutCm } from "@/lib/creators/without-cm";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { CreatorFilterProvider, CreatorFilterBar, type CmOption } from "@/components/creator-filter";
import { CreatorsWithoutCmAlert } from "@/components/creators-without-cm-alert";
import { uploadCreators } from "./actions";
import { CreatorsTable, type CreatorTableRow } from "./creators-table";
import { CreatorImportPanel } from "./creator-import-panel";

export const dynamic = "force-dynamic";

/** Raw creators row as selected below (team_members join = CM name). */
type CreatorRow = Omit<CreatorTableRow, "cmName"> & {
  segment: string | null;
  tim_akuisisi: string | null;
  target_gmv_monthly: number | null;
  team_members: { name?: string } | null;
};

export default async function CreatorsPage() {
  const member = await requireMember();
  const canUpload = hasPermission("creators.bulk_upload", member.role);
  const canEdit = hasPermission("creators.edit", member.role);
  const canAssignCm = hasPermission("m8.assign_creator", member.role);

  const supabase = await createClient();
  // Tabel dipaginasi di klien (10/20/50/100 per halaman), jadi daftar penuh
  // dimuat sekali — lewat fetchAll, karena satu halaman PostgREST hanya 1000
  // baris: dengan .limit(1000) kreator ke-1001 dan seterusnya tidak pernah
  // muncul di daftar (dan tampak "tidak ada di tabel kreator" saat dicari).
  const creators = await fetchAll<CreatorRow>(
    supabase,
    "creators",
    "id, name, username, profile_link, phone, uid, followers, content_quality, join_date, domisili, alamat, jenis_creator, niche, top_niches, level, segment, gmv, gmv_live, gmv_video, platform, rc_live, rc_video, rate_card, commission_share, contract_end_date, status, tim_akuisisi, target_gmv_monthly, owner_cpm_id, team_members(name)",
    (q) => q.order("created_at", { ascending: false })
  );

  const rows: CreatorTableRow[] = creators.map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    profile_link: c.profile_link,
    phone: c.phone,
    uid: c.uid,
    followers: c.followers,
    content_quality: c.content_quality,
    join_date: c.join_date,
    domisili: c.domisili,
    alamat: c.alamat,
    jenis_creator: c.jenis_creator,
    niche: c.niche,
    top_niches: c.top_niches as string[] | null,
    level: c.level,
    gmv: c.gmv,
    gmv_live: c.gmv_live,
    gmv_video: c.gmv_video,
    platform: c.platform,
    rc_live: c.rc_live,
    rc_video: c.rc_video,
    rate_card: c.rate_card,
    commission_share: c.commission_share,
    contract_end_date: c.contract_end_date,
    status: c.status,
    owner_cpm_id: c.owner_cpm_id,
    cmName: c.team_members?.name ?? null,
  }));

  // Kreator tanpa CM (mis. dibuat otomatis dari upload data platform mingguan).
  const withoutCm = await loadCreatorsWithoutCm();

  // CM options for the multi-select — derived from the creators actually listed (the
  // team_members join already resolves owner_cpm_id → CM name), so the dropdown never
  // offers a CM with zero creators in view.
  const cmOptionNameById = new Map<string, string>();
  for (const r of rows) {
    if (r.owner_cpm_id) cmOptionNameById.set(r.owner_cpm_id, r.cmName ?? "—");
  }
  const cmOptions: CmOption[] = [...cmOptionNameById]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id"));

  return (
    <CreatorFilterProvider cms={cmOptions} searchLabel="username kreator">
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

        <div className="mt-6">
          <CreatorsWithoutCmAlert
            total={withoutCm.total}
            rows={withoutCm.rows}
            cmOptions={withoutCm.cmOptions}
            canAssign={canAssignCm}
          />
        </div>

        {canUpload && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">Import Kreator (Username + CM)</h2>
            <div className="mt-2">
              <CreatorImportPanel />
            </div>
          </div>
        )}

        {canUpload && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">Upload Master Data Creator (sheet lengkap)</h2>
            <div className="mt-2">
              <CsvUploadForm
                action={uploadCreators}
                buttonLabel="Upload Master Data Creator"
                helpText="Terima sheet 'data creator' asli (xlsx/csv, header Indonesia: Username, Nama Creator, No HP, UID, Followers, Join Date, Niche (kategori 2), RC Live, RC Video, dll). Match by Username → update; belum ada → dibuat baru. GMV & sharing komisi TIDAK diambil dari sheet."
              />
            </div>
          </div>
        )}

        <div className="mt-6">
          <CreatorFilterBar />
        </div>

        <div className="mt-4">
          <CreatorsTable
            rows={rows}
            nowMs={Date.now()}
            canUpload={canUpload}
            canEdit={canEdit}
          />
        </div>
      </div>
    </CreatorFilterProvider>
  );
}
