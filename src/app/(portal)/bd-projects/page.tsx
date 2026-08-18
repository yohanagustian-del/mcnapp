import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, canAccessNav, NAV_ITEMS, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { sumProjectShops, type ProjectShopMetrics } from "@/lib/deals/bd-project";
import { ProjectFormButton, type ShopOption } from "./project-form-button";
import { ProjectsTable, type ProjectRow } from "./projects-table";

/** numeric/bigint hasil agregasi bisa datang sebagai string tergantung driver. */
function numeric(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Tab Project BD — daftar project (beberapa brand/shop digarap sebagai satu campaign).
 *
 * Nama, status, & daftar shop dibaca dari `bd_projects` + `bd_project_shops`; jumlah
 * kartu, campaign, GMV, dan exp date dari view `deal_shop_summary` — view yang sama
 * dengan tabel "Shop" di tab Deal Brand. Ads Budget & Service Fee dibaca dari
 * `bd_project_shop_budgets` untuk MASING-MASING project (0046), bukan dari view yang
 * menjumlahkannya lintas project.
 *
 * Agregasi per shop dikerjakan SQL; yang dilakukan di sini hanya menjumlahkan baris
 * shop milik tiap project (paling banyak sepuluhan baris per project).
 */
export default async function BdProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/bd-projects")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");
  const canManage = hasPermission("bd_project.manage", member.role);

  const { q } = await searchParams;
  const supabase = await createClient();

  let projectQuery = supabase
    .from("bd_projects")
    .select("id, name, status, status_payment, notes, created_by, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (q?.trim()) projectQuery = projectQuery.ilike("name", `%${q.trim()}%`);

  // Daftar shop untuk PILIHAN form Tambah/Edit project (perlu daftar luas). Ringkasan
  // shop ANGGOTA project dibaca terpisah di bawah, difilter di SQL: kalau ikut disaring
  // dari daftar ini, shop yang belum punya kartu (deal saja) bisa terpotong batas dan
  // anggota project terbaca "hilang" hanya karena daftarnya kepanjangan.
  const [{ data: projects, error: projectError }, { data: pickerShops, error: shopError }] =
    await Promise.all([
      projectQuery,
      supabase
        .from("deal_shop_summary")
        .select("shop_key, shop_name, shop_id, product_count")
        .order("product_count", { ascending: false })
        .order("deal_count", { ascending: false })
        .order("shop_key", { ascending: true })
        .limit(500),
    ]);

  const shopOptions: ShopOption[] = (pickerShops ?? []).map((s) => ({
    shop_key: s.shop_key as string,
    shop_name: (s.shop_name as string | null) ?? null,
    shop_id: (s.shop_id as string | null) ?? null,
    product_count: numeric(s.product_count) ?? 0,
  }));

  const projectIds = (projects ?? []).map((p) => p.id as string);
  const shopKeysByProject = new Map<string, string[]>();
  // Nominal per (project, shop): kuncinya "projectId|shopKey" karena shop yang sama
  // bisa punya angka berbeda di tiap project (0046).
  const budgetByProjectShop = new Map<string, { ads_budget: number | null; service_fee: number | null }>();
  // Ringkasan shop anggota, dikunci ke shop yang benar-benar dipakai project di halaman
  // ini (bukan hasil saring daftar picker di atas).
  const summaryByKey = new Map<string, ProjectShopMetrics & { shop_name: string | null }>();
  if (projectIds.length > 0) {
    const [{ data: links }, { data: budgets }] = await Promise.all([
      supabase.from("bd_project_shops").select("project_id, shop_key").in("project_id", projectIds),
      supabase
        .from("bd_project_shop_budgets")
        .select("project_id, shop_key, ads_budget, service_fee")
        .in("project_id", projectIds),
    ]);
    for (const l of links ?? []) {
      const list = shopKeysByProject.get(l.project_id as string) ?? [];
      list.push(l.shop_key as string);
      shopKeysByProject.set(l.project_id as string, list);
    }
    for (const b of budgets ?? []) {
      budgetByProjectShop.set(`${b.project_id as string}|${b.shop_key as string}`, {
        ads_budget: numeric(b.ads_budget),
        service_fee: numeric(b.service_fee),
      });
    }

    const memberKeys = [...new Set([...shopKeysByProject.values()].flat())];
    if (memberKeys.length > 0) {
      const { data: memberShops } = await supabase
        .from("deal_shop_summary")
        .select(
          "shop_key, shop_name, product_count, active_count, needs_review_count, campaign_count, gmv_tap, effective_start, effective_end"
        )
        .in("shop_key", memberKeys);
      for (const s of memberShops ?? []) {
        summaryByKey.set(s.shop_key as string, {
          shop_name: (s.shop_name as string | null) ?? null,
          product_count: numeric(s.product_count) ?? 0,
          active_count: numeric(s.active_count) ?? 0,
          needs_review_count: numeric(s.needs_review_count) ?? 0,
          campaign_count: numeric(s.campaign_count) ?? 0,
          // Nominalnya ditempelkan per project di bawah: satu shop bisa dipakai
          // beberapa project dengan angka berbeda.
          ads_budget: null,
          service_fee: null,
          gmv_tap: numeric(s.gmv_tap),
          effective_start: (s.effective_start as string | null) ?? null,
          effective_end: (s.effective_end as string | null) ?? null,
        });
      }
    }
  }

  // created_by disimpan sebagai uuid; namanya di-join di aplikasi karena
  // team_members cuma puluhan baris (pola yang sama dipakai tab Deal Brand).
  const memberNameById = new Map<string, string>();
  if ((projects ?? []).length > 0) {
    const { data: memberRows } = await supabase.from("team_members").select("id, name");
    for (const m of memberRows ?? []) memberNameById.set(m.id as string, m.name as string);
  }

  const rows: ProjectRow[] = (projects ?? []).map((p) => {
    const projectId = p.id as string;
    const keys = shopKeysByProject.get(projectId) ?? [];
    // Nominal ditempelkan per project sebelum dijumlah: angka yang tampil di baris
    // project ini adalah miliknya sendiri, bukan total shop lintas project (0046).
    const found = keys
      .map((k) => {
        const summary = summaryByKey.get(k);
        if (!summary) return undefined;
        const budget = budgetByProjectShop.get(`${projectId}|${k}`);
        return {
          ...summary,
          ads_budget: budget?.ads_budget ?? null,
          service_fee: budget?.service_fee ?? null,
        };
      })
      .filter((s) => s !== undefined);
    const totals = sumProjectShops(found);
    return {
      id: projectId,
      name: p.name as string,
      status: (p.status as string | null) ?? null,
      status_payment: (p.status_payment as string | null) ?? null,
      created_at: (p.created_at as string | null) ?? null,
      created_by_name: memberNameById.get((p.created_by as string) ?? "") ?? null,
      shop_names: found.map((s) => s.shop_name).filter((n): n is string => !!n),
      missing_shops: keys.length - found.length,
      // shop_count = anggota yang tercatat, termasuk yang kuncinya sudah tidak
      // ketemu — kalau tidak, project yang shop-nya berganti nama akan terlihat
      // menyusut sendiri tanpa penjelasan.
      shop_count: keys.length,
      product_count: totals.product_count,
      campaign_count: totals.campaign_count,
      ads_budget: totals.ads_budget,
      service_fee: totals.service_fee,
      gmv_tap: totals.gmv_tap,
      effective_end: totals.effective_end,
    };
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Project BD</h1>
          <p className="mt-1 text-sm text-slate-500">
            Beberapa brand/shop yang digarap sebagai satu campaign. Klik baris untuk melihat detail
            project.
          </p>
        </div>
        {canManage && <ProjectFormButton shops={shopOptions} />}
      </div>

      <form method="get" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari nama project…"
          className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-md bg-slate-100 px-4 py-2 text-sm hover:bg-slate-200">
          Cari
        </button>
        {q && (
          <Link href="/bd-projects" className="self-center text-sm text-slate-500 underline">
            Reset
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-slate-400">
        Jumlah kartu, campaign, GMV, dan exp date dibaca dari kartu Produk TAP milik shop yang
        dipilih — sumber yang sama dengan tabel <strong>Shop</strong> di tab Deal Brand, jadi
        memperbaiki kartunya otomatis memperbaiki angka di sini. <strong>Ads Budget</strong> &amp;{" "}
        <strong>Service Fee</strong> adalah nominal <strong>project ini sendiri</strong> (diisi per
        shop di halaman detail project); shop yang dipakai beberapa project punya angka terpisah di
        masing-masing project.
      </p>

      {(projectError || shopError) && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Gagal memuat data: {projectError?.message ?? shopError?.message}
        </p>
      )}

      <div className="mt-2">
        <ProjectsTable
          rows={rows}
          emptyMessage={
            q
              ? `Tidak ada project cocok dengan "${q}".`
              : "Belum ada project. Buat lewat tombol + Tambah Project."
          }
        />
      </div>
    </div>
  );
}
