"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { hasPermission, requireMember, requirePermission, type TeamMember } from "@/lib/rbac";
import { BIZDEV_ROLES } from "@/lib/rbac-constants";
import { canManageProjectBrands, isAssignedManpower } from "@/lib/m7/access";
import { MIGRATION_0091_MISSING, parseJoinedDate, parseTargetBrands, projectBrandKey } from "@/lib/m7/project-brands";
import { isMissingRelationError } from "@/lib/db/missing-migration";
import { searchShopSummary } from "@/lib/deals/shop-search";

/**
 * Brand bergabung di Special Project (migrasi 0091). Semua action mengembalikan
 * hasil ber-diskriminan, tidak melempar Error — Next.js menyensor pesan Error di
 * production (pola sama dengan actions.ts di folder induk).
 */
export type BrandActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Satu pilihan shop dari tab Deal Brand (view deal_shop_summary). */
export interface BrandShopOption {
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
}

export type BrandShopSearchResult =
  | { ok: true; shops: BrandShopOption[]; capped: boolean }
  | { ok: false; error: string };

const fail = (e: unknown, fallback: string): { ok: false; error: string } => ({
  ok: false,
  error: e instanceof Error ? e.message : fallback,
});

/** Penjaga: m7.brands, atau man power yang di-assign ke project ini. */
async function requireBrandAccess(projectId: number): Promise<TeamMember> {
  const member = await requireMember();
  const allowed = canManageProjectBrands({
    hasBrandsPermission: hasPermission("m7.brands", member.role),
    isAssignedManpower: await isAssignedManpower(createAdminClient(), projectId, member.id),
  });
  if (!allowed) throw new Error("Akses ditolak: Anda tidak bisa mencatat brand di project ini.");
  return member;
}

const parseProjectId = (raw: FormDataEntryValue | null): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Project tidak dikenali");
  return id;
};

/**
 * Cari shop di katalog tab Deal Brand untuk pemilih brand. Pencarian & urutannya milik
 * `searchShopSummary` — definisi yang sama dengan pemilih shop Jadwal Live & Project BD
 * (CLAUDE.md #4).
 */
export async function searchProjectBrandShops(projectId: number, term: string): Promise<BrandShopSearchResult> {
  try {
    await requireBrandAccess(projectId);
    const { rows, capped } = await searchShopSummary(createAdminClient(), {
      term,
      columns: "shop_key, shop_name, shop_id",
      limit: 20,
    });
    return {
      ok: true,
      shops: rows.map((s) => ({
        shop_key: s.shop_key as string,
        shop_name: (s.shop_name as string | null) ?? null,
        shop_id: (s.shop_id as string | null) ?? null,
      })),
      capped,
    };
  } catch (e) {
    return fail(e, "Pencarian brand gagal");
  }
}

/**
 * Catat brand yang bergabung. shop_key opsional (dipilih dari katalog Deal Brand);
 * brand yang belum terdaftar di sana tetap boleh dicatat dengan nama saja. BizDev
 * pencari brand default = pencatat. Brand yang sama (brand_key) tidak bisa dicatat
 * dua kali di satu project.
 */
