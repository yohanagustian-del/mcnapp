import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCreator } from "@/lib/m9/creator-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** Tab Info (portal, PRD §3.7/PR-24) — pengumuman project + badge belum dibaca. */
export default async function PortalProjectInfoPage({
  params,
}: { params: Promise<{ projectId: string }> }) {
  const { projectId: projectIdRaw } = await params;
  const projectId = Number(projectIdRaw);
  if (!Number.isInteger(projectId)) notFound();

  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  const { data: participant } = await admin
    .from("project_participants").select("project_id")
    .eq("project_id", projectId).eq("creator_id", creatorId).maybeSingle();
  if (!participant) notFound();

  const { data: project } = await admin.from("special_projects").select("id, name").eq("id", projectId).maybeSingle();
  if (!project) notFound();

  const { data: announcements } = await admin
    .from("project_announcements")
    .select("id, title, body_md, pinned, published_at")
    .eq("project_id", projectId)
    .not("published_at", "is", null)
    .lte("published_at", new Date().toISOString())
    .order("pinned", { ascending: false })
    .order("published_at", { ascending: false });

  // Membuka halaman ini = sudah dibaca — tandai semua yang tampil (idempotent).
  if ((announcements ?? []).length > 0) {
    await admin.from("project_announcement_reads").upsert(
      (announcements ?? []).map((a) => ({ announcement_id: a.id, creator_id: creatorId })),
      { onConflict: "announcement_id,creator_id", ignoreDuplicates: true }
    );
  }

  return (
    <div>
      <Link href="/portal/projects" className="text-sm text-blue-700 hover:underline">← Kembali</Link>
      <h1 className="mt-2 text-xl font-semibold">Info — {project.name}</h1>
      <div className="mt-3 space-y-3">
        {(announcements ?? []).length === 0 && <p className="text-sm text-slate-500">Belum ada pengumuman.</p>}
        {(announcements ?? []).map((a) => (
          <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="font-medium">
              {a.pinned && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Pinned</span>}
              {a.title}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{a.body_md}</p>
            <p className="mt-2 text-xs text-slate-400">{new Date(a.published_at!).toLocaleString("id-ID")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
