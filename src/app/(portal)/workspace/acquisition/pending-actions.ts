"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { insertCreatorWithGeneratedId } from "@/lib/creators/registry";

/**
 * Daftar Tunggu Kreator (migration 0028) — approve/tolak username yang muncul di
 * file upload mingguan tapi belum terdaftar di master.
 *
 * Sejak insiden duplikat 2026-07-30, jalur upload TIDAK membuat kreator lagi.
 * Di sinilah master kreator lahir dari data platform: Akuisisi / Management /
 * CM Lead (`creators.pending_review`) memeriksa lalu meng-approve. Setelah itu
 * file mingguan kreator tersebut di-upload ulang supaya agregatnya masuk.
 */

/**
 * Approve: buat baris `creators` untuk username ini.
 *
 * status = 'aktif' karena username ini muncul di laporan performa platform —
 * berarti kreatornya memang sudah bergabung dengan MEA (CLAUDE.md #1). Master
 * lengkapnya (CM, niche, RC, kontrak) diisi menyusul lewat edit kreator atau
 * bulk upload akuisisi; yang penting di sini identitasnya tunggal dan sadar dibuat.
 *
 * Kalau ternyata usernamenya SUDAH ada di master (mis. baru didaftarkan lewat form
 * akuisisi setelah baris ini terdeteksi), baris daftar tunggu ditandai approved dan
 * ditautkan ke kreator existing — tidak membuat duplikat baru.
 */
export async function approvePendingCreator(formData: FormData): Promise<void> {
  const actor = await requirePermission("creators.pending_review");
  const id = Number(formData.get("pending_id"));
  if (!Number.isFinite(id)) throw new Error("pending_id wajib");
  const note = String(formData.get("note") ?? "").trim() || null;

  const admin = createAdminClient();
  const { data: pending, error } = await admin
    .from("creator_pending_registrations")
    .select("id, username, platform, status, source")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Gagal membaca daftar tunggu: ${error.message}`);
  if (!pending) throw new Error(`Baris daftar tunggu ${id} tidak ditemukan`);
  if (pending.status === "approved") throw new Error("Baris ini sudah di-approve");

  const username = String(pending.username).trim();
  const platform = (pending.platform as string | null) ?? null;

  // Cek existing dengan filter di server (ilike) — bukan tarik-semua-lalu-cocokkan,
  // supaya tidak kena batas 1.000 baris PostgREST. Karakter "_"/"%" di handle
  // di-escape karena ilike memperlakukannya sebagai wildcard.
  const escaped = username.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data: matches } = await admin
    .from("creators")
    .select("id, username, platform")
    .ilike("username", escaped);
  const existing =
    (matches ?? []).find(
      (c) =>
        String(c.username ?? "").toLowerCase() === username.toLowerCase() &&
        // Platform NULL disatukan dengan tiktok — sama seperti kunci unik 0029.
        ((c.platform ?? "tiktok") === (platform ?? "tiktok"))
    ) ?? null;

  let creatorId: string;
  if (existing) {
    creatorId = existing.id;
  } else {
    creatorId = await insertCreatorWithGeneratedId(admin, {
      name: username,
      username,
      platform,
      status: "aktif",
    });
    await writeAudit({
      actorId: actor.id,
      action: "creator.pending_approved",
      entityType: "creators",
      entityId: creatorId,
      after: { username, platform, status: "aktif", source: pending.source, pending_id: id },
      type: "auto",
    });
  }

  const { error: updateError } = await admin
    .from("creator_pending_registrations")
    .update({
      status: "approved",
      creator_id: creatorId,
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", id);
  if (updateError) throw new Error(`Gagal memperbarui daftar tunggu: ${updateError.message}`);

  revalidatePath("/workspace/acquisition");
  revalidatePath("/creators");
}

/**
 * Tolak: bukan kreator MEA / salah tulis. Baris tetap tersimpan (bukan dihapus)
 * supaya deteksi berikutnya tidak mengangkatnya lagi jadi pending — counter-nya
 * tetap naik, jadi kalau ternyata nyata masih terlihat di filter "ditolak".
 */
export async function rejectPendingCreator(formData: FormData): Promise<void> {
  const actor = await requirePermission("creators.pending_review");
  const id = Number(formData.get("pending_id"));
  if (!Number.isFinite(id)) throw new Error("pending_id wajib");
  const note = String(formData.get("note") ?? "").trim() || null;

  const admin = createAdminClient();
  const { data: pending } = await admin
    .from("creator_pending_registrations")
    .select("id, username, status")
    .eq("id", id)
    .maybeSingle();
  if (!pending) throw new Error(`Baris daftar tunggu ${id} tidak ditemukan`);

  const { error } = await admin
    .from("creator_pending_registrations")
    .update({
      status: "rejected",
      reviewed_by: actor.id,
      reviewed_at: new Date().toISOString(),
      review_note: note,
    })
    .eq("id", id);
  if (error) throw new Error(`Gagal menolak: ${error.message}`);

  await writeAudit({
    actorId: actor.id,
    action: "creator.pending_rejected",
    entityType: "creator_pending_registrations",
    entityId: String(pending.username),
    after: { pending_id: id, note },
    type: "auto",
  });

  revalidatePath("/workspace/acquisition");
}
