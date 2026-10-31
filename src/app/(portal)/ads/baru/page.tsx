import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCreatorInScope } from "@/lib/schedule/scope";
import { legacyAdsPayerToFunding } from "@/lib/m10/funding-spec";
import { budgetMonthOf } from "@/lib/m10/request";
import { loadMeaBudgetContext } from "@/lib/m10/request-data";
import { RequestForm, type ProjectOption, type ParticipantOption } from "./request-form";

/**
 * Form Request Ads. Konteks pemilik datang dari query:
 *   ?slot_id=…                 → slot Jadwal Live (kreator & tanggal dari slot)
 *   ?project_id=…[&creator_id] → Special Project (+ peserta, wajib untuk Budget MEA)
 * Tanpa keduanya → pilih project dari daftar yang masih berjalan.
 */
export default async function NewAdsRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ slot_id?: string; project_id?: string; creator_id?: string }>;
}) {
  let member;
  try {
    member = await requirePermission("m10.brief_create");
  } catch {
    redirect("/ads");
  }
  const params = await searchParams;
  const admin = createAdminClient();

  const slotId = params.slot_id ? Number(params.slot_id) : null;
  const projectIdParam = params.project_id ? Number(params.project_id) : null;

  type SlotCtx = {
    id: number; creator_id: string; schedule_date: string; brand_name: string | null; status: string;
    ads_payer: "brand" | "mea" | "invoicing_mea" | "organik" | null; ads_note: string | null;
    creators: { name?: string; owner_cpm_id?: string | null } | null;
  };
  let slot: SlotCtx | null = null;
  if (slotId && Number.isInteger(slotId)) {
    const { data } = await admin
      .from("live_schedule_slots")
      .select("id, creator_id, schedule_date, brand_name, status, ads_payer, ads_note, creators(name, owner_cpm_id)")
      .eq("id", slotId)
      .maybeSingle();
    slot = (data as unknown as SlotCtx | null) ?? null;
    if (!slot) {
      return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">Slot jadwal live tidak ditemukan.</p>;
    }
    if (!isCreatorInScope(member, slot.creators?.owner_cpm_id ?? null)) {
      return <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">CPM hanya boleh mengajukan request ads untuk kreator yang dipegangnya.</p>;
    }
  }

  // Project yang masih berjalan (planning/aktif) untuk pemilih; peserta dimuat untuk project terpilih.
  const { data: projectRows } = await admin
    .from("special_projects")
    .select("id, name, status, start_date, end_date")
    .in("status", ["planning", "aktif"])
    .order("start_date", { ascending: false })
    .limit(200);
  const projects: ProjectOption[] = ((projectRows ?? []) as { id: number; name: string; status: string; start_date: string | null; end_date: string | null }[]).map((p) => ({
    id: p.id, name: p.name, status: p.status, startDate: p.start_date, endDate: p.end_date,
  }));

  let participants: ParticipantOption[] = [];
  const selectedProjectId = projectIdParam && Number.isInteger(projectIdParam) ? projectIdParam : null;
  if (selectedProjectId) {
    const { data } = await admin
      .from("project_participants")
      .select("creator_id, creators(name, username, owner_cpm_id)")
      .eq("project_id", selectedProjectId)
      .limit(500);
    participants = ((data ?? []) as unknown as { creator_id: string; creators: { name?: string; username?: string | null; owner_cpm_id?: string | null } | null }[])
      .filter((p) => isCreatorInScope(member, p.creators?.owner_cpm_id ?? null))
      .map((p) => ({ id: p.creator_id, name: p.creators?.name ?? p.creator_id, username: p.creators?.username ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "id"));
  }

  // Sisa jatah MEA bulan ini untuk kreator slot — ditampilkan di form supaya pemohon
  // tahu sebelum mengirim apakah request akan butuh approval Director.
  let meaHint: { month: string; budget: number; used: number; remaining: number } | null = null;
  if (slot) {
    const month = budgetMonthOf(slot.schedule_date);
    try {
      const ctx = await loadMeaBudgetContext(slot.creator_id, month, null);
      meaHint = { month, budget: ctx.budget, used: ctx.used, remaining: ctx.remaining };
    } catch {
      meaHint = null;
    }
  }

  const legacy = slot ? legacyAdsPayerToFunding(slot.ads_payer) : null;

  return (
    <div className="max-w-3xl space-y-4">
      <header>
        <Link href="/ads" className="text-xs text-slate-500 hover:underline">← Request Ads</Link>
        <h1 className="mt-1 text-xl font-semibold">Request Ads Baru</h1>
        {slot ? (
          <p className="mt-1 text-sm text-slate-600">
            Untuk slot Jadwal Live <strong>{slot.creators?.name ?? slot.creator_id}</strong> · {slot.schedule_date}
            {slot.brand_name ? ` · ${slot.brand_name}` : ""}.{" "}
            <Link href="/schedule" className="text-blue-700 hover:underline">Kembali ke jadwal</Link>
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">
            Pilih Special Project yang masih berjalan. Request untuk sesi Jadwal Live dibuat dari tombol
            <em> Request Ads</em> di slotnya.
          </p>
        )}
      </header>

      <RequestForm
        slot={slot ? { id: slot.id, creatorId: slot.creator_id, creatorName: slot.creators?.name ?? slot.creator_id, date: slot.schedule_date, brand: slot.brand_name } : null}
        projects={projects}
        selectedProjectId={selectedProjectId}
        participants={participants}
        preselectedCreatorId={params.creator_id ?? null}
        legacyFunding={legacy}
        legacyNote={slot?.ads_note ?? null}
        meaHint={meaHint}
      />
    </div>
  );
}
