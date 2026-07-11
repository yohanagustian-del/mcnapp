import { createAdminClient } from "@/lib/supabase/admin";
import { requireCreator } from "@/lib/m9/creator-auth";
import { submitComplaint, submitFeedback } from "../actions";

const STATUS_LABEL: Record<string, string> = {
  baru: "Baru", "dalam-penyelesaian": "Dalam penyelesaian", selesai: "Selesai",
};

/** §2.7 — file complaints/feedback; see own complaints + CPM replies (append-only). */
export default async function ComplaintsPage() {
  const { creatorId } = await requireCreator();
  const admin = createAdminClient();

  // ===== Wave 1: independent lookups =====
  const [{ data: cats }, { data: complaints }] = await Promise.all([
    admin.from("app_config").select("value").eq("key", "m9.complaint_categories").maybeSingle(),
    admin
      .from("creator_complaints")
      .select("id, category, severity, body, status, created_at, closed_at")
      .eq("creator_id", creatorId).order("created_at", { ascending: false }),
  ]);
  const categories: string[] = Array.isArray(cats?.value) ? (cats!.value as string[]) : [];

  // ===== Wave 2: depends on complaint ids from wave 1 =====
  const ids = (complaints ?? []).map((c) => c.id);
  const { data: replies } = ids.length
    ? await admin.from("complaint_replies").select("complaint_id, author_role, body, created_at").in("complaint_id", ids)
    : { data: [] as { complaint_id: number; author_role: string; body: string; created_at: string }[] };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">Ajukan Komplain</h1>
        <form action={submitComplaint} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <select name="category" required className="w-full rounded border border-slate-300 p-2 text-sm">
            <option value="">Pilih kategori…</option>
            {categories.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
          </select>
          <select name="severity" defaultValue="sedang" className="w-full rounded border border-slate-300 p-2 text-sm">
            <option value="rendah">Rendah</option><option value="sedang">Sedang</option><option value="tinggi">Tinggi</option>
          </select>
          <textarea name="body" required rows={3} placeholder="Jelaskan masalahmu…"
            className="w-full rounded border border-slate-300 p-2 text-sm" />
          <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Kirim komplain</button>
        </form>

        <h2 className="text-lg font-semibold">Feedback (saran/apresiasi)</h2>
        <form action={submitFeedback} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
          <select name="sentiment" defaultValue="netral" className="w-full rounded border border-slate-300 p-2 text-sm">
            <option value="positif">Positif</option><option value="netral">Netral</option><option value="saran">Saran</option>
          </select>
          <textarea name="body" required rows={2} className="w-full rounded border border-slate-300 p-2 text-sm" />
          <button className="rounded border border-slate-300 px-4 py-2 text-sm">Kirim feedback</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Komplain Saya</h2>
        {(complaints ?? []).length === 0 && <p className="text-sm text-slate-500">Belum ada komplain.</p>}
        {(complaints ?? []).map((c) => (
          <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{c.category.replace(/_/g, " ")}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{STATUS_LABEL[c.status] ?? c.status}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Severity: {c.severity}</p>
            <p className="mt-2 text-sm">{c.body}</p>
            <div className="mt-2 space-y-1">
              {(replies ?? []).filter((r) => r.complaint_id === c.id).map((r, i) => (
                <p key={i} className="rounded bg-slate-50 p-2 text-xs">
                  <span className="font-medium">{r.author_role}:</span> {r.body}
                </p>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
