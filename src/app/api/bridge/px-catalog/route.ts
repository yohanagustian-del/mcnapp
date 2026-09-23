import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";

/**
 * Bridge CDPS→MCN, arah balik dari Flow C (PX-M3-A) — CDPS push snapshot
 * katalog PX Exchange ke sini. Kontrak: `docs/BRIDGE_PX_CATALOG_CONTRACT.md`
 * (sumber kebenaran bentuk payload, disalin byte-identik ke MEAgrup/AgencyAPP
 * — jangan menebak bentuknya dari kode sisi mana pun).
 *
 * Public external endpoint (mirip pola src/app/api/join/[slug]/route.ts):
 * tanpa sesi Supabase, bearer secret adalah satu-satunya gerbang akses — RLS
 * anon tidak dipakai di sini karena request ini bukan dari browser pengguna.
 */

const PRICE_SEGMENTS = ["low", "entry", "sweet", "high", "premium"] as const;

const rowSchema = z
  .object({
    client_platform_id: z.string().min(1),
    platform_product_id: z.string().min(1),
    nama_produk: z.string().nullable(),
    platform: z.string().nullable(),
    nama_toko: z.string().nullable(),
    level2_category: z.string().nullable(),
    price_segment: z.enum(PRICE_SEGMENTS).nullable(),
    sudah_afiliasi: z.boolean(),
    dihitung_pada: z.string().nullable(),
  })
  .strict();

const bodySchema = z
  .object({
    snapshot_at: z.string(),
    source: z.literal("cdps"),
    policy_note: z.string(),
    rows: z.array(rowSchema).max(5000, "Maksimum 5.000 baris per request"),
  })
  .strict();

/** Constant-time compare — hindari timing attack pada perbandingan secret. */
function tokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function contractError(issue: z.ZodIssue | undefined): string {
  if (!issue) return "[payload katalog PX tidak sesuai kontrak]";
  if (issue.code === "unrecognized_keys") {
    return `[payload katalog PX tidak sesuai kontrak: ${issue.message}]`;
  }
  const path = issue.path.join(".");
  return `[payload katalog PX tidak sesuai kontrak: kolom '${path}' ${issue.message}]`;
}

export async function POST(req: NextRequest) {
  const secret = process.env.BRIDGE_PX_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  // Fail-closed: secret belum diset di environment ⇒ tolak, jangan pernah
  // "buka" endpoint karena env kosong.
  if (!secret || !provided || !tokenEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idempotencyKey = req.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Header Idempotency-Key wajib" }, { status: 422 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON valid" }, { status: 422 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: contractError(parsed.error.issues[0]) }, { status: 422 });
  }
  const body = parsed.data;

  const admin = createAdminClient();

  const { data: existingPush } = await admin
    .from("px_catalog_pushes")
    .select("batch_key, rows_received")
    .eq("batch_key", idempotencyKey)
    .maybeSingle();
  if (existingPush) {
    return NextResponse.json({
      batch_key: existingPush.batch_key,
      rows_received: existingPush.rows_received,
      duplicate: true,
    });
  }

  const receivedAt = new Date().toISOString();
  const rowsToUpsert = body.rows.map((r) => ({
    client_platform_id: r.client_platform_id,
    platform_product_id: r.platform_product_id,
    nama_produk: r.nama_produk,
    platform: r.platform,
    nama_toko: r.nama_toko,
    level2_category: r.level2_category,
    price_segment: r.price_segment,
    sudah_afiliasi: r.sudah_afiliasi,
    dihitung_pada: r.dihitung_pada,
    active: true,
    batch_key: idempotencyKey,
    received_at: receivedAt,
  }));

  if (rowsToUpsert.length > 0) {
    const { error: upsertError } = await admin
      .from("px_catalog_items")
      .upsert(rowsToUpsert, { onConflict: "client_platform_id,platform_product_id" });
    if (upsertError) {
      return NextResponse.json(
        { error: `Gagal menyimpan katalog PX: ${upsertError.message}` },
        { status: 500 }
      );
    }
  }

  // Snapshot = keadaan PENUH (kontrak §Non-negotiables #6): baris dengan
  // batch_key LAMA (tidak disentuh push ini) berarti tidak lagi ada di
  // snapshot terbaru → nonaktifkan. Baris yang barusan di-upsert sudah
  // punya batch_key = idempotencyKey ini, jadi TIDAK ikut ternonaktifkan.
  const { error: deactivateError } = await admin
    .from("px_catalog_items")
    .update({ active: false })
    .neq("batch_key", idempotencyKey)
    .eq("active", true);
  if (deactivateError) {
    return NextResponse.json(
      { error: `Gagal menonaktifkan baris lama: ${deactivateError.message}` },
      { status: 500 }
    );
  }

  const { error: pushLogError } = await admin.from("px_catalog_pushes").insert({
    batch_key: idempotencyKey,
    payload: body,
    rows_received: body.rows.length,
    received_at: receivedAt,
  });
  if (pushLogError) {
    return NextResponse.json(
      { error: `Gagal mencatat push: ${pushLogError.message}` },
      { status: 500 }
    );
  }

  await writeAudit({
    action: "px.catalog_push",
    entityType: "px_catalog_items",
    entityId: idempotencyKey,
    after: { batch_key: idempotencyKey, rows_received: body.rows.length, snapshot_at: body.snapshot_at },
    actorLabel: "system:bridge_px_catalog",
    type: "auto",
  });

  return NextResponse.json({ batch_key: idempotencyKey, rows_received: body.rows.length, duplicate: false });
}
