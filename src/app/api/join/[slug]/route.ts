import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

/**
 * Public external application endpoint (PRD §3.5/§6.6, PR-22): NO Supabase
 * session, service role only, "tanpa RLS anon" — this route IS the access
 * control. Rate limit 5/menit/IP (table-backed, §3.5); `ip_hash` stored, never
 * the raw IP. `middleware.ts` explicitly allowlists `/api/join` as public.
 */

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const admin = createAdminClient();
  const ipHash = hashIp(clientIp(req));

  // Log this attempt FIRST (before any other validation) so junk/invalid
  // submissions still count toward the limit — then check the rolling window.
  await admin.from("join_rate_limits").insert({ ip_hash: ipHash });
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin
    .from("join_rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", oneMinuteAgo);
  if ((count ?? 0) > 5) {
    return NextResponse.json(
      { ok: false, error: "Terlalu banyak percobaan — coba lagi dalam satu menit." },
      { status: 429 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Data tidak valid." }, { status: 400 });
  }

  const fullName = String(body.full_name ?? "").trim();
  const username = String(body.username ?? "").trim().replace(/^@/, "");
  const platform = String(body.platform ?? "tiktok").trim() || "tiktok";
  const phone = String(body.phone ?? "").trim() || null;
  const followers = body.followers ? Number(body.followers) : null;
  const niche = String(body.niche ?? "").trim() || null;
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const consent = Boolean(body.consent_contact);

  if (!fullName || !username) {
    return NextResponse.json({ ok: false, error: "Nama dan username wajib diisi." }, { status: 400 });
  }
  if (!consent) {
    return NextResponse.json({ ok: false, error: "Persetujuan dihubungi wajib dicentang." }, { status: 400 });
  }

  const { data: project } = await admin
    .from("special_projects")
    .select("id, status, open_for_signup, signup_deadline")
    .eq("slug", slug)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ ok: false, error: "Project tidak ditemukan." }, { status: 404 });
  }

  // R8: open_for_signup AND now() < signup_deadline AND status ∈ (planning, aktif).
  const isOpen =
    project.open_for_signup &&
    ["planning", "aktif"].includes(project.status) &&
    (!project.signup_deadline || new Date(project.signup_deadline) > new Date());
  if (!isOpen) {
    return NextResponse.json({ ok: false, error: "Pendaftaran untuk project ini sudah tutup." }, { status: 403 });
  }

  const { data: inserted, error } = await admin
    .from("project_external_applicants")
    .insert({
      project_id: project.id, full_name: fullName, username, platform,
      phone, followers, niche, answers_json: answers, consent_contact: consent,
      ip_hash: ipHash, user_agent: req.headers.get("user-agent") ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // Unique (project_id, lower(username), platform) — duplicate signup, not a server error.
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { ok: false, error: duplicate ? "Username ini sudah pernah mendaftar untuk project ini." : `Gagal menyimpan pendaftaran: ${error.message}` },
      { status: duplicate ? 409 : 500 }
    );
  }

  await writeAudit({
    actorId: null, actorLabel: `external:${username}`, action: "m7.external_apply",
    entityType: "project_external_applicants", entityId: String(inserted.id),
    after: { project_id: project.id, username, platform }, type: "auto",
  });

  return NextResponse.json({ ok: true });
}
