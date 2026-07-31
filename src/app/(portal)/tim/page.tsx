import { requireMember, hasPermission } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { ROLE_LABELS, TEAM_GROUP_LABELS, type TeamGroup } from "@/lib/tim/roles";
import type { Role } from "@/lib/rbac";
import { uploadTeamMembers } from "./actions";
import { DownloadTeamTemplateButton } from "./download-template-button";
import { AddMemberButton, EditMemberButton, DeleteMemberButton, type ManagedMember } from "./member-dialogs";
import { ProposalPanel, type ProposalRow } from "./proposal-panel";

export default async function TimPage() {
  const member = await requireMember();
  if (!hasPermission("team.bulk_upload", member.role)) redirect("/dashboard");

  // Tambah/edit/hapus = Director saja (m11.manage_accounts). Head/SPV tetap bisa
  // melihat direktori dan melakukan seed lewat bulk upload.
  const canManage = hasPermission("m11.manage_accounts", member.role);

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("team_members")
    .select("id, name, email, role, team_group, platform_segment, active")
    .order("active", { ascending: false })
    .order("name");

  const proposals = canManage
    ? (
        await supabase
          .from("member_change_requests")
          .select(
            "id, kind, target_label, payload, reason, status, requested_by_label, requested_at, decision_note"
          )
          .order("requested_at", { ascending: false })
          .limit(50)
      ).data
    : null;

  const rows = (members ?? []) as ManagedMember[];
  const allProposals = (proposals ?? []) as ProposalRow[];
  const pendingProposals = allProposals.filter((p) => p.status === "pending");
  const decidedProposals = allProposals.filter((p) => p.status !== "pending");

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tim</h1>
          <p className="mt-1 text-sm text-slate-500">
            {canManage
              ? "Direktori tim — tambah anggota, ganti jabatan, nonaktifkan, atau hapus permanen."
              : "Direktori tim — seed via bulk upload CSV. Perubahan jabatan & penghapusan dilakukan Director."}
          </p>
        </div>
        {canManage && <AddMemberButton />}
      </div>

      <div className="mt-6">
        <DownloadTeamTemplateButton />
        <p className="mt-2 text-xs text-slate-500">
          Unduh template dulu, isi datanya, lalu unggah lewat tombol di bawah. Header template sudah
          sesuai sistem — jangan diubah. Kolom wajib: <strong>name</strong>, <strong>email</strong>,{" "}
          <strong>role</strong>. Bulk upload untuk seed banyak orang sekaligus; untuk satu orang
          pakai tombol <strong>Tambah Anggota</strong> supaya password sementaranya langsung terbit.
        </p>
      </div>

      <div className="mt-4">
        <CsvUploadForm
          action={uploadTeamMembers}
          buttonLabel="Upload Anggota Tim"
          helpText="Kolom CSV: name, email, role (wajib); team_group & platform_segment opsional. team_group kosong akan diisi otomatis dari role (cpm/cm_lead→cm, director/head/spv→management, dst). Role: director|head|spv|cm_lead|cpm|bizdev_lead|bizdev|campaign_ops|bd_admin|ads_support|acquisition_lead|acquisition_spec|campaign_external|creator_support|finance|od_viewer. Catatan: 'cm' bukan role — pakai 'cpm' atau 'cm_lead'."
        />
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Jabatan</th>
              <th className="px-4 py-3">Divisi</th>
              <th className="px-4 py-3">Segmen</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3 text-right">Aksi</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => (
              <tr key={m.id} className={m.active ? "" : "bg-slate-50/60 text-slate-400"}>
                <td className="px-4 py-2 font-medium">{m.name}</td>
                <td className="px-4 py-2 text-slate-600">{m.email}</td>
                <td className="px-4 py-2">{ROLE_LABELS[m.role as Role] ?? m.role}</td>
                <td className="px-4 py-2">
                  {TEAM_GROUP_LABELS[m.team_group as TeamGroup] ?? m.team_group}
                </td>
                <td className="px-4 py-2">{m.platform_segment ?? "—"}</td>
                <td className="px-4 py-2">
                  {m.active ? (
                    "Aktif"
                  ) : (
                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600">
                      Nonaktif
                    </span>
                  )}
                </td>
                {canManage && (
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1.5">
                      <EditMemberButton member={m} />
                      {m.id !== member.id && <DeleteMemberButton member={m} />}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada anggota tim. Upload CSV untuk seed awal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && <ProposalPanel pending={pendingProposals} decided={decidedProposals} />}
    </div>
  );
}
