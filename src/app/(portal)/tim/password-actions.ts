"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { generateTemporaryPassword } from "@/lib/utils/password";

export interface TemporaryPasswordResult {
  email: string;
  user_id?: string;
  temporary_password?: string;
  status: "created" | "password_set" | "not_found" | "error";
  error?: string;
}

/**
 * Bulk setup temporary passwords untuk team members.
 * - Check if auth user exists
 * - If not, create (set temporary password)
 * - If exists, update password
 * Returns array with email + temp password untuk di-share ke users.
 */
export async function setupTemporaryPasswords(
  emails: string[]
): Promise<TemporaryPasswordResult[]> {
  const actor = await requirePermission("team.bulk_upload");
  const admin = createAdminClient();
  const results: TemporaryPasswordResult[] = [];

  for (const email of emails) {
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`Processing ${normalizedEmail}...`);

    // Check if team_member exists
    const { data: teamMember } = await admin
      .from("team_members")
      .select("id, name")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (!teamMember) {
      results.push({
        email: normalizedEmail,
        status: "not_found",
        error: "Email tidak ditemukan di team_members",
      });
      continue;
    }

    const tempPassword = generateTemporaryPassword();
    const userId = teamMember.id;

    // Check if auth user exists
    const { data: authUsers } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const authUser = authUsers?.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    if (authUser) {
      // Update password
      const { error } = await admin.auth.admin.updateUserById(authUser.id, {
        password: tempPassword,
      });

      if (error) {
        console.log(`  ✗ Failed to update password: ${error.message}`);
        results.push({
          email: normalizedEmail,
          user_id: authUser.id,
          status: "error",
          error: error.message,
        });
      } else {
        console.log(`  ✓ Password updated`);
        results.push({
          email: normalizedEmail,
          user_id: authUser.id,
          temporary_password: tempPassword,
          status: "password_set",
        });

        await writeAudit({
          actorId: actor.id,
          action: "team_member.temporary_password_set",
          entityType: "team_members",
          entityId: userId,
          after: { password_changed: true },
          type: "auto",
        });
      }
    } else {
      // Create new auth user
      const { data, error } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
      });

      if (error) {
        console.log(`  ✗ Failed to create auth user: ${error.message}`);
        results.push({
          email: normalizedEmail,
          status: "error",
          error: error.message,
        });
      } else {
        console.log(`  ✓ Auth user created with temporary password`);
        results.push({
          email: normalizedEmail,
          user_id: data.user.id,
          temporary_password: tempPassword,
          status: "created",
        });

        await writeAudit({
          actorId: actor.id,
          action: "team_member.auth_user_created_with_temp_password",
          entityType: "team_members",
          entityId: userId,
          after: { auth_user_id: data.user.id, password_set: true },
          type: "auto",
        });
      }
    }
  }

  return results;
}
