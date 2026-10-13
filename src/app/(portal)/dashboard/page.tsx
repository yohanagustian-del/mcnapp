import Link from "next/link";
import { requireMember, MANAGEMENT_ROLES, NAV_ITEMS, canAccessNav } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const member = await requireMember();
  const supabase = await createClient();

  const [{ count: creatorCount }, { count: dealCount }, { count: memberCount }] =
    await Promise.all([
      supabase.from("creators").select("id", { count: "exact", head: true }),
      supabase.from("brand_deals").select("id", { count: "exact", head: true }),
      supabase.from("team_members").select("id", { count: "exact", head: true }),
    ]);

  const isManagement = MANAGEMENT_ROLES.includes(member.role);
  // Pintasan ke workspace yang boleh dibuka role ini — dibaca dari NAV_ITEMS (satu sumber
  // RBAC menu), bukan daftar kedua.
  const workspaces = NAV_ITEMS.filter(
    (item) => item.href.startsWith("/workspace/") && canAccessNav(item, member.role),
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dasbor</h1>
      <p className="mt-1 text-sm text-slate-500">
        Selamat datang, {member.name}.{" "}
        {isManagement ? "Anda melihat data lintas tim." : "Anda melihat data sesuai scope Anda."}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Kreator" value={creatorCount ?? 0} />
        <StatCard label="Deal Brand" value={dealCount ?? 0} />
        <StatCard label="Anggota Tim" value={memberCount ?? 0} />
      </div>

      {workspaces.length > 0 && (
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p className="font-medium text-slate-800">Workspace Anda</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {workspaces.map((w) => (
              <li key={w.href}>
                <Link
                  href={w.href}
                  className="inline-block rounded-md border border-slate-200 px-3 py-1.5 hover:bg-slate-50"
                >
                  {w.label} <span className="text-blue-600">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString("id-ID")}</p>
    </div>
  );
}
