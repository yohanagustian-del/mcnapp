import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember, hasPermission } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { slotUploadEligibility } from "@/lib/schedule/live-report";
import type { SlotStatus } from "@/lib/schedule/types";
import { SlotLiveUploadForm } from "./slot-live-upload-form";
import { SlotSessionPanel, type SlotSessionRow } from "./slot-session-panel";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Terjadwal", tentative: "Tentatif", off: "OFF", done: "Selesai (terverifikasi)",
  cancelled: "Tidak jadi live",
};

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

/**
 * Data & Report Live untuk SATU slot Jadwal Live (M13 ↔ M7, migrasi 0066).
 *
 * Opsional per slot: slot boleh selamanya tanpa data. Halaman ini hanya jalan
 * masuknya — file yang diunggah, verifikasi V1–V7, dan penyimpanannya memakai
 * engine yang sama dengan Special Project (lib/m7/live-ingest), bukan salinan.
 */
export default async function SlotLivePage({ params }: { params: Promise<{ slotId: string }> }) {
  const { slotId: slotIdRaw } = await params;
  const slotId = Number(slotIdRaw);
  if (!Number.isInteger(slotId)) notFound();

  const member = await requireMember();
  if (!hasPermission("schedule.view", member.role)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — role Anda tidak memiliki izin melihat Jadwal Live.
      </div>
    );
  }

  const supabase = await createClient();
  const { data: slot } = await supabase
    .from("live_schedule_slots")
    .select("id, creator_id, schedule_date, start_time, end_time, actual_start, actual_end, status, brand_name, cancel_reason, product_set_title, fokus_produk, creators(name, username, owner_cpm_id)")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot) notFound();

  const creator = slot.creators as unknown as { name: string; username: string | null; owner_cpm_id: string | null } | null;
  // Scope CPM: sama dengan aturan server action (lib/schedule/scope.ts) — dibaca
  // ulang di sini supaya halamannya pun tidak terbuka untuk kreator CPM lain.
  if (member.role === "cpm" && creator?.owner_cpm_id !== member.id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Akses ditolak — CPM hanya bisa membuka jadwal kreator yang dipegangnya.
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const eligibility = slotUploadEligibility(
    { status: slot.status as SlotStatus, schedule_date: slot.schedule_date as string },
    today
  );
  const canEdit = hasPermission("schedule.edit", member.role) && eligibility.ok;
  const canGenerate = hasPermission("reports.generate", member.role);

  const [{ data: sessionRows }, { data: reportRows }] = await Promise.all([
    supabase
      .from("project_live_sessions")
      .select("id, session_no, session_date, start_time, end_time, gmv, gmv_trend, orders, brand, attribution_status, filename_product, filename_trend")
      .eq("schedule_slot_id", slotId)
      .order("session_date", { ascending: true })
      .order("session_no", { ascending: true }),
    supabase
      .from("creator_reports")
      .select("id, status, generated_at")
      .eq("schedule_slot_id", slotId)
      .in("status", ["draft", "final"]),
  ]);

  const rows: SlotSessionRow[] = (sessionRows ?? []).map((r) => ({
    id: r.id as number,
    sessionNo: r.session_no as number,
    sessionDate: r.session_date as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    gmv: Number(r.gmv ?? 0),
    gmvTrend: r.gmv_trend === null ? null : Number(r.gmv_trend),
    orders: Number(r.orders ?? 0),
    brand: (r.brand as string | null) ?? null,
    attributionStatus: r.attribution_status as string,
    filenameProduct: (r.filename_product as string | null) ?? null,
    filenameTrend: (r.filename_trend as string | null) ?? null,
  }));

  const report = (reportRows ?? []).find((r) => r.status === "final") ?? (reportRows ?? [])[0] ?? null;
  const countableGmv = rows
    .filter((r) => r.attributionStatus === "verified" || r.attributionStatus === "confirmed_manual")
    .reduce((acc, r) => acc + r.gmv, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/schedule" className="text-sm text-blue-700 hover:underline">← Kembali ke Jadwal Live</Link>
        <h1 className="mt-2 text-2xl font-semibold">
          Data &amp; Report Live — {creator?.name ?? slot.creator_id}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Opsional: unggah file live TikTok untuk slot ini kalau timnya memang mau report per live.
          Angka report murni dari data sesi — 0 token AI.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Info label="Kreator" value={`${creator?.name ?? slot.creator_id}${creator?.username ? ` (@${creator.username})` : ""}`} />
        <Info label="Tanggal" value={slot.schedule_date as string} />
        <Info
          label="Jam rencana"
          value={slot.start_time && slot.end_time
            ? `${(slot.start_time as string).slice(0, 5)}–${(slot.end_time as string).slice(0, 5)}`
            : "—"}
        />
        <Info
          label="Jam aktual (verifikasi)"
          value={slot.actual_start && slot.actual_end
            ? `${(slot.actual_start as string).slice(0, 5)}–${(slot.actual_end as string).slice(0, 5)}`
            : "—"}
        />
        <Info label="Brand" value={(slot.brand_name as string | null)?.trim() || "Organik"} />
        <Info label="Status slot" value={STATUS_LABELS[slot.status as string] ?? (slot.status as string)} />
        <Info label="Set produk" value={(slot.product_set_title as string | null)?.trim() || "—"} />
        <Info label="GMV sesi tercatat" value={rows.length > 0 ? rupiah(countableGmv) : "—"} />
      </section>

      {!eligibility.ok && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {eligibility.reason}
        </p>
      )}

      {canEdit && (
        <section>
          <h2 className="text-lg font-medium">Unggah Data Live</h2>
          <SlotLiveUploadForm slotId={slotId} defaultBrand={(slot.brand_name as string | null) ?? null} />
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Sesi Live Slot Ini</h2>
          {report && (
            <Link href={`/schedule/live/${slotId}/report`} className="text-sm text-blue-700 hover:underline">
              Lihat report ({report.status === "final" ? "final" : "draft"}) →
            </Link>
          )}
        </div>
        <SlotSessionPanel
          slotId={slotId}
          rows={rows}
          canEdit={canEdit}
          canGenerate={canGenerate}
          reportId={report?.id ?? null}
        />
      </section>
    </div>
  );
}
