"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChangePasswordButton } from "@/components/change-password-button";
import { logout } from "@/app/login/actions";
import { NAV_ICON_PATHS, activeNavHref } from "@/lib/nav-ui";

export interface SidebarItem {
  href: string;
  label: string;
  /** Angka notifikasi (mis. request penugasan CM menunggu). 0 = tidak dirender. */
  badge?: number;
  /** Tooltip badge, dipakai juga saat sidebar diciutkan. */
  badgeTitle?: string;
}

export interface SidebarGroup {
  label: string;
  items: SidebarItem[];
}

const STORAGE_KEY = "mcn.sidebar.collapsed";

function NavIcon({ href }: { href: string }) {
  const d = NAV_ICON_PATHS[href];
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5 shrink-0"
    >
      {d ? <path d={d} /> : <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

/**
 * Sidebar portal internal: biru dongker, teks putih, bisa diciutkan jadi rel ikon,
 * dan menu dikelompokkan per divisi (grup dari NAV_GROUPS di lib/rbac).
 *
 * Filter RBAC tetap di server (layout memanggil canAccessNav) — komponen ini hanya
 * merender grup yang sudah lolos, jadi menciutkan/melebarkan tidak pernah menambah
 * akses. Pilihan ciut disimpan di localStorage per-browser; nilai awal SELALU
 * "melebar" supaya render server & klien identik (tidak hydration-mismatch), lalu
 * preferensi tersimpan dibaca setelah mount.
 */
export function PortalSidebar({
  groups,
  memberName,
  roleLabel,
}: {
  groups: SidebarGroup[];
  memberName: string;
  roleLabel: string;
}) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage diblokir → tetap pakai tampilan melebar.
    }
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preferensi gagal disimpan bukan alasan membatalkan perubahan tampilan.
      }
      return next;
    });
  }

  const active = activeNavHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href))
  );
  const initials = memberName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={`flex ${collapsed ? "w-16" : "w-64"} shrink-0 flex-col bg-[#0b1f47] text-white transition-[width] duration-200`}
    >
      <div
        className={`flex items-center gap-2 border-b border-white/10 p-4 ${collapsed ? "justify-center" : "justify-between"}`}
      >
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">MCN MEA</p>
            <p className="truncate text-xs text-white/60">Team Portal</p>
          </div>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Lebarkan menu" : "Ciutkan menu"}
          title={collapsed ? "Lebarkan menu" : "Ciutkan menu"}
          className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-5 w-5"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={collapsed ? "M13.5 9.5L16 12l-2.5 2.5" : "M16.5 9.5L14 12l2.5 2.5"} />
          </svg>
        </button>
      </div>

      <nav className={`flex-1 overflow-y-auto ${collapsed ? "px-2 py-3" : "p-3"}`}>
        {groups.map((group, index) => (
          <div key={group.label} className={index === 0 ? "" : collapsed ? "mt-3 border-t border-white/10 pt-3" : "mt-4"}>
            {!collapsed && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = active === item.href;
                const badge = item.badge ?? 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    // Saat diciutkan, label hanya tersedia sebagai tooltip — grupnya
                    // ikut disebut supaya konteksnya tidak hilang.
                    title={collapsed ? `${group.label} — ${item.label}` : item.label}
                    className={`relative flex items-center ${collapsed ? "justify-center px-2" : "gap-3 px-3"} rounded-md py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-white/15 font-medium text-white"
                        : "text-white/75 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <NavIcon href={item.href} />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {badge > 0 && (
                      <span
                        title={item.badgeTitle}
                        className={
                          collapsed
                            ? "absolute right-1 top-1 min-w-4 rounded-full bg-sky-400 px-1 text-center text-[10px] font-semibold leading-4 text-[#0b1f47]"
                            : "rounded-full bg-sky-400 px-2 py-0.5 text-xs font-semibold text-[#0b1f47]"
                        }
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={`border-t border-white/10 ${collapsed ? "flex flex-col items-center gap-2 p-2" : "p-4"}`}>
        {collapsed ? (
          <>
            <span
              title={`${memberName} — ${roleLabel}`}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
            >
              {initials || "?"}
            </span>
            <form action={logout}>
              <button
                type="submit"
                title="Keluar"
                aria-label="Keluar"
                className="rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-5 w-5"
                >
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="truncate text-sm font-medium">{memberName}</p>
            <p className="truncate text-xs text-white/60">{roleLabel}</p>
            <div className="mt-3">
              <ChangePasswordButton className="text-xs text-white/70 underline hover:text-white" />
            </div>
            <form action={logout} className="mt-2">
              <button type="submit" className="text-xs text-white/70 underline hover:text-white">
                Keluar
              </button>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}
