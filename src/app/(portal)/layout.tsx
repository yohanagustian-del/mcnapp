import Link from "next/link";
import { requireMember, NAV_ITEMS, canAccessNav } from "@/lib/rbac";
import { logout } from "@/app/login/actions";

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

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-lg font-semibold">MCN MEA</p>
          <p className="text-xs text-slate-500">Team Portal</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-medium">{member.name}</p>
          <p className="truncate text-xs text-slate-500">
            {ROLE_LABELS[member.role] ?? member.role}
          </p>
          <form action={logout} className="mt-3">
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
