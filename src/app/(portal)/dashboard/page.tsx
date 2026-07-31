import Link from "next/link";
import { requireMember, MANAGEMENT_ROLES, hasPermission } from "@/lib/rbac";
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
  const canManageAccounts = hasPermission("m11.manage_accounts", member.role);

  // Usulan OD yang menunggu keputusan Director — ditampilkan di dasbor supaya tidak
  // menumpuk tanpa terlihat.
  const { count: pendingProposals } = canManageAccounts
    ? await supabase
        .from("member_change_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
    : { count: 0 };

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

      {canManageAccounts && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-slate-800">Manajemen User</p>
              <p className="mt-1 text-sm text-slate-600">
                Tambah anggota, ganti jabatan, nonaktifkan, atau hapus permanen.
                {(pendingProposals ?? 0) > 0 && (
                  <span className="ml-1 font-medium text-amber-700">
                    {pendingProposals} usulan OD menunggu keputusan Anda.
                  </span>
                )}
              </p>
            </div>
            <Link
              href="/tim"
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
            >
              Buka Halaman Tim
            </Link>
          </div>
        </div>
      )}

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Status Fase 0</p>
        <p className="mt-1">
          Fondasi platform aktif: schema M1–M8, RBAC/RLS, upload tim & kreator, registrasi deal,
          dan importer master deal lama. Module berikutnya (M4 Link Leakage, M2 Report) menyusul di Fase 1.
        </p>
      </div>
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
