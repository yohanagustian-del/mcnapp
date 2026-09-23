import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { LeadForm } from "../lead-form";
import { updateLead } from "../actions";
import { ConvertToDealForm } from "./convert-form";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const { id } = await params;

  const supabase = await createClient();
  const { data: lead } = await supabase.from("brand_leads").select("*").eq("id", id).maybeSingle();
  if (!lead) notFound();

  const { data: contacts } = await supabase
    .from("brand_lead_contacts")
    .select("lead_name, phone, email, sort_order")
    .eq("lead_id", id)
    .order("sort_order");

  const canEdit = hasPermission("leads.edit", member.role);
  const boundUpdate = updateLead.bind(null, id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{lead.shop_name ?? "(belum ada nama toko)"}</h1>
          <p className="mt-1 text-xs font-mono text-slate-400">{lead.id}</p>
        </div>
        <Link href="/leads" className="text-sm text-slate-500 hover:underline">← Kembali ke daftar</Link>
      </div>

      {lead.converted_deal_id ? (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          Lead ini sudah jadi deal: <Link href={`/deals/${lead.converted_deal_id}`} className="underline font-medium">{lead.converted_deal_id}</Link>
        </div>
      ) : (
        canEdit && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Buat Deal</h2>
            <p className="mt-1 text-xs text-slate-500">
              Daftarkan deal-nya lewat <Link href="/deals/baru" target="_blank" className="underline">Registrasi Deal</Link> (buka
              tab baru, isi Shop Name = &ldquo;{lead.shop_name ?? "-"}&rdquo;), lalu tempel ID deal yang terbentuk di sini
              supaya lead ini tertaut & statusnya otomatis jadi &ldquo;Deal&rdquo;.
            </p>
            <div className="mt-3">
              <ConvertToDealForm leadId={lead.id} />
            </div>
          </div>
        )
      )}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Data Lead</h2>
        <div className="mt-3">
          {canEdit ? (
            <LeadForm
              action={boundUpdate}
              submitLabel="Simpan Perubahan"
              defaults={{
                source: lead.source,
                source_other: lead.source_other,
                shop_name: lead.shop_name,
                city: lead.city,
                business_category: lead.business_category,
                store_link: lead.store_link,
                platforms: lead.platforms ?? [],
                marketing_budget: lead.marketing_budget,
                target_roas: lead.target_roas,
                brand_support: lead.brand_support ?? [],
                status: lead.status,
                notes: lead.notes,
                contacts: contacts ?? [],
              }}
            />
          ) : (
            <div className="space-y-2 text-sm text-slate-700">
              <p><span className="text-slate-500">Asal:</span> {lead.source}</p>
              <p><span className="text-slate-500">Kota:</span> {lead.city ?? "—"}</p>
              <p><span className="text-slate-500">Kategori:</span> {lead.business_category ?? "—"}</p>
              <p><span className="text-slate-500">Status:</span> {lead.status}</p>
              <p><span className="text-slate-500">Catatan:</span> {lead.notes ?? "—"}</p>
              <div>
                <p className="text-slate-500">Kontak:</p>
                <ul className="list-inside list-disc">
                  {(contacts ?? []).map((c, i) => (
                    <li key={i}>{c.lead_name ?? "—"} · {c.phone ?? "—"} · {c.email ?? "—"}</li>
                  ))}
                  {(contacts ?? []).length === 0 && <li>Belum ada kontak.</li>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
