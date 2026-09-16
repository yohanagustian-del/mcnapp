import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { publishAnnouncement, togglePinAnnouncement } from "./info-actions";

/** Tab Info Acara (tim) — PR-24: buat/publish pengumuman, maksimal 3 pinned (R17). */
export default async function ProjectInfoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = Number(id);
  if (!Number.isInteger(projectId)) notFound();

  const member = await requireMember();
  const canManage = hasPermission("m7.manage", member.role);

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("special_projects").select("id, name").eq("id", projectId).maybeSingle();
  if (!project) notFound();

  const { data: announcements } = await supabase
    .from("project_announcements")
    .select("id, title, body_md, pinned, published_at, created_at")
    .eq("project_id", projectId)
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Info Acara — {project.name}</h1>
        <Link href={`/projects/${projectId}`} className="text-sm text-blue-700 hover:underline">← Kembali</Link>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Pengumuman langsung terbit ke portal peserta. Maksimal 3 pengumuman di-pin sekaligus.
      </p>

      {canManage && (
        <form action={publishAnnouncement} className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <input type="hidden" name="project_id" value={project.id} />
          <input name="title" required placeholder="Judul pengumuman"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <textarea name="body_md" required rows={4} placeholder="Isi pengumuman"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" name="pinned" /> Pin pengumuman ini
          </label>
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Terbitkan
          </button>
        </form>
      )}

      <div className="mt-6 space-y-3">
        {(announcements ?? []).length === 0 && (
          <p className="text-sm text-slate-500">Belum ada pengumuman.</p>
        )}
        {(announcements ?? []).map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">
                {a.pinned && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pinned</span>}
                {a.title}
              </p>
              {canManage && (
                <form action={togglePinAnnouncement}>
                  <input type="hidden" name="announcement_id" value={a.id} />
                  <input type="hidden" name="project_id" value={project.id} />
                  <input type="hidden" name="next_pinned" value={(!a.pinned).toString()} />
                  <button type="submit" className="text-xs text-blue-700 hover:underline">
                    {a.pinned ? "Lepas pin" : "Pin"}
                  </button>
                </form>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{a.body_md}</p>
            <p className="mt-2 text-xs text-slate-400">
              {a.published_at ? `Terbit ${new Date(a.published_at).toLocaleString("id-ID")}` : "Draft"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
