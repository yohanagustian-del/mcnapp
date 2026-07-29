#!/usr/bin/env npx tsx
/**
 * Generate temporary passwords untuk team members.
 * Usage: npx tsx scripts/generate-team-passwords.ts [--output <file.csv>]
 *
 * Requires:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Output: CSV file dengan email, temporary_password, user_id, status
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const emails = [
  "nanthieshabila@gmail.com",
  "helsihelisa123@gmail.com",
  "amaliaputrisinidi9@gmail.com",
  "hidayatfadel22@gmail.com",
  "ilukman17@gmail.com",
  "raisaqisthyhp@gmail.com",
  "gabrielomrr@gmail.com",
  "aditya.septiherm@gmail.com",
  "zamzamfirdaus90@gmail.com",
  "Erlinasriutami03@gmail.com",
];

function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let random = "";
  for (let i = 0; i < 6; i++) {
    random += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Aa1_${random}`;
}

interface PasswordResult {
  email: string;
  user_id: string;
  temporary_password: string;
  status: "created" | "password_set" | "not_found" | "error";
  error: string;
  name: string;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error(
      "❌ Missing environment variables: SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const results: PasswordResult[] = [];
  let successCount = 0;

  console.log(`🔐 Generating temporary passwords untuk ${emails.length} team members...\n`);

  // First, get all team members info
  const { data: allTeamMembers } = await admin
    .from("team_members")
    .select("id, name, email")
    .in("email", emails.map((e) => e.toLowerCase()));

  const teamMemberMap = new Map(
    (allTeamMembers || []).map((tm) => [tm.email.toLowerCase(), tm])
  );

  for (const email of emails) {
    const normalizedEmail = email.toLowerCase();
    console.log(`\n📧 ${email}`);

    const teamMember = teamMemberMap.get(normalizedEmail);
    if (!teamMember) {
      console.log(`   ⚠️  Not found in team_members`);
      results.push({
        email: normalizedEmail,
        user_id: "",
        temporary_password: "",
        status: "not_found",
        error: "Not in team_members",
        name: "",
      });
      continue;
    }

    const tempPassword = generateTemporaryPassword();
    console.log(`   ${teamMember.name} (${teamMember.id})`);
    console.log(`   🔑 Password: ${tempPassword}`);

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
        console.log(`   ❌ Failed: ${error.message}`);
        results.push({
          email: normalizedEmail,
          user_id: authUser.id,
          temporary_password: "",
          status: "error",
          error: error.message,
          name: teamMember.name,
        });
      } else {
        console.log(`   ✅ Password updated`);
        results.push({
          email: normalizedEmail,
          user_id: authUser.id,
          temporary_password: tempPassword,
          status: "password_set",
          error: "",
          name: teamMember.name,
        });
        successCount++;
      }
    } else {
      // Create new auth user
      const { data, error } = await admin.auth.admin.createUser({
        email: normalizedEmail,
        password: tempPassword,
        email_confirm: true,
      });

      if (error) {
        console.log(`   ❌ Failed: ${error.message}`);
        results.push({
          email: normalizedEmail,
          user_id: "",
          temporary_password: "",
          status: "error",
          error: error.message,
          name: teamMember.name,
        });
      } else {
        console.log(`   ✅ Auth user created`);
        results.push({
          email: normalizedEmail,
          user_id: data.user.id,
          temporary_password: tempPassword,
          status: "created",
          error: "",
          name: teamMember.name,
        });
        successCount++;
      }
    }
  }

  // Write output CSV
  const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
  const outputFile =
    outputArg?.split("=")[1] || "team-temporary-passwords.csv";

  const csvHeader = "name,email,temporary_password,user_id,status,error\n";
  const csvRows = results
    .map(
      (r) =>
        `"${r.name}","${r.email}","${r.temporary_password}","${r.user_id}","${r.status}","${r.error}"`
    )
    .join("\n");

  fs.writeFileSync(outputFile, csvHeader + csvRows);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`✅ Success: ${successCount}/${emails.length}`);
  console.log(`📁 Output: ${path.resolve(outputFile)}`);
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
