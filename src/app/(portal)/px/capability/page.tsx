import Link from "next/link";
import { redirect } from "next/navigation";
import { canAccessNav, hasPermission, NAV_ITEMS, requireMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAPABILITY_LIST_LIMIT, listCapabilityRows, listCoverage } from "@/lib/px/capability-data";
import { CapabilityRegistryTable } from "./registry-table";
import { CoverageTable } from "./coverage-table";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "registry", label: "Registry" },
  { key: "coverage", label: "Coverage" },
] as const;

/**
 * PX-M1 — Kapasitas Kreator. Dua tab lewat query param `?tab=` (server-rendered,
 * tidak butuh state klien untuk berpindah tab): Registry (editable, per-baris
 * kapasitas) dan Coverage (read-only, agregat bridge.px_coverage_map()).
 *
 * Baca/tulis SELALU lewat createAdminClient() memanggil RPC `public.px_capability_*`
 * (lihat src/lib/px/capability-data.ts) — bridge.px_creator_capability sendiri
 * tidak pernah disentuh langsung dari kode ini.
 */
export default async function CapabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/px/capability")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");
  if (!hasPermission("px.capability.read", member.role)) redirect("/dashboard");

  const canWrite = hasPermission("px.capability.write", member.role);
  const { tab: tabParam } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "registry";

  const admin = createAdminClient();

  let registryRows: Awaited<ReturnType<typeof listCapabilityRows>> = [];
  let registryError: string | null = null;
  let coverageRows: Awaited<ReturnType<typeof listCoverage>> = [];
  let coverageError: string | null = null;

  if (tab === "registry") {
    try {
      // CPM hanya melihat kreator sendiri di layar (K4) — penolakan di server
      // action adalah pagar, bukan pengalaman sehari-hari (surat tugas Langkah 5).
      let scopedCreatorIds: string[] | null = null;
      if (member.role === "cpm") {
        const { data: owned } = await admin.from("creators").select("id").eq("owner_cpm_id", member.id);
        scopedCreatorIds = (owned ?? []).map((c) => c.id as string);
      }
      registryRows = await listCapabilityRows(admin, scopedCreatorIds);
    } catch (e) {
      registryError = e instanceof Error ? e.message : "Gagal memuat registry kapasitas";
    }
  } else {
    try {
      coverageRows = await listCoverage(admin, null);
    } catch (e) {
      coverageError = e instanceof Error ? e.message : "Gagal memuat coverage";
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">Kapasitas Kreator (Product Exchange)</h1>
      <p className="mt-1 text-sm text-slate-500">
        Peta kapasitas — berapa banyak match aktif bersamaan yang sanggup ditangani tiap kreator per
        kategori × segmen harga, di atas riwayat penjualan yang sudah terbukti (<em>proven_gmv</em>{" "}
        dari data platform mingguan). Slot Total diisi CPM yang memegang kreatornya (atau CM
        Lead/Management lintas tim); <em>Slot Terisi</em> akan mulai terisi otomatis setelah modul
        Matching (M5) berjalan — hari ini selalu 0.
      </p>

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/px/capability?tab=${t.key}`}
            className={`rounded-t-md px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border border-b-0 border-slate-200 bg-white text-slate-900"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-4">
        {tab === "registry" ? (
          registryError ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{registryError}</p>
          ) : (
            <CapabilityRegistryTable
              rows={registryRows}
              canWrite={canWrite}
              limitHit={registryRows.length >= CAPABILITY_LIST_LIMIT}
            />
          )
        ) : coverageError ? (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{coverageError}</p>
        ) : (
          <CoverageTable rows={coverageRows} />
        )}
      </div>
    </div>
  );
}
