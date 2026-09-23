"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, type TeamMember } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { genId } from "@/lib/utils/id";
import { buildCopiedSlots } from "@/lib/schedule/copy-week";
import { searchShopSummary } from "@/lib/deals/shop-search";
import { assertCreatorInScope } from "@/lib/schedule/scope";
import type {
  AdsPayer,
  DealsBy,
  LiveScheduleSlot,
  SlotStatus,
} from "@/lib/schedule/types";

/**
 * Discriminated-union return (never throw across the server-action boundary): Next.js
 * censors a server action's thrown Error message in production, so every rejection is
 * caught and returned as `error` (Bahasa Indonesia) instead. Same pattern as
 * src/app/(portal)/link-leakage/leak-artifact-actions.ts. Writes go through the service-role client
 * (RLS has no user write policy for live_schedule_slots); authorization is done here.
 */
export type ScheduleActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type CreateSlotResult =
  | { ok: true; slot: LiveScheduleSlot }
  | { ok: false; error: string };

export type CopyWeekResult =
  | { ok: true; copiedCount: number }
  | { ok: false; error: string };

export type CreateCreatorResult =
  | { ok: true; creatorId: string }
  | { ok: false; error: string };

/**
 * Satu pilihan brand pada pertanyaan "Link ke deal (opsional)" di form slot.
 *
 * Sumbernya tabel "Shop" di tab Deal Brand (view `deal_shop_summary`) — deal baru
 * didaftarkan sebagai kartu produk, jadi di sanalah brand yang sedang berjalan hidup;
 * shop yang deal-nya terdaftar tapi kartunya belum turun juga ikut. Nilainya
 * `shop_key`, kunci grup yang sama dengan view ringkasan.
 */
export interface ShopDealOption {
  shop_key: string;
  shop_name: string | null;
  shop_id: string | null;
  /** Ada PIC TAP-nya → slot ini akan memunculkan notifikasi di akun PIC tersebut. */
  has_pic_tap: boolean;
}

export type ShopDealSearchResult =
  | { ok: true; shops: ShopDealOption[]; capped: boolean }
  | { ok: false; error: string };

// ---------- FormData helpers ----------

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === "true" || v === "on" || v === "1";
}

const STATUSES: SlotStatus[] = ["scheduled", "tentative", "off"];
const DEALS_BY: DealsBy[] = ["bd", "cm", "creator"];
const ADS_PAYERS: AdsPayer[] = ["brand", "mea", "invoicing_mea", "organik"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

interface SlotFields {
  creator_id: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  status: SlotStatus;
  off_reason: string | null;
  brand_name: string | null;
  deal_id: string | null;
  shop_key: string | null;
  deals_by: DealsBy | null;
  ads_payer: AdsPayer | null;
  ads_note: string | null;
  product_set_title: string | null;
  pk_ready: boolean;
  product_connected_tap: boolean;
  fokus_produk: string | null;
}

/** Parse + validate the common slot fields shared by create/update. Throws on invalid. */
function parseSlotFields(fd: FormData): SlotFields {
  const creator_id = str(fd, "creator_id");
  if (!creator_id) throw new Error("Kreator wajib dipilih.");

  const schedule_date = str(fd, "schedule_date");
  if (!schedule_date || !DATE_RE.test(schedule_date)) {
    throw new Error("Tanggal jadwal tidak valid (format YYYY-MM-DD).");
  }

  const statusRaw = str(fd, "status") ?? "scheduled";
  if (!STATUSES.includes(statusRaw as SlotStatus)) {
    throw new Error("Status tidak valid (scheduled | tentative | off).");
  }
  const status = statusRaw as SlotStatus;

  let start_time = str(fd, "start_time");
  let end_time = str(fd, "end_time");
  if (status === "off") {
    // OFF slots carry no times.
    start_time = null;
    end_time = null;
  } else {
    if (!start_time || !end_time) {
      throw new Error("Jam mulai dan jam selesai wajib diisi untuk slot yang bukan OFF.");
    }
    if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time)) {
      throw new Error("Format jam tidak valid (HH:MM).");
    }
    if (start_time >= end_time) {
      throw new Error("Jam mulai harus lebih awal dari jam selesai.");
    }
  }

  const deals_by = str(fd, "deals_by");
  if (deals_by && !DEALS_BY.includes(deals_by as DealsBy)) {
    throw new Error("Sumber deal tidak valid (bd | cm | creator).");
  }
  const ads_payer = str(fd, "ads_payer");
  if (ads_payer && !ADS_PAYERS.includes(ads_payer as AdsPayer)) {
    throw new Error("Pembayar ads tidak valid (brand | mea | invoicing_mea | organik).");
  }

  return {
    creator_id,
    schedule_date,
    start_time,
    end_time,
    status,
    off_reason: str(fd, "off_reason"),
    brand_name: str(fd, "brand_name"),
    deal_id: str(fd, "deal_id"),
    // Shop dari tabel "Shop dari Produk TAP" (products_tap.shop_key).
    shop_key: str(fd, "shop_key"),
    deals_by: (deals_by as DealsBy | null) ?? null,
    ads_payer: (ads_payer as AdsPayer | null) ?? null,
    ads_note: str(fd, "ads_note"),
    product_set_title: str(fd, "product_set_title"),
    pk_ready: bool(fd, "pk_ready"),
    product_connected_tap: bool(fd, "product_connected_tap"),
    fokus_produk: str(fd, "fokus_produk"),
  };
}

