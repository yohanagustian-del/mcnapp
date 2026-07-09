import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { submitRequest } from "../actions";

/** §2.5 — brand/ads/sample intake → routed to owner CPM (source=creator_portal). */
export default async function RequestsPage() {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();
  const { data: reqs } = await admin
    .from("creator_requests")
    .select("id, type, target_brand, status, approval_status, source, created_at")
    .eq("creator_id", creatorId).order("created_at", { ascending: false });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h1 className="text-xl font-semibold">Ajukan Request</h1>
        <form action={submitRequest} className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <select name="type" required className="w-full rounded border border-slate-300 p-2 text-sm">
            <option value="">Jenis request…</option>
            <option value="sample">Sample produk</option>
            <option value="ads">Ads support</option>
            <option value="hsl">Rate card / brand (HSL)</option>
          </select>
          <input name="target_brand" placeholder="Brand / produk target"
            className="w-full rounded border border-slate-300 p-2 text-sm" />
          <input name="amount" type="number" placeholder="Nominal ads (opsional, Rp)"
            className="w-full rounded border border-slate-300 p-2 text-sm" />
          <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Kirim request</button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Request ads di atas cap akan menunggu approval Director.</p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Status Request</h2>
        <div className="mt-3 space-y-2">
          {(reqs ?? []).length === 0 && <p className="text-sm text-slate-500">Belum ada request.</p>}
          {(reqs ?? []).map((r) => (
            <div key={r.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium capitalize">{r.type}</span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{r.status}</span>
              </div>
              <p className="text-xs text-slate-500">{r.target_brand ?? "-"}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
