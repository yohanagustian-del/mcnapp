import { requireMember, hasPermission, ACQUISITION_ROLES } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { loadCreatorsWithoutCm } from "@/lib/creators/without-cm";
import { loadCmRequests } from "@/lib/creators/cm-requests";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { CreatorFilterProvider, CreatorFilterBar, type CmOption } from "@/components/creator-filter";
import { CreatorsWithoutCmAlert } from "@/components/creators-without-cm-alert";
import { uploadCreators } from "./actions";
import { CreatorsTable, type CreatorTableRow } from "./creators-table";
import { CreatorImportPanel } from "./creator-import-panel";
import { CreatorCreateDialog } from "./creator-create-dialog";
import { CmRequestsPanel } from "./cm-requests-panel";

export const dynamic = "force-dynamic";

/**
 * Raw creators row as selected below.
 *
 * `creators` punya DUA foreign key ke `team_members` (owner_cpm_id = CM,
 * acquisitor_id = Akuisitor), jadi setiap embed WAJIB menyebut nama constraint —
 * `team_members(name)` polos akan ditolak PostgREST sebagai relasi ambigu.
 */
type CreatorRow = Omit<CreatorTableRow, "cmName" | "acquisitorName"> & {
  segment: string | null;
  tim_akuisisi: string | null;
  target_gmv_monthly: number | null;
  team_members: { name?: string } | null;
  acquisitor: { name?: string } | null;
};

