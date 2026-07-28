import { requireMember, hasPermission } from "@/lib/rbac";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CsvUploadForm } from "@/components/csv-upload-form";
import { uploadTeamMembers } from "./actions";
import { DownloadTeamTemplateButton } from "./download-template-button";

export default async function TimPage() {
  const member = await requireMember();
  if (!hasPermission("team.bulk_upload", member.role)) redirect("/dashboard");

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("team_members")
    .select("id, name, email, role, team_group, platform_segment, active")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-semibold">Tim</h1>
      <p className="mt-1 text-sm text-slate-500">
        Team Directory — seed via bulk upload CSV, lalu kelola manual.
      </p>

      <div className="mt-6">
        <DownloadTeamTemplateButton />
        <p className="mt-2 text-xs text-slate-500">
          Unduh template dulu, isi datanya, lalu unggah lewat tombol di bawah. Header template sudah
          sesuai sistem — jangan diubah. Kolom wajib: <strong>name</strong>, <strong>email</strong>,{" "}
          <strong>role</strong>.
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
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Grup</th>
              <th className="px-4 py-3">Segmen</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(members ?? []).map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 font-medium">{m.name}</td>
                <td className="px-4 py-2 text-slate-600">{m.email}</td>
                <td className="px-4 py-2">{m.role}</td>
                <td className="px-4 py-2">{m.team_group}</td>
                <td className="px-4 py-2">{m.platform_segment ?? "—"}</td>
                <td className="px-4 py-2">{m.active ? "Aktif" : "Nonaktif"}</td>
              </tr>
            ))}
            {(members ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Belum ada anggota tim. Upload CSV untuk seed awal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
