import { redirect } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { setRetentionWindow, runRetentionPurge } from "./actions";

/** M12 admin dashboard — DB health, retention config, last purge. Read for Head/SPV/OD; Director acts. */
export default async function RetentionAdminPage() {
  const member = await requireMember();
  if (!["director", "head", "spv", "od_viewer"].includes(member.role)) redirect("/dashboard");
  const admin = createAdminClient();

  const { data: health } = await admin
    .from("db_table_health_v").select("table_name, total_size, approx_rows");
  const { data: cfg } = await admin
    .from("app_config").select("key, value").like("key", "retention.%");
  const { data: lastPurge } = await admin
    .from("audit_logs").select("created_at, after")
    .eq("action", "m12.purge_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle();

  const configMap = new Map((cfg ?? []).map((c) => [c.key, JSON.stringify(c.value)]));
  const canConfig = hasPermission("m12.set_policy", member.role);
  const canRun = hasPermission("m12.run_maintenance", member.role);

  return (
    <div className="space-y-6 p-2">
      <header>
        <h1 className="text-xl font-semibold">Retensi Data &amp; Kesehatan DB (M12)</h1>
        <p className="text-sm text-slate-500">
          Raw file dihapus sesudah ingest; data tercatat dipangkas &gt; 6 bulan (agregat aman).
          Identitas/deal/agency/audit tidak pernah kena purge otomatis.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Ukuran Tabel</h2>
          <table className="w-full text-sm">
            <tbody>
              {(health ?? []).map((h) => (
                <tr key={h.table_name} className="border-t border-slate-100">
                  <td className="py-1">{h.table_name}</td>
                  <td className="py-1 text-right">{h.total_size}</td>
                  <td className="py-1 text-right text-slate-500">~{Number(h.approx_rows).toLocaleString("id-ID")} baris</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium">Konfigurasi Retensi</h2>
          <ul className="space-y-1 text-sm">
            {[...configMap.entries()].map(([k, v]) => (
              <li key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span>{v}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Purge terakhir: {lastPurge ? new Date(lastPurge.created_at).toLocaleString("id-ID") : "belum pernah"}
            {lastPurge?.after ? ` — ${JSON.stringify(lastPurge.after)}` : ""}
          </p>
        </div>
      </section>

      {(canConfig || canRun) && (
        <section className="grid gap-4 md:grid-cols-2">
          {canConfig && (
            <form action={setRetentionWindow} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">Set Window Retensi (Director)</h2>
              <div className="flex items-center gap-2">
                <input name="months" type="number" min={1} defaultValue={6} className="w-24 rounded border border-slate-300 p-2 text-sm" />
                <span className="text-sm text-slate-500">bulan (min 28 hari)</span>
                <button className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Simpan</button>
              </div>
            </form>
          )}
          {canRun && (
            <form action={runRetentionPurge} className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-medium">Jalankan Purge (Director)</h2>
              <p className="mb-2 text-xs text-slate-500">Idempotent, window-guarded. Agregat diverifikasi sebelum pangkas.</p>
              <button className="rounded bg-red-600 px-4 py-2 text-sm text-white">Jalankan run_retention_purge()</button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
