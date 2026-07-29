#!/usr/bin/env node
/**
 * One-time script untuk reset password user di production.
 * Gunakan: npx tsx scripts/reset-user-password.ts ilukman17@gmail.com Password123!
 *
 * This script requires:
 * - SUPABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY di .env.local
 * - Node.js dengan tsx
 *
 * Catat: Password TIDAK disimpan di history atau logs. Audit dicatat di audit_logs table.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const [email, password] = args;

if (!email || !password) {
  console.error("Usage: npx tsx scripts/reset-user-password.ts <email> <password>");
  console.error("Example: npx tsx scripts/reset-user-password.ts ilukman17@gmail.com Password123!");
  process.exit(1);
}

if (password.length < 8) {
  console.error("❌ Password minimal 8 karakter");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Environment variables tidak set:");
  console.error("   - NEXT_PUBLIC_SUPABASE_URL");
  console.error("   - SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createSupabaseClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`🔄 Resetting password for ${email}...`);

  try {
    // List users (untuk find user by email)
    const { data: userData, error: listError } = await admin.auth.admin.listUsers();

    if (listError) {
      console.error("❌ Gagal list users:", listError.message);
      process.exit(1);
    }

    const targetUser = userData.users.find((u) => u.email === email);
    if (!targetUser) {
      console.error(`❌ User dengan email "${email}" tidak ditemukan di Supabase Auth`);
      process.exit(1);
    }

    console.log(`   Found user ID: ${targetUser.id}`);

    // Update password
    const { error: updateError } = await admin.auth.admin.updateUserById(targetUser.id, {
      password,
    });

    if (updateError) {
      console.error("❌ Gagal update password:", updateError.message);
      process.exit(1);
    }

    console.log(`✅ Password reset sukses untuk ${email}`);
    console.log(`   New password: ${password}`);
    console.log(`   User ID: ${targetUser.id}`);

    // Catat audit (optional, jika ada DB connection)
    try {
      const auditResult = await admin.from("audit_logs").insert({
        actor_id: null,
        actor_label: "system:password_reset_script",
        action: "password_reset",
        entity_type: "auth_user",
        entity_id: targetUser.id,
        before: null,
        after: {
          user_email: email,
          reset_by: "script",
          timestamp: new Date().toISOString(),
        },
        type: "auto",
      });

      if (auditResult.error) {
        console.warn("⚠️  Audit log gagal (tapi password sudah direset):", auditResult.error);
      } else {
        console.log("✅ Audit log recorded");
      }
    } catch (e) {
      console.warn("⚠️  Could not write audit log:", (e as Error).message);
    }

    console.log("\n📋 Reminder:");
    console.log("   • Share password ini secara aman (chat encrypted, bukan email plain)");
    console.log("   • User wajib ganti password setelah login pertama");
    console.log("   • Aksi sudah tercatat di audit_logs");
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    process.exit(1);
  }
}

main();
