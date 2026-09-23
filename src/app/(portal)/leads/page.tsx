import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { LeadForm } from "./lead-form";
import { createLead } from "./actions";

const STATUS_LABELS: Record<string, string> = {
  baru: "Baru", kontak: "Kontak", nego: "Nego", deal: "Deal", batal: "Batal",
};
const STATUS_COLORS: Record<string, string> = {
  baru: "bg-slate-100 text-slate-700",
  kontak: "bg-blue-100 text-blue-700",
  nego: "bg-amber-100 text-amber-700",
  deal: "bg-green-100 text-green-700",
  batal: "bg-red-100 text-red-700",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string }>;
}) {
  const member = await requireMember();
  const { status: statusFilter, new: showNew } = await searchParams;

  const supabase = await createClient();
  let query = supabase
    .from("brand_leads")
    .select("id, source, shop_name, city, business_category, status, marketing_budget, created_at, converted_deal_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: leads } = await query;

  const canCreate = hasPermission("leads.create", member.role);

  const rupiah = (n: number | null) => (n == null ? "—" : `Rp${Math.round(n).toLocaleString("id-ID")}`);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Brand Lead Bank</h1>
          <p className="mt-1 text-sm text-slate-500">
            Lead brand ber-kontak dari matchmaking/event/iklan/rekomendasi/scouting — semua tim BizDev
            lihat semua baris. Beda dari shop potensial M4 (bd_leads, otomatis dari data leak).
          </p>
        </div>
        {canCreate && (
          <Link
            href={showNew ? "/leads" : "/leads?new=1"}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            {showNew ? "Tutup Form" : "+ Registrasi Lead"}
          </Link>
        )}
      </div>

      {canCreate && showNew && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-800">Registrasi Lead Baru</h2>
          <div className="mt-3">
            <LeadForm action={createLead} submitLabel="Simpan Lead" />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <Link href="/leads" className={`rounded-full px-3 py-1 ${!statusFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
          Semua
        </Link>
        {Object.keys(STATUS_LABELS).map((s) => (
          <Link key={s} href={`/leads?status=${s}`} className={`rounded-full px-3 py-1 ${statusFilter === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Nama Toko/Brand</th>
              <th className="px-4 py-3">Asal</th>
              <th className="px-4 py-3">Kota</th>
              <th className="px-4 py-3">Kategori</th>
              <th className="px-4 py-3">Budget</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Dibuat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(leads ?? []).map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">
                  <Link href={`/leads/${l.id}`} className="hover:underline">
                    {l.shop_name ?? "(belum ada nama toko)"}
                  </Link>
                  <span className="ml-1 font-mono text-[10px] text-slate-400">{l.id}</span>
                  {l.converted_deal_id && (
                    <Link href={`/deals/${l.converted_deal_id}`} className="ml-2 text-[10px] text-green-700 underline">
                      → {l.converted_deal_id}
                    </Link>
                  )}
                </td>
                <td className="px-4 py-2">{l.source}</td>
                <td className="px-4 py-2">{l.city ?? "—"}</td>
                <td className="px-4 py-2">{l.business_category ?? "—"}</td>
                <td className="px-4 py-2">{rupiah(l.marketing_budget)}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[l.status] ?? "bg-slate-100"}`}>
                    {STATUS_LABELS[l.status] ?? l.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{new Date(l.created_at).toLocaleDateString("id-ID")}</td>
              </tr>
            ))}
            {(leads ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Belum ada lead.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
