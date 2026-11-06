/**
 * ONE-TIME MANUAL SEEDING: create Supabase Auth accounts + team_members rows
 * for the MCN team roster (scripts/data/team-roster.json), using sample
 * passwords from a NEVER-COMMITTED credentials CSV (name,email,role,sample_password).
 *
 * Deterministic, 0 token AI (CLAUDE.md #1). Writes auth.users (via admin API),
 * team_members + audit_logs (action "team_member.seed", type "auto") —
 * CLAUDE.md #2/#4. Passwords are read only from the CSV and NEVER written to
 * audit_logs or logged to stdout.
 *
 * Idempotent re-run:
 *  - A roster entry whose email already has a team_members row is skipped.
 *  - A roster entry whose email already has an auth user (createUser returns
 *    "already registered") has its existing auth user id looked up and reused
 *    so the team_members insert can still proceed.
 *
 * DO NOT RUN AUTOMATICALLY — the orchestrator/user runs this manually once.
 *
 * Run with:
 *   npx tsx scripts/seed-team-accounts.ts [path-to-credentials.csv]
 *   (defaults to ./team-credentials.csv if no arg is given)
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
 * (same admin-client pattern as scripts/backfill-avg-gmv.ts — loaded manually
 * below since this runs outside Next's env loading).
 */
import { readFileSync } from "fs";
import path from "path";

// ---- Load .env.local the same way the other one-off scripts do (outside Next request scope) ----
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// ---- Enums (must mirror supabase/migrations/0001_init_schema.sql role_t / team_group_t) ----
const ROLES = [
  "director",
  "head",
  "spv",
  "cm_lead",
  "cpm",
  "bizdev_lead",
  "bizdev",
  "campaign_ops",
  "bd_admin",
  "acquisition_lead",
  "acquisition_spec",
  "campaign_external",
  "creator_support",
  "finance",
] as const;
type Role = (typeof ROLES)[number];
function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

const TEAM_GROUPS = ["management", "acquisition", "cm", "bizdev", "external", "support", "finance"] as const;
type TeamGroup = (typeof TEAM_GROUPS)[number];
function isTeamGroup(value: string): value is TeamGroup {
  return (TEAM_GROUPS as readonly string[]).includes(value);
}

// ---- Roster shape (scripts/data/team-roster.json) ----
interface RosterEntry {
  name: string;
  email: string | null;
  divisi: string;
  role: string;
  team_group: string;
  phone_office?: string | null;
  phone_personal?: string | null;
  flags?: string[] | null;
}

interface CredentialRow {
  name: string;
  email: string;
  role: string;
  samplePassword: string;
}

