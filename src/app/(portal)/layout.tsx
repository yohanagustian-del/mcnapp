import Link from "next/link";
import { requireMember, NAV_ITEMS, canAccessNav, hasPermission } from "@/lib/rbac";
import { countPendingCmRequests } from "@/lib/creators/cm-requests";
import { logout } from "@/app/login/actions";
import { ChangePasswordButton } from "@/components/change-password-button";

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  head: "Head MCN",
  spv: "SPV MCN",
  cm_lead: "CM Lead",
  cpm: "CPM",
  bizdev_lead: "BizDev Lead",
  bizdev: "BizDev",
  campaign_ops: "Campaign Operations",
  bd_admin: "BD Administrator",
  acquisition_lead: "Acquisition Lead",
  acquisition_spec: "Acquisition Specialist",
  campaign_external: "Campaign External",
  creator_support: "Creator Support",
  finance: "Finance",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  const navItems = NAV_ITEMS.filter((item) => canAccessNav(item, member.role));

  // Notifikasi request penugasan CM: yang boleh MEMUTUSKAN (Director/Head/SPV/CM
  // Lead) melihat jumlah antrean langsung di menu Kreator, jadi request tidak
  // menunggu berhari-hari hanya karena tidak ada yang membuka halamannya.
  // Antreannya sendiri (terima/tolak) ada di panel "Request penugasan CM" di /creators.
  const pendingCmRequests = hasPermission("creators.decide_cm_request", member.role)
    ? await countPendingCmRequests()
    : 0;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-lg font-semibold">MCN MEA</p>
          <p className="text-xs text-slate-500">Team Portal</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => {
            const badge = item.href === "/creators" ? pendingCmRequests : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              >
                <span>{item.label}</span>
                {badge > 0 && (
                  <span
                    title={`${badge} request penugasan CM menunggu keputusan Anda`}
                    className="rounded-full bg-sky-600 px-2 py-0.5 text-xs font-semibold text-white"
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium">{member.name}</p>
          <p className="truncate text-xs text-slate-500">
            {ROLE_LABELS[member.role] ?? member.role}
          </p>
          <div className="mt-3">
            <ChangePasswordButton className="text-xs text-slate-500 underline hover:text-slate-800" />
          </div>
          <form action={logout} className="mt-2">
            <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-800">
              Keluar
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