/**
 * Shop yang ditautkan ke slot harus benar-benar ada di katalog shop.
 *
 * shop_key bukan foreign key (shop = hasil grouping kartu produk, bukan tabel), jadi
 * database tidak bisa menolak kunci karangan/basi. Tanpa cek ini, slot bisa menunjuk
 * shop yang namanya sudah diganti — dan notifikasi PIC TAP-nya diam-diam tidak
 * pernah muncul.
 *
 * Diperiksa ke view `deal_shop_summary`, BUKAN langsung ke `products_tap`: pemilih di
 * form menawarkan shop dari view itu, dan view itu juga memuat shop yang deal-nya
 * sudah terdaftar tapi kartu produknya belum turun (Registrasi Deal berisi Shop Name
 * saja — Wardah, Skintific, dan empat shop lain saat ini). Memvalidasi ke sumber yang
 * berbeda dengan yang ditawarkan berarti form menolak shop yang baru saja dipilih
 * pemakainya sendiri.
 */
async function assertShopKeyExists(
  admin: ReturnType<typeof createAdminClient>,
  shopKey: string | null
): Promise<void> {
  if (!shopKey) return;
  const { data, error } = await admin
    .from("deal_shop_summary")
    .select("shop_key")
    .eq("shop_key", shopKey)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Gagal memeriksa shop: ${error.message}`);
  if (!data) {
    throw new Error(
      `Shop "${shopKey}" tidak ada di katalog shop — muat ulang halaman lalu pilih ulang shopnya.`
    );
  }
}

function revalidateSchedule(): void {
  revalidatePath("/schedule");
  revalidatePath("/workspace/cm");
  revalidatePath("/workspace/bizdev");
}

// ---------- Actions ----------

/**
 * Cari brand untuk pertanyaan "Link ke deal (opsional)" di form slot.
 *
 * KENAPA ADA. Sebelumnya form memuat 500 shop sekali lalu menampilkannya sebagai
 * <select> tanpa kotak cari — dan daftar itu diurutkan ulang per nama di klien,
 * sehingga 500 yang termuat adalah yang kartunya terbanyak tapi urutan tampilnya
 * alfabetis: shop mana yang terpotong tidak bisa ditebak pemakai. Dari 16.030 shop di
 * katalog, 15.530 di antaranya tidak pernah bisa dipilih.
 *
 * Pencarian & urutannya milik `searchShopSummary` — definisi yang sama dengan pemilih
 * shop di form Project BD dan kotak cari tabel Shop di tab Deal Brand (CLAUDE.md #4).
 *
 * Memakai admin client seperti action slot lainnya di berkas ini, lalu menyaring
 * hasilnya sendiri lewat requirePermission di atas; RLS view-nya security_invoker.
 */
export async function searchShopDealsAction(query: string): Promise<ShopDealSearchResult> {
  try {
    // Pemilihnya hanya muncul di form slot yang bisa disunting; izinnya disamakan
    // supaya action ini tidak jadi jalan pintas membaca katalog shop.
    await requirePermission("schedule.edit");
    const admin = createAdminClient();
    const { rows, capped } = await searchShopSummary(admin, {
      term: query,
      // pic_tap_ids dipakai menandai brand yang jadwalnya akan memunculkan
      // notifikasi di akun PIC TAP-nya.
      columns: "shop_key, shop_name, shop_id, pic_tap_ids",
    });

    return {
      ok: true,
      shops: rows.map((s) => ({
        shop_key: s.shop_key as string,
        shop_name: (s.shop_name as string | null) ?? null,
        shop_id: (s.shop_id as string | null) ?? null,
        has_pic_tap: Array.isArray(s.pic_tap_ids) && s.pic_tap_ids.length > 0,
      })),
      capped,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Pencarian shop gagal" };
  }
}

/** Create a live-schedule slot. Requires an existing roster creator (live_roster=true). */
export async function createSlotAction(formData: FormData): Promise<CreateSlotResult> {
  try {
    const member = await requirePermission("schedule.edit");
    const f = parseSlotFields(formData);
    const admin = createAdminClient();

    await assertCreatorInScope(admin, member, f.creator_id);
    // Creator must be flagged into the calendar.
    const { data: creator } = await admin
      .from("creators")
      .select("live_roster")
      .eq("id", f.creator_id)
      .maybeSingle();
    if (!creator?.live_roster) {
      throw new Error("Kreator belum ada di roster live — aktifkan dulu di kalender.");
    }
    await assertShopKeyExists(admin, f.shop_key);

    const { data: inserted, error } = await admin
      .from("live_schedule_slots")
      .insert({
        creator_id: f.creator_id,
        schedule_date: f.schedule_date,
        start_time: f.start_time,
        end_time: f.end_time,
        status: f.status,
        off_reason: f.off_reason,
        brand_name: f.brand_name,
        deal_id: f.deal_id,
        shop_key: f.shop_key,
        deals_by: f.deals_by,
        ads_payer: f.ads_payer,
        ads_note: f.ads_note,
        product_set_title: f.product_set_title,
        pk_ready: f.pk_ready,
        product_connected_tap: f.product_connected_tap,
        fokus_produk: f.fokus_produk,
        created_by: member.id,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Gagal menyimpan slot: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.create_slot",
      entityType: "live_schedule_slots",
      entityId: String(inserted.id),
      after: inserted,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true, slot: inserted as LiveScheduleSlot };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Update an existing slot. Verified (status='done') slots are locked. */
export async function updateSlotAction(formData: FormData): Promise<ScheduleActionResult> {
  try {
    const member = await requirePermission("schedule.edit");
    const slotId = str(formData, "slot_id");
    if (!slotId) throw new Error("ID slot wajib diisi.");
    const f = parseSlotFields(formData);
    const admin = createAdminClient();

    const { data: before, error: befErr } = await admin
      .from("live_schedule_slots")
      .select("*")
      .eq("id", Number(slotId))
      .maybeSingle();
    if (befErr) throw new Error(`Gagal membaca slot: ${befErr.message}`);
    if (!before) throw new Error("Slot tidak ditemukan.");
    if (before.status === "done" || before.status === "cancelled") {
      throw new Error("Slot sudah diverifikasi — tidak dapat diubah.");
    }

    // Scope-check both the existing owner and (if reassigned) the new creator.
    await assertCreatorInScope(admin, member, before.creator_id);
    if (f.creator_id !== before.creator_id) {
      await assertCreatorInScope(admin, member, f.creator_id);
    }
    await assertShopKeyExists(admin, f.shop_key);

    const { data: after, error } = await admin
      .from("live_schedule_slots")
      .update({
        creator_id: f.creator_id,
        schedule_date: f.schedule_date,
        start_time: f.start_time,
        end_time: f.end_time,
        status: f.status,
        off_reason: f.off_reason,
        brand_name: f.brand_name,
        deal_id: f.deal_id,
        shop_key: f.shop_key,
        deals_by: f.deals_by,
        ads_payer: f.ads_payer,
        ads_note: f.ads_note,
        product_set_title: f.product_set_title,
        pk_ready: f.pk_ready,
        product_connected_tap: f.product_connected_tap,
        fokus_produk: f.fokus_produk,
        updated_by: member.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", Number(slotId))
      .select("*")
      .single();
    if (error) throw new Error(`Gagal memperbarui slot: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.update_slot",
      entityType: "live_schedule_slots",
      entityId: slotId,
      before,
      after,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Delete a slot. Verified (status='done') slots are locked. */
export async function deleteSlotAction(formData: FormData): Promise<ScheduleActionResult> {
  try {
    const member = await requirePermission("schedule.edit");
    const slotId = str(formData, "slot_id");
    if (!slotId) throw new Error("ID slot wajib diisi.");
    const admin = createAdminClient();

    const { data: before, error: befErr } = await admin
      .from("live_schedule_slots")
      .select("*")
      .eq("id", Number(slotId))
      .maybeSingle();
    if (befErr) throw new Error(`Gagal membaca slot: ${befErr.message}`);
    if (!before) throw new Error("Slot tidak ditemukan.");
    if (before.status === "done" || before.status === "cancelled") {
      throw new Error("Slot sudah diverifikasi — tidak dapat dihapus.");
    }
    await assertCreatorInScope(admin, member, before.creator_id);

    const { error } = await admin
      .from("live_schedule_slots")
      .delete()
      .eq("id", Number(slotId));
    if (error) throw new Error(`Gagal menghapus slot: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.delete_slot",
      entityType: "live_schedule_slots",
      entityId: slotId,
      before,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Verify a past-or-today slot: record actual times, optionally finalize the PK/TAP
 * checkboxes, set status='done'. CM verifies during work hours, Creator Support outside
 * them (both hold schedule.verify). Only scheduled|tentative slots dated <= today.
 */
export async function verifySlotAction(formData: FormData): Promise<ScheduleActionResult> {
  try {
    const member = await requirePermission("schedule.verify");
    const slotId = str(formData, "slot_id");
    if (!slotId) throw new Error("ID slot wajib diisi.");

    const actualStart = str(formData, "actual_start");
    const actualEnd = str(formData, "actual_end");
    if (!actualStart || !actualEnd) {
      throw new Error("Jam mulai & selesai aktual wajib diisi saat verifikasi.");
    }
    if (!TIME_RE.test(actualStart) || !TIME_RE.test(actualEnd)) {
      throw new Error("Format jam aktual tidak valid (HH:MM).");
    }
    if (actualStart >= actualEnd) {
      throw new Error("Jam mulai aktual harus lebih awal dari jam selesai aktual.");
    }

    const admin = createAdminClient();
    const { data: before, error: befErr } = await admin
      .from("live_schedule_slots")
      .select("*")
      .eq("id", Number(slotId))
      .maybeSingle();
    if (befErr) throw new Error(`Gagal membaca slot: ${befErr.message}`);
    if (!before) throw new Error("Slot tidak ditemukan.");
    if (before.status !== "scheduled" && before.status !== "tentative") {
      throw new Error("Hanya slot berstatus scheduled/tentative yang dapat diverifikasi.");
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    if (before.schedule_date > todayIso) {
      throw new Error("Slot masa depan belum dapat diverifikasi.");
    }
    await assertCreatorInScope(admin, member, before.creator_id);

    // Optional final checkbox states — only override when the field was submitted.
    const hasPk = formData.has("pk_ready");
    const hasTap = formData.has("product_connected_tap");
    const update: Record<string, unknown> = {
      status: "done",
      actual_start: actualStart,
      actual_end: actualEnd,
      verified_by: member.id,
      verified_at: new Date().toISOString(),
      updated_by: member.id,
      updated_at: new Date().toISOString(),
    };
    if (hasPk) update.pk_ready = bool(formData, "pk_ready");
    if (hasTap) update.product_connected_tap = bool(formData, "product_connected_tap");

    const { data: after, error } = await admin
      .from("live_schedule_slots")
      .update(update)
      .eq("id", Number(slotId))
      .select("*")
      .single();
    if (error) throw new Error(`Gagal memverifikasi slot: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.verify_slot",
      entityType: "live_schedule_slots",
      entityId: slotId,
      before,
      after,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Verify a past-or-today slot as NOT having gone live (found out at verification time,
 * as opposed to a slot planned 'off' from the start). Same gate as verifySlotAction
 * (schedule.verify, scheduled|tentative only, date <= today) but records a reason
 * instead of actual times and sets status='cancelled' (locked from edit/delete, same
 * as 'done').
 */
export async function cancelVerifiedSlotAction(formData: FormData): Promise<ScheduleActionResult> {
  try {
    const member = await requirePermission("schedule.verify");
    const slotId = str(formData, "slot_id");
    if (!slotId) throw new Error("ID slot wajib diisi.");

    const cancelReason = str(formData, "cancel_reason");
    if (!cancelReason) throw new Error("Alasan tidak jadi live wajib diisi.");

    const admin = createAdminClient();
    const { data: before, error: befErr } = await admin
      .from("live_schedule_slots")
      .select("*")
      .eq("id", Number(slotId))
      .maybeSingle();
    if (befErr) throw new Error(`Gagal membaca slot: ${befErr.message}`);
    if (!before) throw new Error("Slot tidak ditemukan.");
    if (before.status !== "scheduled" && before.status !== "tentative") {
      throw new Error("Hanya slot berstatus scheduled/tentative yang dapat diverifikasi.");
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    if (before.schedule_date > todayIso) {
      throw new Error("Slot masa depan belum dapat diverifikasi.");
    }
    await assertCreatorInScope(admin, member, before.creator_id);

    const { data: after, error } = await admin
      .from("live_schedule_slots")
      .update({
        status: "cancelled",
        cancel_reason: cancelReason,
        verified_by: member.id,
        verified_at: new Date().toISOString(),
        updated_by: member.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", Number(slotId))
      .select("*")
      .single();
    if (error) throw new Error(`Gagal memverifikasi slot: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.cancel_verified_slot",
      entityType: "live_schedule_slots",
      entityId: slotId,
      before,
      after,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Copy a week's non-OFF slots to a target week (same weekday offsets), resetting to a
 * fresh unverified 'scheduled' state. Refuses if the target week already has ANY slot
 * for the creators being copied. For role `cpm`, only own creators' slots participate.
 */
export async function copyWeekAction(formData: FormData): Promise<CopyWeekResult> {
  try {
    const member = await requirePermission("schedule.edit");
    const sourceWeekStart = str(formData, "source_week_start");
    const targetWeekStart = str(formData, "target_week_start");
    if (!sourceWeekStart || !DATE_RE.test(sourceWeekStart)) {
      throw new Error("Minggu sumber tidak valid (format YYYY-MM-DD, hari Senin).");
    }
    if (!targetWeekStart || !DATE_RE.test(targetWeekStart)) {
      throw new Error("Minggu tujuan tidak valid (format YYYY-MM-DD, hari Senin).");
    }
    if (sourceWeekStart === targetWeekStart) {
      throw new Error("Minggu sumber dan tujuan tidak boleh sama.");
    }

    const admin = createAdminClient();

    // Source-week window is [sourceWeekStart, sourceWeekStart + 7d).
    const sourceEndExclusive = addDaysIso(sourceWeekStart, 7);
    let srcQuery = admin
      .from("live_schedule_slots")
      .select("*")
      .gte("schedule_date", sourceWeekStart)
      .lt("schedule_date", sourceEndExclusive);

    // CPM scope: restrict to own creators.
    if (member.role === "cpm") {
      const ownIds = await ownCreatorIds(admin, member.id);
      if (ownIds.length === 0) return { ok: true, copiedCount: 0 };
      srcQuery = srcQuery.in("creator_id", ownIds);
    }

    const { data: sourceSlots, error: srcErr } = await srcQuery;
    if (srcErr) throw new Error(`Gagal membaca minggu sumber: ${srcErr.message}`);

    const payloads = buildCopiedSlots(
      (sourceSlots ?? []) as LiveScheduleSlot[],
      sourceWeekStart,
      targetWeekStart,
      member.id
    );
    if (payloads.length === 0) return { ok: true, copiedCount: 0 };

    // Refuse if the target week already has ANY slot for the creators being copied.
    const creatorIds = [...new Set(payloads.map((p) => p.creator_id))];
    const targetEndExclusive = addDaysIso(targetWeekStart, 7);
    const { data: existing, error: exErr } = await admin
      .from("live_schedule_slots")
      .select("id")
      .in("creator_id", creatorIds)
      .gte("schedule_date", targetWeekStart)
      .lt("schedule_date", targetEndExclusive)
      .limit(1);
    if (exErr) throw new Error(`Gagal memeriksa minggu tujuan: ${exErr.message}`);
    if (existing && existing.length > 0) {
      throw new Error("Minggu tujuan sudah memiliki jadwal untuk kreator terkait — batalkan salin.");
    }

    const { error: insErr } = await admin.from("live_schedule_slots").insert(payloads);
    if (insErr) throw new Error(`Gagal menyalin jadwal: ${insErr.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.copy_week",
      entityType: "live_schedule_slots",
      after: { source: sourceWeekStart, target: targetWeekStart, copied_count: payloads.length },
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true, copiedCount: payloads.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/** Toggle a creator's live_roster flag (whether they appear in the calendar). */
export async function toggleRosterAction(formData: FormData): Promise<ScheduleActionResult> {
  try {
    const member = await requirePermission("schedule.roster");
    const creatorId = str(formData, "creator_id");
    if (!creatorId) throw new Error("Kreator wajib dipilih.");
    const on = bool(formData, "on");
    const admin = createAdminClient();

    const { data: before, error: befErr } = await admin
      .from("creators")
      .select("id, live_roster")
      .eq("id", creatorId)
      .maybeSingle();
    if (befErr) throw new Error(`Gagal membaca kreator: ${befErr.message}`);
    if (!before) throw new Error("Kreator tidak ditemukan.");

    const { data: after, error } = await admin
      .from("creators")
      .update({ live_roster: on })
      .eq("id", creatorId)
      .select("id, live_roster")
      .single();
    if (error) throw new Error(`Gagal memperbarui roster: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.toggle_roster",
      entityType: "creators",
      entityId: creatorId,
      before: { live_roster: before.live_roster },
      after: { live_roster: after.live_roster },
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

/**
 * Create a new creator directly onto the live-schedule roster. Collects only a CM
 * (owner_cpm_id) and a username — the creator is inserted with live_roster=true so it
 * appears in the weekly calendar immediately and can be scheduled via the existing slot
 * flow. `name` is set to the username (same convention as auto-prospect ingest, where
 * creators.name has no separate source). Gated by schedule.roster (management/CM lead/CPM).
 */
export async function createCreatorAction(formData: FormData): Promise<CreateCreatorResult> {
  try {
    const member = await requirePermission("schedule.roster");
    const username = str(formData, "username");
    if (!username) throw new Error("Username kreator wajib diisi.");
    const ownerCpmId = str(formData, "owner_cpm_id");
    if (!ownerCpmId) throw new Error("CM wajib dipilih.");

    const admin = createAdminClient();

    // The CM must be a real team member with role 'cpm' (the roster owner role).
    const { data: cm, error: cmErr } = await admin
      .from("team_members")
      .select("id, role")
      .eq("id", ownerCpmId)
      .maybeSingle();
    if (cmErr) throw new Error(`Gagal memeriksa CM: ${cmErr.message}`);
    if (!cm || cm.role !== "cpm") throw new Error("CM yang dipilih tidak valid.");

    const id = genId("CRT");
    const { data: inserted, error } = await admin
      .from("creators")
      .insert({
        id,
        name: username,
        username,
        owner_cpm_id: ownerCpmId,
        live_roster: true,
        status: "prospek",
      })
      .select("id, name, username, owner_cpm_id, live_roster, status")
      .single();
    if (error) throw new Error(`Gagal menyimpan kreator: ${error.message}`);

    await writeAudit({
      actorId: member.id,
      action: "schedule.create_creator",
      entityType: "creators",
      entityId: id,
      after: inserted,
      type: "auto",
    });

    revalidateSchedule();
    return { ok: true, creatorId: id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Terjadi kesalahan tidak terduga." };
  }
}

// ---------- internal helpers ----------

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`;
}

async function ownCreatorIds(
  admin: ReturnType<typeof createAdminClient>,
  cpmId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("creators")
    .select("id")
    .eq("owner_cpm_id", cpmId);
  if (error) throw new Error(`Gagal membaca kreator milik CPM: ${error.message}`);
  return (data ?? []).map((r: { id: string }) => r.id);
}
