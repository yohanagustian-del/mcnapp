"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/rbac";
import { genId } from "@/lib/utils/id";
import { parseRupiah } from "@/lib/utils/rupiah";
import {
  bdProjectSchema,
  mergeShopBudget,
  parseShopKeys,
  PROJECT_PRODUCT_LIMIT,
  PROJECT_SHOP_LIMIT,
  SHOP_PICKER_LIMIT,
} from "@/lib/deals/bd-project";
import { parseProductRowKeys } from "@/lib/m10/product-keys";

export interface ProjectFormState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  /** Diisi saat project BARU tersimpan, supaya form bisa langsung membuka detailnya. */
  projectId?: string;
}

/** Satu pilihan brand/shop di form Tambah/Edit Project. */
export interface ShopOption {
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
  product_count: number;
}

export interface ShopSearchResult {
  shops: ShopOption[];
  /** true = hasilnya kena batas, jadi masih ada yang cocok tapi tidak ditampilkan. */
  capped: boolean;
}

/** numeric/bigint hasil agregasi bisa datang sebagai string tergantung driver. */
function shopCount(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cari brand/shop untuk pemilih di form Tambah/Edit Project.
 *
 * KENAPA DI SERVER. Katalog shop sudah belasan ribu baris. Sebelumnya form memuat
 * daftar shop sekali lalu menyaringnya di klien, jadi kotak carinya hanya bisa
 * menemukan shop yang kebetulan masuk batas muat — shop di luar batas TIDAK ADA bagi
 * pemakai, padahal ada di tab Deal Brand dan Produk TAP. Persis itu yang terjadi pada
 * "Dua Belibis": urutan ke-1073 dari 16.030 shop, di luar batas 500 baris.
 *
 * Filternya sengaja sama persis dengan kotak cari tabel Shop di tab Deal Brand
 * (`/deals`) — satu perilaku pencarian shop, bukan dua yang bisa berbeda diam-diam
 * (CLAUDE.md #4). Query lewat client user biasa: view `deal_shop_summary` sudah
 * security_invoker + grant select ke authenticated (0047), jadi tak perlu admin client.
 */
export async function searchProjectShops(query: string): Promise<ShopSearchResult> {
  // Pemilihnya hanya muncul untuk yang boleh mengelola project; actionnya dijaga
  // dengan izin yang sama supaya tidak jadi jalan pintas membaca katalog shop.
  await requirePermission("bd_project.manage");

  const supabase = await createClient();
  // Urutan bawaan sama dengan tabel Shop di tab Deal Brand: kartu terbanyak dulu,
  // lalu shop yang punya baris deal (0 kartu) — tanpa pengurutan kedua, shop yang
  // baru didaftarkan menumpuk di ekor dan jadi yang pertama terpotong batas.
  let shopQuery = supabase
    .from("deal_shop_summary")
    .select("shop_key, shop_name, shop_id, product_count")
    .order("product_count", { ascending: false })
    .order("deal_count", { ascending: false })
    .order("shop_key", { ascending: true })
    // +1 baris cuma untuk MENGETAHUI ada sisa; baris ekstranya dibuang di bawah.
    .limit(SHOP_PICKER_LIMIT + 1);

  const term = query.trim();
  if (term) {
    // Karakter yang punya arti khusus di PostgREST `or=(...)` — koma memisah kondisi,
    // tanda kurung membungkusnya. Dibuang, bukan di-escape: ini kotak cari, dan nama
    // shop yang memuatnya tetap ketemu lewat sisa katanya.
    const safe = term.replace(/[(),]/g, " ").trim();
    if (!safe) return { shops: [], capped: false };
    const pattern = `%${safe}%`;
    // shop_key sudah berisi Shop Name (atau "#shop_id" untuk baris tanpa nama), jadi
    // tiga filter ini cukup — sama dengan `/deals`.
    shopQuery = shopQuery.or(
      `shop_key.ilike.${pattern},shop_name.ilike.${pattern},shop_id.ilike.${pattern}`
    );
  }

  const { data, error } = await shopQuery;
  if (error) throw new Error(`Gagal mencari shop: ${error.message}`);

  const rows = data ?? [];
  return {
    shops: rows.slice(0, SHOP_PICKER_LIMIT).map((s) => ({
      shop_key: s.shop_key as string,
      shop_name: (s.shop_name as string | null) ?? null,
      shop_id: (s.shop_id as string | null) ?? null,
      product_count: shopCount(s.product_count),
    })),
    capped: rows.length > SHOP_PICKER_LIMIT,
  };
}

/**
 * Tambah / ubah Project BD.
 *
 * Satu server action untuk dua tombol: tanpa `project_id` = menambah, dengan
 * `project_id` = mengubah. Aturannya identik, dan memisahkannya jadi dua action
 * berarti dua salinan validasi yang bisa berbeda diam-diam.
 *
 * Yang disimpan cuma nama, status, status payment, catatan, dan DAFTAR SHOP-nya
 * (shop_key). Angka yang dibaca dari sumber lain — jumlah kartu, GMV, masa berlaku —
 * tidak pernah disalin ke sini (CLAUDE.md #4). Ads Budget & Service Fee memang
 * disimpan per project, tapi di tabelnya sendiri (`bd_project_shop_budgets`) lewat
 * updateProjectShopBudget, bukan di baris project ini.
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
      message: "Pilih minimal satu brand / shop dari tabel Shop di tab Deal Brand.",
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

  // Shop yang dipilih harus benar-benar ada: kunci karangan (atau shop yang keburu
  // berganti nama) akan jadi anggota project yang tak pernah muncul. Diperiksa lewat
  // view yang sama dengan tabel shop di tab Deal Brand — bukan langsung ke
  // products_tap — supaya shop yang deal-nya sudah terdaftar tapi kartu produknya
  // belum (Registrasi Deal berisi Shop Name saja) juga bisa dimasukkan ke project.
  const { data: known, error: knownError } = await admin
    .from("deal_shop_summary")
    .select("shop_key")
    .in("shop_key", shopKeys);
  if (knownError) return { ok: false, message: `Gagal memeriksa daftar shop: ${knownError.message}` };
  const knownKeys = new Set((known ?? []).map((r) => r.shop_key as string));
  const unknown = shopKeys.filter((k) => !knownKeys.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Shop tidak ditemukan: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? ` (+${unknown.length - 3})` : ""}.`,
      fieldErrors: { shop_keys: "Ada shop yang tidak dikenali" },
    };
  }

  const isNew = d.project_id === undefined;
  const projectId = d.project_id ?? genId("PRJ");

  const record = {
    name: d.name,
    status: d.status,
    status_payment: d.status_payment ?? null,
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
      .select("id, name, status, status_payment, notes")
      .eq("id", projectId)
      .maybeSingle();
    if (!existing) return { ok: false, message: `Project ${projectId} tidak ditemukan.` };
    before = existing;

    const { error } = await admin.from("bd_projects").update(record).eq("id", projectId);
    if (error) return { ok: false, message: `Gagal menyimpan project: ${error.message}` };
  }

  // Daftar shop disinkron sebagai SELISIH — hapus yang keluar, tambah yang masuk —
  // bukan hapus-seluruhnya-lalu-tulis-ulang. Sejak 0046 nominal per shop (ads budget
  // & service fee) menempel ke pasangan (project, shop) dengan FK on delete cascade,
  // jadi menghapus seluruh daftar dulu akan menghapus SEMUA nominal project setiap
  // kali namanya diubah.
  const { data: currentShops, error: currentError } = await admin
    .from("bd_project_shops")
    .select("shop_key")
    .eq("project_id", projectId);
  if (currentError) {
    return { ok: false, message: `Gagal membaca daftar shop: ${currentError.message}` };
  }
  const currentKeys = (currentShops ?? []).map((r) => r.shop_key as string);
  const wanted = new Set(shopKeys);
  const removed = currentKeys.filter((k) => !wanted.has(k));
  const added = shopKeys.filter((k) => !currentKeys.includes(k));

  // Nominal shop yang dikeluarkan ikut hilang (cascade). Isinya dibaca lebih dulu
  // supaya angkanya tetap ada di audit_logs — satu-satunya jalan pulih kalau shopnya
  // ternyata dikeluarkan karena salah klik (CLAUDE.md #2).
  let removedBudgets: unknown[] = [];
  if (removed.length > 0) {
    const { data: doomed } = await admin
      .from("bd_project_shop_budgets")
      .select("shop_key, ads_budget, service_fee")
      .eq("project_id", projectId)
      .in("shop_key", removed);
    removedBudgets = doomed ?? [];

    const { error: removeError } = await admin
      .from("bd_project_shops")
      .delete()
      .eq("project_id", projectId)
      .in("shop_key", removed);
    if (removeError) {
      return { ok: false, message: `Gagal menyimpan daftar shop: ${removeError.message}` };
    }
  }
  if (added.length > 0) {
    const { error: addError } = await admin
      .from("bd_project_shops")
      .insert(added.map((shop_key) => ({ project_id: projectId, shop_key })));
    if (addError) return { ok: false, message: `Gagal menyimpan daftar shop: ${addError.message}` };
  }

  await writeAudit({
    actorId: actor.id,
    action: isNew ? "bd_project.create" : "bd_project.update",
    entityType: "bd_projects",
    entityId: projectId,
    before: isNew ? null : { project: before, shop_keys: currentKeys },
    after: {
      id: projectId,
      ...record,
      shop_keys: shopKeys,
      ...(removed.length > 0 ? { shops_removed: removed, budgets_removed: removedBudgets } : {}),
    },
    // Menyusun pengelompokan tidak mengubah data deal mana pun → auto berlaku,
    // tetap ter-log lengkap (CLAUDE.md #2).
    type: "auto",
  });

  revalidatePath("/bd-projects");
  revalidatePath(`/bd-projects/${projectId}`);
  // Nominal shop yang ikut terhapus mengubah total shop di tab Deal Brand.
  if (removed.length > 0) revalidatePath("/deals");
  return {
    ok: true,
    message: isNew
      ? `Project "${d.name}" tersimpan dengan ${shopKeys.length} shop.`
      : `Project ${projectId} diperbarui (${shopKeys.length} shop).` +
        (removedBudgets.length > 0
          ? ` ${removedBudgets.length} shop yang dikeluarkan ikut kehilangan Ads Budget & Service Fee-nya (nilainya tercatat di audit log).`
          : ""),
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
 * Simpan Ads Budget & Service Fee satu shop DALAM satu project (tab Project BD).
 *
 * Kedua nominal itu milik PASANGAN (project, shop): DVARA di project "alya 2" dan
 * DVARA di project lain punya barisnya masing-masing di `bd_project_shop_budgets`,
 * jadi menyimpan di sini tidak pernah menyentuh nominal DVARA di project lain
 * (migrasi 0046). Tabel shop di tab Deal Brand menampilkan JUMLAH baris-baris itu
 * lintas project.
 *
 * Ini satu-satunya jalur entri kedua nominal: form Registrasi Deal, upload deal, form
 * Edit Produk TAP, dan form Edit shop di tab Deal Brand tidak lagi menyentuhnya.
 * Menulis lewat admin client karena RLS bd_project_shop_budgets = baca saja untuk
 * authenticated (0046); izinnya ditegakkan server lewat requirePermission.
 */
export async function updateProjectShopBudget(
  _prev: ProjectFormState | null,
  formData: FormData
): Promise<ProjectFormState> {
  const actor = await requirePermission("bd_project.manage");

  const projectId = String(formData.get("project_id") ?? "").trim();
  if (!projectId) return { ok: false, message: "Project tidak dikenali." };
  const shopKey = String(formData.get("shop_key") ?? "").trim();
  if (!shopKey) return { ok: false, message: "Shop tidak dikenali." };

  // Rupiah murni; "" = jangan ubah kolom itu. parseRupiah dipakai supaya tempelan
  // "Rp50.000.000" dari sheet lama ikut terbaca (CLAUDE.md #7).
  const parseMoney = (raw: string): { value?: number; error?: string } => {
    const v = raw.trim();
    if (!v) return {};
    const n = parseRupiah(v);
    if (n === null || n < 0) return { error: `"${v}" tidak terbaca sebagai angka Rupiah` };
    return { value: n };
  };
  const ads = parseMoney(String(formData.get("ads_budget") ?? ""));
  const fee = parseMoney(String(formData.get("service_fee") ?? ""));
  const fieldErrors: Record<string, string> = {};
  if (ads.error) fieldErrors.ads_budget = ads.error;
  if (fee.error) fieldErrors.service_fee = fee.error;
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "Periksa kembali nominal yang diisi.", fieldErrors };
  }
  if (ads.value === undefined && fee.value === undefined) {
    return { ok: false, message: "Isi Ads Budget dan/atau Service Fee yang mau disimpan." };
  }

  const admin = createAdminClient();

  // Shopnya harus benar-benar anggota project ini. Selain menjaga arti datanya, ini
  // memberi pesan yang jelas alih-alih membiarkan FK komposit (0046) gagal.
  const { data: member, error: memberError } = await admin
    .from("bd_project_shops")
    .select("shop_key")
    .eq("project_id", projectId)
    .eq("shop_key", shopKey)
    .maybeSingle();
  if (memberError) return { ok: false, message: `Gagal memeriksa shop: ${memberError.message}` };
  if (!member) {
    return {
      ok: false,
      message:
        `Shop "${shopKey}" bukan anggota project ${projectId} (mungkin baru dikeluarkan atau ` +
        "Shop Name-nya berganti). Muat ulang halaman, lalu pilih shopnya lewat Edit Project.",
    };
  }

  const { data: existing, error: readError } = await admin
    .from("bd_project_shop_budgets")
    .select("ads_budget, service_fee")
    .eq("project_id", projectId)
    .eq("shop_key", shopKey)
    .maybeSingle();
  if (readError) return { ok: false, message: `Gagal membaca nominal shop: ${readError.message}` };

  const numeric = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const before = existing
    ? { ads_budget: numeric(existing.ads_budget), service_fee: numeric(existing.service_fee) }
    : null;

  const merged = mergeShopBudget(before, { ads_budget: ads.value, service_fee: fee.value });
  if (merged === null) {
    return { ok: true, message: "Tidak ada yang berubah — nominal shop ini di project ini sudah sesuai." };
  }

  const { error: writeError } = await admin.from("bd_project_shop_budgets").upsert(
    {
      project_id: projectId,
      shop_key: shopKey,
      ...merged,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id,shop_key" }
  );
  if (writeError) return { ok: false, message: `Gagal menyimpan nominal: ${writeError.message}` };

  await writeAudit({
    actorId: actor.id,
    action: "bd_project.shop_budget_update",
    entityType: "bd_project_shop_budgets",
    entityId: `${projectId}|${shopKey}`,
    before,
    after: { project_id: projectId, shop_key: shopKey, ...merged },
    // Mengelola nominal deal tidak merugikan perusahaan → auto berlaku, tetap
    // terekam penuh before/after (CLAUDE.md #2).
    type: "auto",
  });

  revalidatePath("/bd-projects");
  revalidatePath(`/bd-projects/${projectId}`);
  // Total shop di tab Deal Brand = jumlah nominal ini lintas project.
  revalidatePath("/deals");

  const done: string[] = [];
  if (ads.value !== undefined) done.push("Ads Budget");
  if (fee.value !== undefined) done.push("Service Fee");
  return {
    ok: true,
    message: `${done.join(" & ")} shop ini disimpan untuk project ${projectId} saja — nominal shop yang sama di project lain tidak berubah.`,
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
    .select("id, name, status, status_payment, notes, created_by, created_at")
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

  const [{ data: shops }, { data: budgets }, { data: sessions }, { data: proposals }] =
    await Promise.all([
      admin.from("bd_project_shops").select("shop_key").eq("project_id", projectId),
      // Nominal per shop ikut terhapus lewat cascade (0046) — angkanya harus terekam
      // sebelum hilang, sama seperti report campaignnya.
      admin
        .from("bd_project_shop_budgets")
        .select("shop_key, ads_budget, service_fee")
        .eq("project_id", projectId),
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
    before: { project, shops, budgets, sessions, proposals },
    after: null,
    type: "auto",
  });

  revalidatePath("/bd-projects");
  // Nominal project yang terhapus mengubah total shop di tab Deal Brand.
  revalidatePath("/deals");
  return { ok: true, message: `Project "${project.name}" dihapus (tercatat di audit log).` };
}
