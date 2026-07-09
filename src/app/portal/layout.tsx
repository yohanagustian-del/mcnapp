import Link from "next/link";
import { requireCreator } from "@/lib/m9/creator-auth";
import { logout } from "@/app/login/actions";

const CREATOR_NAV = [
  { href: "/portal", label: "Performa Saya" },
  { href: "/portal/agency-plan", label: "Agency Plan" },
  { href: "/portal/reports", label: "Report Saya" },
  { href: "/portal/requests", label: "Request Brand/Ads" },
  { href: "/portal/projects", label: "Special Project" },
  { href: "/portal/complaints", label: "Komplain & Feedback" },
];

/** M9 external shell — deliberately separate from the internal /workspace layout: no internal nav. */
export default async function CreatorPortalLayout({ children }: { children: React.ReactNode }) {
  const creator = await requireCreator();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-lg font-semibold">MCN MEA</p>
          <p className="text-xs text-slate-500">Portal Kreator</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {CREATOR_NAV.map((item) => (
            <Link key={item.href} href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate text-xs text-slate-500">{creator.email}</p>
          <form action={logout}>
            <button className="mt-2 text-sm text-slate-600 hover:text-slate-900">Keluar</button>
          </form>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-6">{children}</main>
    </div>
  );
}
