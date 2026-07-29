/**
 * Setup temporary passwords for creators already registered in creator_users.
 * Usage: npx tsx scripts/setup-creator-temporary-passwords.ts <output.csv>
 *
 * Input: List of emails (hardcoded below or read from file)
 * Output: CSV with email, temporary_password, creator_id
 *
 * Prerequisites: SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY env vars
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

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY env vars required");
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const results: Array<{
    email: string;
    temporary_password: string;
    creator_id: string | null;
    status: string;
  }> = [];

  for (const email of emails) {
    console.log(`Processing ${email}...`);

    // Check if creator_users exists with this email
    const { data: creatorUser } = await admin
      .from("creator_users")
      .select("id, creator_id, auth_uid")
      .eq("email", email)
      .maybeSingle();

    if (!creatorUser) {
      console.log(`  ✗ creator_users record not found`);
      results.push({ email, temporary_password: "", creator_id: null, status: "not_found" });
      continue;
    }

    const tempPassword = generateTemporaryPassword();
    console.log(`  Generated password: ${tempPassword}`);

    // Create or update auth user
    if (creatorUser.auth_uid) {
      // Already has auth user, just update password
      const { error: updateError } = await admin.auth.admin.updateUserById(
        creatorUser.auth_uid,
        { password: tempPassword }
      );
      if (updateError) {
        console.log(`  ✗ Failed to update password: ${updateError.message}`);
        results.push({
          email,
          temporary_password: "",
          creator_id: creatorUser.creator_id,
          status: `password_update_failed: ${updateError.message}`,
        });
      } else {
        console.log(`  ✓ Password updated (auth_uid: ${creatorUser.auth_uid})`);
        results.push({
          email,
          temporary_password: tempPassword,
          creator_id: creatorUser.creator_id,
          status: "password_updated",
        });
      }
    } else {
      // Create new auth user
      const { data: authUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });

      if (createError) {
        console.log(`  ✗ Failed to create auth user: ${createError.message}`);
        results.push({
          email,
          temporary_password: "",
          creator_id: creatorUser.creator_id,
          status: `auth_creation_failed: ${createError.message}`,
        });
      } else {
        // Link auth user to creator_users
        const { error: linkError } = await admin
          .from("creator_users")
          .update({ auth_uid: authUser.user.id })
          .eq("id", creatorUser.id);

        if (linkError) {
          console.log(`  ✗ Failed to link auth user: ${linkError.message}`);
          results.push({
            email,
            temporary_password: "",
            creator_id: creatorUser.creator_id,
            status: `link_failed: ${linkError.message}`,
          });
        } else {
          console.log(`  ✓ Auth user created & linked (auth_uid: ${authUser.user.id})`);
          results.push({
            email,
            temporary_password: tempPassword,
            creator_id: creatorUser.creator_id,
            status: "created",
          });
        }
      }
    }
  }

  // Write output CSV
  const outputFile = process.argv[2] || "creator-passwords.csv";
  const csvHeader = "email,temporary_password,creator_id,status\n";
  const csvRows = results
    .map((r) => `"${r.email}","${r.temporary_password}","${r.creator_id || ""}","${r.status}"`)
    .join("\n");
  fs.writeFileSync(outputFile, csvHeader + csvRows);

  console.log(`\n✓ Output written to ${outputFile}`);
  console.log(`Successful: ${results.filter((r) => r.status.includes("created") || r.status.includes("updated")).length}/${emails.length}`);
}

main().catch(console.error);
