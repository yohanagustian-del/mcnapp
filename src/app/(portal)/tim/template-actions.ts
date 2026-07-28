"use server";

import { requirePermission } from "@/lib/rbac";
import { buildTeamTemplate, TEAM_TEMPLATE_FILENAME } from "@/lib/tim/template";

/**
 * Generate template upload anggota tim (.xlsx). Dikembalikan sebagai base64
 * karena server action hanya boleh mengembalikan nilai serializable; klien
 * merakitnya kembali lewat downloadBase64File().
 */
export async function downloadTeamTemplate(): Promise<{ filename: string; base64: string }> {
  await requirePermission("team.bulk_upload");
  return {
    filename: TEAM_TEMPLATE_FILENAME,
    base64: Buffer.from(buildTeamTemplate()).toString("base64"),
  };
}