export default async function CreatorsPage() {
  const member = await requireMember();
  const canUpload = hasPermission("creators.bulk_upload", member.role);
  const canEdit = hasPermission("creators.edit", member.role);
  const canDelete = hasPermission("creators.delete", member.role);
  const canAssignCm = hasPermission("m8.assign_creator", member.role);
  const canDecideCmRequest = hasPermission("creators.decide_cm_request", member.role);
  // CPM: boleh mengajukan request, tidak boleh assign. Yang sudah boleh assign
  // memakai dropdown CM di modal Edit — tidak perlu (dan tidak boleh) dua jalur.
  const canRequestCm = hasPermission("creators.request_cm", member.role) && !canAssignCm;

  const supabase = await createClient();
  // Tabel dipaginasi di klien (10/20/50/100 per halaman), jadi daftar penuh
  // dimuat sekali — lewat fetchAll, karena satu halaman PostgREST hanya 1000
  // baris: dengan .limit(1000) kreator ke-1001 dan seterusnya tidak pernah
  // muncul di daftar (dan tampak "tidak ada di tabel kreator" saat dicari).
  const creators = await fetchAll<CreatorRow>(
    supabase,
    "creators",
    "id, name, username, profile_link, phone, uid, followers, content_quality, join_date, domisili, alamat, jenis_creator, creator_class, niche, top_niches, level, segment, gmv, gmv_live, gmv_video, platform, rc_live, rc_video, rate_card, commission_share, contract_end_date, status, tim_akuisisi, target_gmv_monthly, owner_cpm_id, acquisitor_id, team_members!creators_owner_cpm_id_fkey(name), acquisitor:team_members!creators_acquisitor_id_fkey(name)",
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
    creator_class: c.creator_class,
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
    acquisitor_id: c.acquisitor_id,
    acquisitorName: c.acquisitor?.name ?? null,
  }));

  // Kreator tanpa CM (mis. dibuat otomatis dari upload data platform mingguan).
  const withoutCm = await loadCreatorsWithoutCm();

  // Antrean request penugasan CM — approver melihat semuanya, CM melihat miliknya.
  const cmRequests =
    canDecideCmRequest || canRequestCm
      ? await loadCmRequests(member.id)
      : { pending: [], recent: [], myPendingCreatorIds: [], pendingCountByCreator: {} };

  // Pilihan CM untuk form "Tambah Kreator" DAN dropdown CM di modal Edit: SELURUH
  // CM aktif dari tabel Tim — bukan cmOptions di bawah (yang hanya berisi CM yang
  // sudah punya kreator, jadi CM baru tidak akan pernah bisa dipilih saat
  // mendaftarkan kreator pertamanya / memindah kreator ke CM baru).
  const { data: activeCms } = canUpload || canAssignCm
    ? await supabase
        .from("team_members")
        .select("id, name")
        .in("role", ["cm_lead", "cpm", "director", "head", "spv"])
        .eq("active", true)
        .order("name")
    : { data: [] as { id: string; name: string }[] };

  // Pilihan Akuisitor = anggota grup "acquisition" (role acquisition_spec /
  // acquisition_lead). Daftarnya dari tabel Tim, bukan teks bebas, supaya nama
  // akuisitor tidak lagi ditulis dengan ejaan berbeda-beda seperti di sheet lama.
  const { data: activeAcquisitors } = canUpload || canEdit
    ? await supabase
        .from("team_members")
        .select("id, name")
        .in("role", ACQUISITION_ROLES)
        .eq("active", true)
        .order("name")
    : { data: [] as { id: string; name: string }[] };
  const acquisitorOptions = (activeAcquisitors ?? []).map((m) => ({ id: m.id, name: m.name }));

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold">Kreator</h1>
          {canUpload && (
            <CreatorCreateDialog
              cms={(activeCms ?? []).map((m) => ({ id: m.id, name: m.name }))}
              acquisitors={acquisitorOptions}
            />
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Master data kreator (format sheet &quot;data creator&quot;). GMV total / live / video adalah
          RATA-RATA BULANAN — dihitung otomatis dari upload data platform mingguan di{" "}
          <a href="/ingest" className="underline">/ingest</a> (rata-rata dari seluruh bulan yang punya
          data, bukan total sekali batch). Sharing komisi sync dari platform (read-only) — turun =
          alert, bukan edit.
          {canEdit && (
            <>
              {" "}
              CM bisa mengedit SEMUA data master kreator (username, nama, no HP, link akun, UID,
              platform, jenis, kelas kreator, niche, followers, kualitas, level, RC live/video, rate
              card, join date, end date, domisili, alamat, status, akuisitor
              {canAssignCm && ", CM pemilik"}) lewat tombol <strong>Edit</strong> di setiap baris —
              setiap perubahan tercatat di audit log. Yang tidak bisa diedit hanya sharing komisi
              (sync platform) dan GMV (hasil hitung upload mingguan).
            </>
          )}
          {canDelete && (
            <>
              {" "}
              Hapus kreator (satu baris lewat tombol <strong>Hapus</strong>, atau banyak sekaligus
              dengan mencentang lalu <strong>Hapus terpilih</strong>) bersifat permanen. Kreator yang
              masih punya kontrak, report terkirim, komisi akuisisi/referral, request campaign, jadwal
              live, atau akun portal akan <strong>ditolak</strong> — set status{" "}
              <strong>nonaktif</strong> untuk kasus itu.
            </>
          )}
          {canRequestCm && (
            <>
              {" "}
              Anda tidak bisa menugaskan kreator ke diri sendiri — pakai tombol{" "}
              <strong>Request</strong> di baris kreator, atau <strong>centang beberapa sekaligus</strong>{" "}
              di kartu <strong>Kreator belum punya CM</strong> lalu klik Request. Pemindahan baru
              berlaku setelah disetujui CM Lead / Head, dan statusnya terlihat di panel{" "}
              <strong>Request penugasan CM</strong>.
            </>
          )}
        </p>

        <div className="mt-6">
          <CreatorsWithoutCmAlert
            total={withoutCm.total}
            rows={withoutCm.rows}
            cmOptions={withoutCm.cmOptions}
            canAssign={canAssignCm}
            canRequest={canRequestCm}
            requestedCreatorIds={cmRequests.myPendingCreatorIds}
            pendingRequestCountByCreator={cmRequests.pendingCountByCreator}
          />
        </div>

        {(canDecideCmRequest || canRequestCm) && (
          <div className="mt-6">
            <CmRequestsPanel
              pending={cmRequests.pending}
              recent={cmRequests.recent}
              canDecide={canDecideCmRequest}
              viewerId={member.id}
            />
          </div>
        )}

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
                helpText="Terima sheet 'data creator' asli (xlsx/csv, header Indonesia: Username, Nama Creator, No HP, UID, Followers, Join Date, End Date, Niche (kategori 2), RC Live, RC Video, dll) MAUPUN template Import Kreator hasil download (Username*, CM*, Akuisitor, …) — kolom CM & Akuisitor ikut terbaca (isi nama persis seperti di menu Tim; nama asing hanya diabaikan, baris tetap masuk). Username WAJIB (jadi kunci pencocokan): baris tanpa username dilewati, baris tanpa Nama Creator tetap masuk memakai username sebagai nama. Match by Username → update; belum ada → dibuat baru. GMV & sharing komisi TIDAK diambil dari sheet."
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
            canDelete={canDelete}
            canAssignCm={canAssignCm}
            cmOptions={(activeCms ?? []).map((m) => ({ id: m.id, name: m.name }))}
            acquisitorOptions={acquisitorOptions}
            canRequestCm={canRequestCm}
            viewerId={member.id}
            requestedCreatorIds={cmRequests.myPendingCreatorIds}
          />
        </div>
      </div>
    </CreatorFilterProvider>
  );
}
