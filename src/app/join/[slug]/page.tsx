import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { JoinForm } from "./join-form";

/** Public signup page (PRD §3.5, no auth) — `/join/{slug}`, listed in middleware.ts as public. */
export default async function PublicJoinPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const { data: project } = await admin
    .from("special_projects")
    .select("id, name, type, start_date, end_date, status, open_for_signup, signup_deadline, join_requirements")
    .eq("slug", slug)
    .maybeSingle();
  if (!project) notFound();

  const isOpen =
    project.open_for_signup &&
    ["planning", "aktif"].includes(project.status) &&
    (!project.signup_deadline || new Date(project.signup_deadline) > new Date());

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <p className="text-xs uppercase text-slate-400">MCN MEA · Special Project</p>
      <h1 className="mt-1 text-2xl font-semibold">{project.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {project.type} · {project.start_date} → {project.end_date}
      </p>

      <div className="mt-6">
        {isOpen ? (
          <JoinForm slug={slug} joinRequirements={project.join_requirements} />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            Pendaftaran untuk project ini belum/tidak dibuka.
          </div>
        )}
      </div>
    </div>
  );
}
