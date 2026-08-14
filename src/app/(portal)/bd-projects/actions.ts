"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import {
  bdProjectSchema,
  parseShopKeys,
  PROJECT_PRODUCT_LIMIT,
  PROJECT_SHOP_LIMIT,
} from "@/lib/deals/bd-project";
import { parseProductRowKeys } from "@/lib/m10/product-keys";

export interface ProjectFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  /** Diisi saat project BARU tersimpan, supaya form bisa langsung membuka detailnya. */
  projectId?: string;
}

/**
 * Tambah / ubah Project BD.
 *
 * Satu server action untuk dua tombol: tanpa `project_id` = menambah, dengan
 * `project_id` = mengubah. Aturannya identik, dan memisahkannya jadi dua action
 * berarti dua salinan validasi yang bisa berbeda diam-diam.
 *
 * Yang disimpan cuma nama, status, catatan, dan DAFTAR SHOP-nya (shop_key). Semua
 * angka project — jumlah kartu, ads budget, GMV — tidak pernah disalin ke sini;
 * halaman detail membacanya dari products_tap (CLAUDE.md #4).
 *
 * Menulis lewat admin client karena RLS bd_projects = baca saja untuk authenticated
 * (0044); izinnya ditegakkan server lewat requirePermission.
 */
export async function saveBdProject(
  _prev: ProjectFormState | null,
  formData: FormData
): Promise<ProjectFormState> {
  const actor = await requirePermission("bd_project.manage");

  const parsed = bdProjectSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { ok: false, message: "Periksa kembali isian form.", fieldErrors };
  }
  const d = parsed.data;

  let shopKeys: string[];
  try {
    shopKeys = parseShopKeys(String(formData.get("shop_keys") ?? "[]"));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Daftar shop tidak terbaca" };
  }
  if (shopKeys.length === 0) {
    return {
      ok: false,
      message: "Pilih minimal satu brand / shop dari tabel Shop dari Produk TAP.",
      fieldErrors: { shop_keys: "Pilih minimal satu shop" },
    };
  }
  if (shopKeys.length > PROJECT_SHOP_LIMIT) {
    return {
      ok: false,
      message: `Maksimal ${PROJECT_SHOP_LIMIT} shop per project (terpilih ${shopKeys.length}).`,
      fieldErrors: { shop_keys: `Maksimal ${PROJECT_SHOP_LIMIT} shop` },
    };
  }

  const admin = createAdminClient();

  // Shop yang dipilih harus benar-benar ada di katalog: kunci karangan (atau shop
  // yang keburu berganti nama) akan jadi anggota project yang tak pernah muncul.
  const { data: known, error: knownError } = await admin
    .from("products_tap")
    .select("shop_key")
    .in("shop_key", shopKeys);
  if (knownError) return { ok: false, message: `Gagal memeriksa daftar shop: ${knownError.message}` };
  const knownKeys = new Set((known ?? []).map((r) => r.shop_key as string));
  const unknown = shopKeys.filter((k) => !knownKeys.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Shop tidak ditemukan di katalog Produk TAP: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` (+${unknown.length - 3})` : ""}.`,
      fieldErrors: { shop_keys: "Ada shop yang tidak dikenali" },
    };
  }

  const isNew = d.project_id === undefined;
  const projectId = d.project_id ?? genId("PRJ");

  const record = {
    name: d.name,
    status: d.status,
    notes: d.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  let before: unknown = null;
  if (isNew) {
    const { error } = await admin
      .from("bd_projects")
      .insert({ id: projectId, ...record, created_by: actor.id });
    if (error) return { ok: false, message: `Gagal menyimpan project: ${error.message}` };
  } else {
    const { data: existing } = await admin
      .from("bd_projects")
      .select("id, name, status, notes")
      .eq("id", projectId)
      .maybeSingle();
    if (!existing) return { ok: false, message: `Project ${projectId} tidak ditemukan.` };
    before = existing;

    const { error } = await admin.from("bd_projects").update(record).eq("id", projectId);
    if (error) return { ok: false, message: `Gagal menyimpan project: ${error.message}` };
  }

  // Daftar shop ditulis ulang utuh: form mengirim keadaan akhir yang diinginkan,
  // jadi menghitung selisih tambah/hapus hanya menambah jalan yang bisa salah.
  const { error: clearError } = await admin
    .from("bd_project_shops")
    .delete()
    .eq("project_id", projectId);
  if (clearError) return { ok: false, message: `Gagal menyimpan daftar shop: ${clearError.message}` };
  const { error: shopError } = await admin
    .from("bd_project_shops")
    .insert(shopKeys.map((shop_key) => ({ project_id: projectId, shop_key })));
  if (shopError) return { ok: false, message: `Gagal menyimpan daftar shop: ${shopError.message}` };

  await writeAudit({
    actorId: actor.id,
    action: isNew ? "bd_project.create" : "bd_project.update",
    entityType: "bd_projects",
    entityId: projectId,
    before,
    after: { id: projectId, ...record, shop_keys: shopKeys },
    // Menyusun pengelompokan tidak mengubah data deal mana pun → auto berlaku,
    // tetap ter-log lengkap (CLAUDE.md #2).
    type: "auto",
  });

  revalidatePath("/bd-projects");
  revalidatePath(`/bd-projects/${projectId}`);
  return {
    ok: true,
    message: isNew
      ? `Project "${d.name}" tersimpan dengan ${shopKeys.length} shop.`
      : `Project ${projectId} diperbarui (${shopKeys.length} shop).`,
    projectId,
  };
}

/**
 * Simpan daftar kartu produk yang DIKERJASAMAKAN pada sebuah project.
 *
 * Shop project bisa punya ratusan kartu produk, dan hanya sebagian yang benar-benar
 * masuk campaign. Centangan di tabel "Produk yang Dikerjasamakan" disimpan sebagai
 * kunci (campaign_id, product_id) di `bd_project_products` — atribut produknya
 * (harga, komisi, masa berlaku) tetap dibaca dari products_tap, tidak disalin
 * (CLAUDE.md #4).
 *
 * Ditulis ulang utuh seperti daftar shop: form mengirim keadaan akhir yang
 * diinginkan, jadi tidak ada perhitungan selisih yang bisa salah.
 */
export async function setProjectProducts(
  _prev: ProjectFormState | null,
  formData: FormData
): Promise<ProjectFormState> {
  const actor = await requirePermission("bd_project.manage");

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { ok: false, message: "Project tidak dikenali." };

  let keys;
  try {
    keys = parseProductRowKeys(String(formData.get("product_keys") ?? "[]"));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Daftar produk tidak terbaca" };
  }
  if (keys.length > PROJECT_PRODUCT_LIMIT) {
    return {
      ok: false,
      message: `Maksimal ${PROJECT_PRODUCT_LIMIT} kartu produk per project (terpilih ${keys.length}).`,
    };
  }

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("bd_projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: `Project ${projectId} tidak ditemukan.` };

  const { data: before } = await admin
    .from("bd_project_products")
    .select("campaign_id, product_id")
    .eq("project_id", projectId);

  const { error: clearError } = await admin
    .from("bd_project_products")
    .delete()
    .eq("project_id", projectId);
  if (clearError) {
    return { ok: false, message: `Gagal menyimpan daftar produk: ${clearError.message}` };
  }

  if (keys.length > 0) {
    const { error } = await admin.from("bd_project_products").insert(
      keys.map((k) => ({
        project_id: projectId,
        campaign_id: k.campaignId,
        product_id: k.productId,
        added_by: actor.id,
      }))
    );
    // Foreign key gagal = kartu yang dicentang sudah tidak ada di katalog (dihapus
    // dari tab Produk TAP setelah halaman dibuka). Pesannya disebut apa adanya.
    if (error) {
      return {
        ok: false,
        message:
          `Gagal menyimpan daftar produk: ${error.message}. ` +
          "Muat ulang halaman — kemungkinan ada kartu yang sudah dihapus dari katalog Produk TAP.",
      };
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: "bd_project.set_products",
    entityType: "bd_projects",
    entityId: projectId,
    before: { products: before ?? [] },
    after: { products: keys },
    // Menandai produk mana yang digarap tidak mengubah kartu produknya sama sekali
    // → auto berlaku, tetap ter-log (CLAUDE.md #2).
    type: "auto",
  });

  revalidatePath(`/bd-projects/${projectId}`);
  return {
    ok: true,
    message:
      keys.length === 0
        ? "Daftar kerja sama dikosongkan — semua kartu shop project ini kembali dianggap belum dipilih."
        : `${keys.length} kartu produk ditandai dikerjasamakan pada project ini.`,
  };
}

/**
 * Hapus Project BD.
 *
 * Yang hilang hanya pengelompokannya — kartu produk, deal, dan shop tidak
 * tersentuh sama sekali. Report campaign yang menempel ke project ikut terhapus
 * (on delete cascade, 0044), jadi isinya ditulis lebih dulu ke audit_logs
 * (CLAUDE.md #2) dan tombolnya minta konfirmasi ketik nama project.
 */
export async function deleteBdProject(
  _prev: ProjectFormState | null,
  formData: FormData
): Promise<ProjectFormState> {
  const actor = await requirePermission("bd_project.manage");
  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { ok: false, message: "Project tidak dikenali." };

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("bd_projects")
    .select("id, name, status, notes, created_by, created_at")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, message: `Project ${projectId} tidak ditemukan.` };

  if (String(formData.get("confirm") ?? "").trim() !== project.name) {
    return {
      ok: false,
      message: `Ketik nama project persis ("${project.name}") untuk konfirmasi.`,
      fieldErrors: { confirm: "Nama project tidak cocok" },
    };
  }

  const [{ data: shops }, { data: sessions }, { data: proposals }] = await Promise.all([
    admin.from("bd_project_shops").select("shop_key").eq("project_id", projectId),
    admin.from("deal_live_sessions").select("*").eq("project_id", projectId),
    admin.from("deal_creator_proposals").select("*").eq("project_id", projectId),
  ]);

  const { error } = await admin.from("bd_projects").delete().eq("id", projectId);
  if (error) return { ok: false, message: `Gagal menghapus project: ${error.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "bd_project.delete",
    entityType: "bd_projects",
    entityId: projectId,
    // Isi lengkap = satu-satunya jalan pulih kalau salah hapus.
    before: { project, shops, sessions, proposals },
    after: null,
    type: "auto",
  });

  revalidatePath("/bd-projects");
  return { ok: true, message: `Project "${project.name}" dihapus (tercatat di audit log).` };
}
