import { requireMember, NAV_ITEMS, NAV_GROUPS, canAccessNav, hasPermission } from "@/lib/rbac";
import { countPendingCmRequests } from "@/lib/creators/cm-requests";
import { PortalSidebar, type SidebarGroup } from "@/components/portal-sidebar";

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

  // Pengelompokan menu per divisi. Filter RBAC sudah dilakukan di atas, jadi grup
  // yang seluruh itemnya tidak boleh diakses role ini tidak ikut dirender.
  const groups: SidebarGroup[] = NAV_GROUPS.map((group) => ({
    label: group,
    items: navItems
      .filter((item) => item.group === group)
      .map((item) => ({
        href: item.href,
        label: item.label,
        badge: item.href === "/creators" ? pendingCmRequests : 0,
        badgeTitle:
          item.href === "/creators"
            ? `${pendingCmRequests} request penugasan CM menunggu keputusan Anda`
            : undefined,
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex min-h-screen">
      <PortalSidebar
        groups={groups}
        memberName={member.name}
        roleLabel={ROLE_LABELS[member.role] ?? member.role}
      />
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
