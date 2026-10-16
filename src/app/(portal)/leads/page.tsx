import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember, hasPermission, canAccessNav, NAV_ITEMS } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { fetchAllIn } from "@/lib/supabase/fetch-all";
import {
  BRAND_LEAD_STATUS_LABELS,
  BRAND_LEAD_SUPPORT_LABELS,
  brandLeadSearchPatterns,
  escapeLike,
  type BrandLeadStatus,
  type BrandLeadSupport,
} from "@/lib/leads/brand-lead";
import { LeadForm } from "./lead-form";
import { createLead } from "./actions";
import { BulkUploadPanel } from "./bulk-upload-panel";

const STATUS_COLORS: Record<string, string> = {
  baru: "bg-slate-100 text-slate-700",
  kontak: "bg-blue-100 text-blue-700",
  nego: "bg-amber-100 text-amber-700",
  deal: "bg-green-100 text-green-700",
  batal: "bg-red-100 text-red-700",
};

const PAGE_SIZES = [10, 20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

// Sortable columns → DB column. Contact PIC & Dukungan are derived/array fields, so not sortable.
const SORT_COLUMNS: Record<string, string> = {
  shop_name: "shop_name",
  business_category: "business_category",
  bizdev_names: "bizdev_names",
  ads_scheme: "ads_scheme",
  source: "source",
  status: "status",
  created_at: "created_at",
};

type LeadRow = {
  id: string;
  source: string;
  shop_name: string | null;
  business_category: string | null;
  bizdev_names: string | null;
  brand_support: string[] | null;
  ads_scheme: string | null;
  status: string;
  created_at: string;
  converted_deal_id: string | null;
};
type ContactRow = { lead_id: string; lead_name: string | null; phone: string | null; email: string | null; sort_order: number };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string; upload?: string; q?: string; niche?: string; bd?: string; sort?: string; dir?: string; size?: string; page?: string }>;
}) {
  const member = await requireMember();
  const navItem = NAV_ITEMS.find((n) => n.href === "/leads")!;
  if (!canAccessNav(navItem, member.role)) redirect("/dashboard");

  const { status: statusFilter, new: showNew, upload: showUpload, q, niche, bd, sort, dir, size, page } = await searchParams;
  const sortKey = sort && SORT_COLUMNS[sort] ? sort : "created_at";
  const sortDir: "asc" | "desc" = dir === "asc" ? "asc" : dir === "desc" ? "desc" : sortKey === "created_at" ? "desc" : "asc";
  const pageSize = (PAGE_SIZES as readonly number[]).includes(Number(size)) ? Number(size) : DEFAULT_PAGE_SIZE;
  const pageNo = Math.max(1, Math.floor(Number(page)) || 1);
  const from = (pageNo - 1) * pageSize;
  const canCreate = hasPermission("leads.create", member.role);

  const supabase = await createClient();
  let query = supabase
    .from("brand_leads")
    .select("id, source, shop_name, business_category, bizdev_names, brand_support, ads_scheme, status, created_at, converted_deal_id", {
      count: "exact",
    })
    .order(SORT_COLUMNS[sortKey], { ascending: sortDir === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .range(from, from + pageSize - 1);
  if (statusFilter) query = query.eq("status", statusFilter);
  for (const pattern of brandLeadSearchPatterns(q)) query = query.ilike("shop_name", pattern);
  for (const pattern of brandLeadSearchPatterns(bd)) query = query.ilike("bizdev_names", pattern);
  if (niche?.trim()) query = query.ilike("business_category", escapeLike(niche.trim().replace(/\*/g, "")));
  const [{ data, count }, { data: nicheRows }] = await Promise.all([
    query,
    supabase.from("brand_lead_niches").select("niche, lead_count").order("niche"),
  ]);
  const leads = (data ?? []) as LeadRow[];

  // Contacts shown in the list — the reason CM/BD search here is to reach the brand's PIC.
  const contacts = leads.length
    ? await fetchAllIn<ContactRow>(supabase, "brand_lead_contacts", "lead_id, lead_name, phone, email, sort_order", "lead_id", leads.map((l) => l.id))
    : [];
  const contactsByLead = new Map<string, ContactRow[]>();
  for (const c of contacts.sort((a, b) => a.sort_order - b.sort_order)) {
    contactsByLead.set(c.lead_id, [...(contactsByLead.get(c.lead_id) ?? []), c]);
  }

  const filtered = Boolean(q?.trim() || bd?.trim() || niche?.trim() || statusFilter);
  const total = count ?? leads.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const SortTh = ({ label, col }: { label: string; col: string }) => {
    const active = sortKey === col;
    const next = active && sortDir === "asc" ? "desc" : "asc";
    return (
      <th className="px-4 py-3" aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <Link href={hrefWith({ sort: col, dir: next })} className="inline-flex items-center gap-1 hover:text-slate-900">
          {label}
          <span className={active ? "text-slate-900" : "text-slate-300"}>{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
        </Link>
      </th>
    );
  };
  const hrefWith = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    // Any change other than the page itself goes back to page 1.
    const merged: Record<string, string | undefined> = {
      q, bd, niche, status: statusFilter, sort, dir, size,
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v?.trim()) params.set(k, v);
    const s = params.toString();
    return s ? `/leads?${s}` : "/leads";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Brand Lead Bank</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lead brand ber-kontak dari matchmaking/event/iklan/rekomendasi/scouting — semua tim BizDev & CM
            lihat semua baris. Beda dari shop potensial M4 (bd_leads, otomatis dari data leak).
          </p>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Link
              href={showUpload ? "/leads" : "/leads?upload=1"}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {showUpload ? "Tutup Upload" : "Upload Massal"}
            </Link>
            <Link
              href={showNew ? "/leads" : "/leads?new=1"}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              {showNew ? "Tutup Form" : "+ Registrasi Lead"}
            </Link>
          </div>
        )}
      </div>

      {canCreate && showUpload && (
        <div className="mt-4">
          <BulkUploadPanel />
        </div>
      )}

      {canCreate && showNew && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Registrasi Lead Baru</h2>
          <div className="mt-3">
            <LeadForm action={createLead} submitLabel="Simpan Lead" />
          </div>
        </div>
      )}

      <form action="/leads" method="get" className="mt-4 flex flex-wrap items-end gap-3">
        {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        {dir && <input type="hidden" name="dir" value={dir} />}
        {size && <input type="hidden" name="size" value={size} />}
        <div className="min-w-56 flex-1">
          <label className="block text-xs text-slate-500">Cari Nama Brand</label>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="mis. skintific, wardah, lemonilo"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="min-w-48">
          <label className="block text-xs text-slate-500">Cari Nama Bizdev</label>
          <input
            name="bd"
            defaultValue={bd ?? ""}
            placeholder="mis. alya, budi"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500">Niche Brand</label>
          <select name="niche" defaultValue={niche ?? ""} className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">Semua niche</option>
            {(nicheRows ?? []).map((n) => (
              <option key={n.niche} value={n.niche}>
                {n.niche} ({n.lead_count})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Cari
        </button>
        {filtered && (
          <Link href="/leads" className="py-2 text-sm text-slate-500 hover:underline">
            Reset
          </Link>
        )}
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Link href={hrefWith({ status: undefined })} className={`rounded-full px-3 py-1 ${!statusFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
          Semua
        </Link>
        {(Object.keys(BRAND_LEAD_STATUS_LABELS) as BrandLeadStatus[]).map((s) => (
          <Link key={s} href={hrefWith({ status: s })} className={`rounded-full px-3 py-1 ${statusFilter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {BRAND_LEAD_STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <p>
          {total} lead{filtered ? " cocok" : ""}
          {total > 0 ? ` — menampilkan ${from + 1}–${Math.min(from + pageSize, total)}` : ""}.
        </p>
        <div className="flex items-center gap-1">
          <span className="mr-1">Baris per halaman:</span>
          {PAGE_SIZES.map((n) => (
            <Link key={n} href={hrefWith({ size: String(n) })} className={`rounded px-2 py-1 ${pageSize === n ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
              {n}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <SortTh label="Nama Brand" col="shop_name" />
              <SortTh label="Niche" col="business_category" />
              <th className="px-4 py-3">Contact PIC Brand</th>
              <SortTh label="Bizdev" col="bizdev_names" />
              <th className="px-4 py-3">Dukungan</th>
              <SortTh label="Ads Brand" col="ads_scheme" />
              <SortTh label="Asal" col="source" />
              <SortTh label="Status" col="status" />
              <SortTh label="Dibuat" col="created_at" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {leads.map((l) => {
              const pics = contactsByLead.get(l.id) ?? [];
              return (
                <tr key={l.id} className="align-top hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/leads/${l.id}`} className="hover:underline">
                      {l.shop_name ?? "(belum ada nama brand)"}
                    </Link>
                    <span className="ml-1 font-mono text-[10px] text-slate-400">{l.id}</span>
                    {l.converted_deal_id && (
                      <Link href={`/deals/${l.converted_deal_id}`} className="ml-2 text-[10px] text-green-700 underline">
                        → {l.converted_deal_id}
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-2">{l.business_category ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {pics.length === 0 && "—"}
                    {pics.slice(0, 2).map((c, i) => (
                      <div key={i}>
                        {c.lead_name ?? "—"}
                        {c.phone ? ` · ${c.phone}` : ""}
                        {c.email ? ` · ${c.email}` : ""}
                      </div>
                    ))}
                    {pics.length > 2 && <div className="text-slate-400">+{pics.length - 2} kontak lain</div>}
                  </td>
                  <td className="px-4 py-2 text-xs">{l.bizdev_names ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {(l.brand_support ?? []).map((s) => BRAND_LEAD_SUPPORT_LABELS[s as BrandLeadSupport] ?? s).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">{l.ads_scheme ?? "—"}</td>
                  <td className="px-4 py-2">{l.source}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[l.status] ?? "bg-slate-100"}`}>
                      {BRAND_LEAD_STATUS_LABELS[l.status as BrandLeadStatus] ?? l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">{new Date(l.created_at).toLocaleDateString("id-ID")}</td>
                </tr>
              );
            })}
            {leads.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  {filtered ? "Tidak ada lead yang cocok dengan pencarian." : "Belum ada lead."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
          <span>
            Halaman {Math.min(pageNo, totalPages)} dari {totalPages}
          </span>
          <div className="flex gap-2">
            {pageNo > 1 ? (
              <Link href={hrefWith({ page: String(pageNo - 1) })} className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
                ← Sebelumnya
              </Link>
            ) : (
              <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">← Sebelumnya</span>
            )}
            {pageNo < totalPages ? (
              <Link href={hrefWith({ page: String(pageNo + 1) })} className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50">
                Berikutnya →
              </Link>
            ) : (
              <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">Berikutnya →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
