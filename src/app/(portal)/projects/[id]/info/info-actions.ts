"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";

/** Max simultaneously-pinned announcements per project (R17, LOCKED — not app_config: a
 * UI/UX cap on the portal's "Info" tab layout, not a business threshold). */
const MAX_PINNED = 3;

/** Info acara (PRD §3.6/PR-24) — buat + publish sekaligus (draft-only creation isn't
 * in the PRD's flow: a team member composes and publishes in one step). */
export async function publishAnnouncement(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const projectId = Number(formData.get("project_id"));
  const title = String(formData.get("title") ?? "").trim();
  const bodyMd = String(formData.get("body_md") ?? "").trim();
  const pinned = formData.get("pinned") === "on";
  if (!projectId) throw new Error("Project tidak valid");
  if (!title || !bodyMd) throw new Error("Judul dan isi pengumuman wajib diisi");

  const admin = createAdminClient();
  if (pinned) {
    const { count } = await admin
      .from("project_announcements")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId).eq("pinned", true);
    if ((count ?? 0) >= MAX_PINNED) {
      throw new Error(`Maksimal ${MAX_PINNED} pengumuman yang bisa di-pin — lepas pin salah satu dulu`);
    }
  }

  const { data: inserted, error } = await admin
    .from("project_announcements")
    .insert({
      project_id: projectId, title, body_md: bodyMd, pinned,
      published_at: new Date().toISOString(), created_by: actor.id,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Gagal membuat pengumuman: ${error.message}`);

  await writeAudit({
    actorId: actor.id, action: "m7.announcement_publish", entityType: "project_announcements",
    entityId: String(inserted.id), after: { project_id: projectId, title, pinned }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}/info`);
}

export async function togglePinAnnouncement(formData: FormData): Promise<void> {
  const actor = await requirePermission("m7.manage");
  const announcementId = Number(formData.get("announcement_id"));
  const projectId = Number(formData.get("project_id"));
  const nextPinned = formData.get("next_pinned") === "true";
  if (!announcementId || !projectId) throw new Error("Pengumuman tidak valid");

  const admin = createAdminClient();
  if (nextPinned) {
    const { count } = await admin
      .from("project_announcements")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId).eq("pinned", true);
    if ((count ?? 0) >= MAX_PINNED) {
      throw new Error(`Maksimal ${MAX_PINNED} pengumuman yang bisa di-pin — lepas pin salah satu dulu`);
    }
  }

  const { error } = await admin
    .from("project_announcements")
    .update({ pinned: nextPinned, updated_at: new Date().toISOString() })
    .eq("id", announcementId);
  if (error) throw new Error(error.message);

  await writeAudit({
    actorId: actor.id, action: "m7.announcement_publish", entityType: "project_announcements",
    entityId: String(announcementId), after: { pinned: nextPinned }, type: "auto",
  });
  revalidatePath(`/projects/${projectId}/info`);
}