export async function addProjectBrand(formData: FormData): Promise<BrandActionResult> {
  try {
    const projectId = parseProjectId(formData.get("project_id"));
    const actor = await requireBrandAccess(projectId);

    const brandName = String(formData.get("brand_name") ?? "").replace(/\s+/g, " ").trim();
    const brandKey = projectBrandKey(brandName);
    if (!brandName || !brandKey) throw new Error("Nama brand wajib diisi");
    const shopKey = String(formData.get("shop_key") ?? "").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const joinedRaw = String(formData.get("joined_at") ?? "").trim();
    const joinedAt = joinedRaw ? parseJoinedDate(joinedRaw) : null;
    if (joinedRaw && !joinedAt) throw new Error("Tanggal bergabung tidak valid");
    const bizdevId = String(formData.get("bizdev_id") ?? "").trim() || actor.id;

    const admin = createAdminClient();
    const { data: project } = await admin
      .from("special_projects").select("id, status").eq("id", projectId).maybeSingle();
    if (!project) throw new Error(`Project ${projectId} tidak ditemukan`);
    if (project.status === "dibatalkan") throw new Error("Project sudah dibatalkan");

    // shop_key bukan FK (shop = hasil grouping): tanpa cek ini brand bisa menunjuk shop
    // karangan/basi. Diperiksa ke view yang SAMA dengan sumber pemilihnya.
    if (shopKey) {
      const { data: shop, error } = await admin
        .from("deal_shop_summary").select("shop_key").eq("shop_key", shopKey).limit(1).maybeSingle();
      if (error) throw new Error(`Gagal memeriksa shop: ${error.message}`);
      if (!shop) throw new Error(`Shop "${shopKey}" tidak ada di tab Deal Brand — pilih ulang atau kosongkan.`);
    }

    if (bizdevId !== actor.id) {
      const { data: bd } = await admin
        .from("team_members").select("id, role, active").eq("id", bizdevId).maybeSingle();
      if (!bd?.active || !BIZDEV_ROLES.includes(bd.role)) throw new Error("BizDev yang dipilih tidak dikenali");
    }

    const row = {
      project_id: projectId,
      brand_name: brandName,
      brand_key: brandKey,
      shop_key: shopKey,
      bizdev_id: bizdevId,
      notes,
      created_by: actor.id,
      ...(joinedAt ? { joined_at: joinedAt } : {}),
    };
    const { data: inserted, error } = await admin
      .from("special_project_brands").insert(row).select("id").single();
    if (error) {
      if (isMissingRelationError(error)) throw new Error(MIGRATION_0091_MISSING);
      if (error.code === "23505") throw new Error(`Brand "${brandName}" sudah tercatat di project ini`);
      throw new Error(`Gagal mencatat brand: ${error.message}`);
    }

    await writeAudit({
      actorId: actor.id, action: "m7.project_brand_add", entityType: "special_project_brands",
      entityId: String(inserted.id), after: row, type: "auto",
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: `Brand "${brandName}" tercatat bergabung.` };
  } catch (e) {
    return fail(e, "Gagal mencatat brand");
  }
}

/** Hapus catatan brand (koreksi salah catat). Isi baris direkam ke audit_logs dulu. */
export async function removeProjectBrand(formData: FormData): Promise<BrandActionResult> {
  try {
    const projectId = parseProjectId(formData.get("project_id"));
    const actor = await requireBrandAccess(projectId);
    const brandId = Number(formData.get("brand_id"));
    if (!Number.isInteger(brandId) || brandId <= 0) throw new Error("Brand tidak dikenali");

    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("special_project_brands").select("*").eq("id", brandId).eq("project_id", projectId).maybeSingle();
    if (!existing) throw new Error("Brand tidak ditemukan di project ini");

    const { error } = await admin.from("special_project_brands").delete().eq("id", brandId);
    if (error) throw new Error(`Gagal menghapus brand: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m7.project_brand_remove", entityType: "special_project_brands",
      entityId: String(brandId), before: existing, after: null, type: "auto",
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Gagal menghapus brand");
  }
}

/** Edit inline target jumlah brand — leader (m7.edit_target), sama seperti Target GMV. */
export async function updateProjectTargetBrands(formData: FormData): Promise<BrandActionResult> {
  try {
    const actor = await requirePermission("m7.edit_target");
    const projectId = parseProjectId(formData.get("project_id"));
    const parsed = parseTargetBrands(formData.get("target_brands"));
    if (!parsed.ok) throw new Error(parsed.error);

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("special_projects").select("target_brands").eq("id", projectId).maybeSingle();
    if (readError && isMissingRelationError(readError)) throw new Error(MIGRATION_0091_MISSING);
    if (!existing) throw new Error(`Project ${projectId} tidak ditemukan`);

    const { error } = await admin
      .from("special_projects").update({ target_brands: parsed.value }).eq("id", projectId);
    if (error) throw new Error(`Gagal menyimpan target brand: ${error.message}`);

    await writeAudit({
      actorId: actor.id, action: "m7.update_project_target_brands", entityType: "special_projects",
      entityId: String(projectId),
      before: { target_brands: existing.target_brands }, after: { target_brands: parsed.value }, type: "auto",
    });
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return fail(e, "Gagal menyimpan target brand");
  }
}
