"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BrandRow } from "@/lib/deals/brand-table";

const STORAGE_KEY = "deals.brandTable.columns";

const rupiah = (n: number | null) => (n === null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);
const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  reguler: { label: "Reguler", cls: "bg-slate-100 text-slate-700" },
  running_1st_month: { label: "Running Bulan Pertama", cls: "bg-blue-100 text-blue-800" },
  retention: { label: "Retention", cls: "bg-green-100 text-green-800" },
  hold: { label: "Hold", cls: "bg-amber-100 text-amber-800" },
  stop: { label: "Stop", cls: "bg-red-100 text-red-700" },
};
const PRIORITY_CLS: Record<string, string> = {
  P0: "bg-red-100 text-red-700",
  P1: "bg-amber-100 text-amber-800",
  P2: "bg-slate-100 text-slate-700",
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};
const SUPPORT_LABEL: Record<string, string> = { sample: "Sample", flash_sale: "Flash Sale", ads: "Ads" };

const Badge = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
);
const Dash = () => <span className="text-slate-400">—</span>;
const ExtLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={/^https?:\/\//i.test(href) ? href : `https://${href}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 hover:underline">
    {children}
  </a>
);

function countdownBadge(days: number | null) {
  if (days === null) return <Dash />;
  if (days < 0) return <Badge cls="bg-red-100 text-red-700">lewat {-days} hari</Badge>;
  const cls = days <= 14 ? "bg-red-100 text-red-700" : days <= 30 ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
  return <Badge cls={cls}>{days} hari</Badge>;
}

interface Column {
  key: string;
  label: string;
  /** false = tersembunyi sampai dipilih di menu Kolom. */
  defaultVisible: boolean;
  align?: "right";
  render: (r: BrandRow) => React.ReactNode;
}

const COLUMNS: Column[] = [
  {
    key: "bizdev", label: "Bizdev", defaultVisible: true,
    render: (r) => (r.bizdev.length ? r.bizdev.join(", ") : <span className="text-slate-400">Non BD Handle</span>),
  },
  {
    key: "status", label: "Status", defaultVisible: true,
    render: (r) => {
      if (!r.status) return <Dash />;
      const s = STATUS_STYLE[r.status];
      return <Badge cls={s?.cls ?? "bg-slate-100 text-slate-700"}>{s?.label ?? r.status}</Badge>;
    },
  },
  { key: "niche", label: "Niche", defaultVisible: true, render: (r) => r.niche ?? <Dash /> },
  { key: "link", label: "Link Toko", defaultVisible: true, render: (r) => (r.brandLink ? <ExtLink href={r.brandLink}>Buka toko</ExtLink> : <Dash />) },
  { key: "shop_id", label: "Shop ID", defaultVisible: true, render: (r) => <span className="font-mono text-xs">{r.shopId ?? "—"}</span> },
  { key: "contact", label: "Contact PIC Brand", defaultVisible: true, render: (r) => r.contactPic ?? <Dash /> },
  {
    key: "grup", label: "Grup Brand", defaultVisible: true,
    render: (r) => (!r.grup ? <Dash /> : /chat\.whatsapp\.com|wa\.me|^https?:/i.test(r.grup) ? <ExtLink href={r.grup}>Grup WA</ExtLink> : r.grup),
  },
  { key: "gmv", label: "GMV TAP", defaultVisible: true, align: "right", render: (r) => rupiah(r.gmvTap) },
  { key: "avg_price", label: "Avg Harga Produk", defaultVisible: true, align: "right", render: (r) => rupiah(r.avgPrice) },
  {
    key: "support", label: "Sample / Flash Sale / Ads", defaultVisible: true,
    render: (r) =>
      r.supportTypes.length ? (
        <span className="flex flex-wrap gap-1">
          {r.supportTypes.map((s) => <Badge key={s} cls="bg-indigo-50 text-indigo-700">{SUPPORT_LABEL[s] ?? s}</Badge>)}
        </span>
      ) : <Dash />,
  },
  { key: "ads_brand", label: "Ads Brand", defaultVisible: true, render: (r) => (r.adsBrand ? <Badge cls="bg-purple-50 text-purple-700">{r.adsBrand}</Badge> : <Dash />) },
  { key: "leads", label: "Leads", defaultVisible: true, render: (r) => r.leadsType ?? <Dash /> },
  {
    key: "priority", label: "Priority", defaultVisible: true,
    render: (r) => (r.priority ? <Badge cls={PRIORITY_CLS[r.priority] ?? PRIORITY_CLS[r.priority.toLowerCase()] ?? "bg-slate-100 text-slate-700"}>{r.priority}</Badge> : <Dash />),
  },
  {
    key: "working_sheet", label: "Working Sheet", defaultVisible: true,
    render: (r) => (r.workingSheet ? <ExtLink href={r.workingSheet}><span title="Buka working sheet">📄</span></ExtLink> : <Dash />),
  },
  { key: "ops", label: "Campaign Ops", defaultVisible: true, render: (r) => r.campaignOps ?? <span className="text-slate-400">Non Campaign Ops</span> },
  { key: "campaign_name", label: "Campaign Name", defaultVisible: true, render: (r) => r.campaignName ?? <Dash /> },
  { key: "campaign_id", label: "Campaign ID", defaultVisible: true, render: (r) => <span className="font-mono text-xs">{r.campaignId ?? "—"}</span> },
  { key: "exp_date", label: "Exp Date", defaultVisible: true, render: (r) => <span className="whitespace-nowrap">{fmtDate(r.expDate)}</span> },
  { key: "countdown", label: "Countdown", defaultVisible: true, render: (r) => countdownBadge(r.countdown) },
  { key: "shop_code", label: "Shop Code", defaultVisible: true, render: (r) => <span className="font-mono text-xs">{r.shopCode ?? "—"}</span> },
  { key: "platform", label: "Platform", defaultVisible: false, render: (r) => r.platform ?? <Dash /> },
];

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
}

/**
 * Tabel Deal Brand per brand. Data (satu halaman) sudah disaring & dipaginasi di server;
 * komponen ini hanya merender dan mengatur kolom yang tampil (disimpan di localStorage
 * per browser — preferensi tampilan, bukan data).
 */
export function BrandTableView({ rows, offset }: { rows: BrandRow[]; offset: number }) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.key)));
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (Array.isArray(saved)) setVisible(new Set(saved.filter((k): k is string => typeof k === "string")));
    } catch {
      /* storage tidak tersedia → kolom bawaan */
    }
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const toggle = (key: string) => {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisible(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* abaikan */
    }
  };
  const cols = COLUMNS.filter((c) => visible.has(c.key));

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Kolom ({cols.length + 2})
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 max-h-96 w-64 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 shadow-lg">
              {COLUMNS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Nama Brand</th>
              {cols.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 ${c.align === "right" ? "text-right" : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 2} className="px-3 py-8 text-center text-slate-500">
                  Tidak ada brand yang cocok dengan pencarian/filter.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-400">{offset + i + 1}</td>
                <td className="sticky left-0 z-10 bg-white px-3 py-2">
                  <Link href={`/deals/${r.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:underline">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
                      {initials(r.brandName)}
                    </span>
                    <span className="whitespace-nowrap">{r.brandName}</span>
                  </Link>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-middle ${c.align === "right" ? "whitespace-nowrap text-right tabular-nums" : ""}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