/** Minimal CSV line splitter that tolerates quoted fields containing commas. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

function loadCredentials(csvPath: string): Map<string, CredentialRow> {
  const raw = readFileSync(csvPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error(`Credentials CSV kosong: ${csvPath}`);

  const byEmail = new Map<string, CredentialRow>();
  // Skip header row (name,email,role,sample_password).
  for (const line of lines.slice(1)) {
    const [name, email, role, samplePassword] = parseCsvLine(line);
    if (!email) continue;
    byEmail.set(email.toLowerCase(), { name, email, role, samplePassword });
  }
  return byEmail;
}

/** Paginate through auth.admin.listUsers to find an existing user by email (no getUserByEmail in this supabase-js version). */
async function findAuthUserIdByEmail(
  admin: Awaited<ReturnType<typeof import("../src/lib/supabase/admin").createAdminClient>>,
  email: string
): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Gagal listUsers (page ${page}): ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { writeAudit } = await import("../src/lib/audit");

  const csvPath = process.argv[2] ?? "./team-credentials.csv";
  const rosterPath = path.join("scripts", "data", "team-roster.json");

  const roster: RosterEntry[] = JSON.parse(readFileSync(rosterPath, "utf8"));
  console.log(`Roster dimuat: ${roster.length} entri dari ${rosterPath}`);

  // ---- 1. Validate role / team_group for ALL rows BEFORE making any change ----
  const invalidRows: string[] = [];
  for (const entry of roster) {
    if (!isRole(entry.role)) {
      invalidRows.push(`${entry.name} <${entry.email ?? "no-email"}>: role tidak valid "${entry.role}"`);
    }
    if (!isTeamGroup(entry.team_group)) {
      invalidRows.push(`${entry.name} <${entry.email ?? "no-email"}>: team_group tidak valid "${entry.team_group}"`);
    }
  }
  if (invalidRows.length > 0) {
    console.error("Ditemukan baris roster tidak valid — dibatalkan sebelum ada perubahan apa pun:");
    for (const row of invalidRows) console.error(`  - ${row}`);
    process.exit(1);
  }

  const credentials = loadCredentials(csvPath);
  console.log(`Kredensial dimuat: ${credentials.size} baris dari ${csvPath}`);

  const admin = createAdminClient();

  let created = 0;
  let alreadyExisted = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of roster) {
    const flags = entry.flags ?? [];
    if (!entry.email || flags.includes("missing_email")) {
      skipped++;
      console.log(`SKIP  ${entry.name}: tidak ada email (flags=${JSON.stringify(flags)})`);
      continue;
    }

    const email = entry.email;

    try {
      // ---- Idempotency: skip if team_members row already exists for this email ----
      const { data: existingMember, error: existingMemberError } = await admin
        .from("team_members")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      if (existingMemberError) throw new Error(`Gagal cek team_members ${email}: ${existingMemberError.message}`);
      if (existingMember) {
        alreadyExisted++;
        console.log(`SKIP  ${entry.name} <${email}>: team_members sudah ada.`);
        continue;
      }

      const credential = credentials.get(email.toLowerCase());
      if (!credential) throw new Error(`Tidak ada baris kredensial untuk email ${email} di ${csvPath}`);

      // ---- Create (or reuse) the Supabase Auth user ----
      let authUserId: string | null = null;
      const { data: createData, error: createError } = await admin.auth.admin.createUser({
        email,
        password: credential.samplePassword,
        email_confirm: true,
      });
      if (createError) {
        if (createError.message.toLowerCase().includes("already registered")) {
          authUserId = await findAuthUserIdByEmail(admin, email);
          if (!authUserId) throw new Error(`Auth user "already registered" tapi tidak ditemukan via listUsers: ${email}`);
        } else {
          throw new Error(`Gagal createUser ${email}: ${createError.message}`);
        }
      } else {
        authUserId = createData.user.id;
      }

      // ---- Insert team_members row ----
      const { error: insertError } = await admin.from("team_members").insert({
        id: authUserId,
        name: entry.name,
        email,
        role: entry.role,
        team_group: entry.team_group,
        active: true,
      });
      if (insertError) throw new Error(`Gagal insert team_members ${email}: ${insertError.message}`);

      await writeAudit({
        actorId: null,
        actorLabel: "system:seed_team_accounts",
        action: "team_member.seed",
        entityType: "team_member",
        entityId: authUserId,
        after: { name: entry.name, email, role: entry.role, team_group: entry.team_group },
        type: "auto",
      });

      created++;
      console.log(`OK    ${entry.name} <${email}>: team_members dibuat (id=${authUserId}).`);
    } catch (e) {
      failed++;
      console.error(`GAGAL ${entry.name} <${email}>:`, e instanceof Error ? e.message : e);
    }
  }

  console.log("\n=== Seeding selesai ===");
  console.log(`Dibuat: ${created}`);
  console.log(`Sudah ada sebelumnya (dilewati): ${alreadyExisted}`);
  console.log(`Dilewati (tanpa email / missing_email): ${skipped}`);
  console.log(`Gagal: ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Seeding gagal total:", e);
  process.exit(1);
});
