"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { getConfig } from "@/lib/config";
import { requirePermission } from "@/lib/rbac";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { genId } from "@/lib/utils/id";
import { parseRupiah } from "@/lib/utils/rupiah";

const PLATFORMS = ["tiktok", "shopee"] as const;

/**
 * Hasil setiap action di Acquisition Workspace.
 *
 * Action di halaman ini TIDAK BOLEH throw. Next.js menyensor pesan error server
 * action di production dan menggantinya dengan halaman "Application error: a
 * server-side exception has occurred" — jadi kegagalan wajar (username sudah
 * terdaftar, creator belum punya CM, form dobel-submit) tampil sebagai layar
 * error tanpa keterangan dan seluruh isian hilang. Semua jalur gagal karena itu
 * dikembalikan sebagai `status: "error"` supaya form bisa menampilkannya di
 * tempat, dan hanya bug sungguhan yang boleh sampai ke error boundary.
 */
export type AcquisitionActionResult =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

/** Pesan error yang aman ditampilkan ke user dari exception tak terduga. */
function failure(e: unknown, fallback: string): AcquisitionActionResult {
  return { status: "error", message: e instanceof Error ? e.message : fallback };
}

/** "beauty; skincare, fashion" → up to top-3 level-2 categories (null if empty). */
function parseNiches(raw: string): string[] | null {
  const parts = raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts.slice(0, 3) : null;
}

/** Akhir quartal kalender dari tanggal ISO (binding 20 Feb → 31 Mar). */
function quarterEnd(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const q = Math.ceil(m / 3);
  const endMonth = q * 3; // 3, 6, 9, 12
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return `${y}-${String(endMonth).padStart(2, "0")}-${lastDay}`;
}

/**
 * Catat closing binding (§2C.1): creator + specialist + sumber lead
 * (inbound/outbound/platform) + tanggal binding. Creator prospek → status
 * binding (aksi menambah income → auto berlaku, tetap di audit_logs).
 * QA feedback: snapshot komisi kreator saat binding + GMV 30 hari terakhir
 * (log-only) + quarter_end untuk atribusi GMV quartal akuisisi.
 */
export async function recordAcquisition(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.acquisition");
    const creatorId = String(formData.get("creator_id") ?? "").trim();
    const leadSource = String(formData.get("lead_source") ?? "");
    const bindingDate = String(formData.get("binding_date") ?? "");
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!creatorId || !["inbound", "outbound", "platform"].includes(leadSource)) {
      return { status: "error", message: "Creator & sumber lead wajib diisi" };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bindingDate)) {
      return { status: "error", message: "Tanggal binding wajib diisi" };
    }

    const admin = createAdminClient();
    const { data: creator } = await admin
      .from("creators").select("id, name, status, commission_share").eq("id", creatorId).maybeSingle();
    if (!creator) return { status: "error", message: `Creator ${creatorId} tidak ditemukan` };

    // GMV 30 hari terakhir sebelum binding (log-only, dari data platform).
    // Module 0.5 Fase 2: creator_period_summary — semantiknya persis "total GMV
    // creator per periode", satu baris per creator per periode/batch.
    const start30 = new Date(`${bindingDate}T00:00:00Z`);
    start30.setUTCDate(start30.getUTCDate() - 30);
    const rows30 = await fetchAll<{ affiliate_gmv: number | null }>(
      admin, "creator_period_summary", "affiliate_gmv",
      (q) => q.eq("creator_id", creatorId)
        .gte("period_start", start30.toISOString().slice(0, 10)).lte("period_start", bindingDate));
    const gmvLast30d = rows30.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

    // Specialist = actor sendiri (kinerja pribadi); Lead melihat agregat tim di dashboard.
    const { data: acq, error } = await admin
      .from("acquisitions")
      .insert({
        creator_id: creatorId, specialist_id: actor.id, lead_source: leadSource,
        binding_date: bindingDate, notes,
        commission_share_at_binding: creator.commission_share, // snapshot (sumber: sync platform, read-only)
        gmv_last_30d: gmvLast30d,
        quarter_end: quarterEnd(bindingDate),
      })
      .select("id")
      .single();
    if (error) return { status: "error", message: `Gagal mencatat akuisisi: ${error.message}` };

    if (creator.status === "prospek") {
      await admin.from("creators").update({ status: "binding" }).eq("id", creatorId);
    }

    await writeAudit({
      actorId: actor.id, action: "m8.acquisition_record", entityType: "acquisitions",
      entityId: String(acq.id),
      after: {
        creator_id: creatorId, lead_source: leadSource, binding_date: bindingDate,
        commission_share_at_binding: creator.commission_share, gmv_last_30d: gmvLast30d,
        quarter_end: quarterEnd(bindingDate),
      },
      type: "auto",
    });
    revalidatePath("/workspace/acquisition");
    return { status: "ok", message: `Binding ${creator.name ?? creatorId} tercatat (${leadSource}, ${bindingDate}).` };
  } catch (e) {
    return failure(e, "Gagal mencatat binding.");
  }
}

/**
 * Referral program ajak teman (§2C.2): catat perujuk + creator baru + sumber
 * (antar_creator vs platform — mekanisme/komisi beda, wajib dibedakan).
 */
export async function recordReferral(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.acquisition");
    const newCreatorId = String(formData.get("new_creator_id") ?? "").trim();
    const referrerId = String(formData.get("referrer_creator_id") ?? "").trim();
    const source = String(formData.get("referral_source") ?? "");
    if (!newCreatorId || !["antar_creator", "platform"].includes(source)) {
      return { status: "error", message: "Creator baru & sumber referral wajib diisi" };
    }
    // Referral platform tidak punya perujuk creator; antar-creator wajib punya.
    if (source === "antar_creator" && !referrerId) {
      return {
        status: "error",
        message: "Referral antar-creator wajib mencantumkan creator perujuk (CRT-...)",
      };
    }

    const admin = createAdminClient();
    const ids = [newCreatorId, ...(referrerId ? [referrerId] : [])];
    const { data: found } = await admin.from("creators").select("id").in("id", ids);
    const foundSet = new Set((found ?? []).map((c) => c.id));
    for (const id of ids) {
      if (!foundSet.has(id)) return { status: "error", message: `Creator ${id} tidak ditemukan` };
    }

    const { data: ref, error } = await admin
      .from("referrals")
      .insert({
        new_creator_id: newCreatorId,
        referrer_creator_id: source === "antar_creator" ? referrerId : null,
        referral_source: source, recorded_by: actor.id,
      })
      .select("id")
      .single();
    if (error) return { status: "error", message: `Gagal mencatat referral: ${error.message}` };

    await writeAudit({
      actorId: actor.id, action: "m8.referral_record", entityType: "referrals",
      entityId: String(ref.id),
      after: { new_creator_id: newCreatorId, referrer_creator_id: referrerId || null, referral_source: source },
      type: "auto",
    });
    revalidatePath("/workspace/acquisition");
    return { status: "ok", message: `Referral ${newCreatorId} tercatat (${source}).` };
  } catch (e) {
    return failure(e, "Gagal mencatat referral.");
  }
}

/** Tandai komisi referral dibayar (dimensi pembayaran — lead/finance/management). */
export async function markReferralPaid(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.referral_pay");
    const refId = Number(formData.get("referral_id"));
    if (!refId) return { status: "error", message: "referral_id tidak valid" };

    const admin = createAdminClient();
    const { data: ref } = await admin
      .from("referrals").select("id, commission_status, referral_source").eq("id", refId).maybeSingle();
    if (!ref) return { status: "error", message: `Referral #${refId} tidak ditemukan` };
    if (ref.commission_status === "dibayar") {
      return { status: "error", message: "Komisi referral sudah dibayar" };
    }

    const { error } = await admin
      .from("referrals").update({ commission_status: "dibayar" }).eq("id", refId);
    if (error) return { status: "error", message: `Gagal update: ${error.message}` };

    await writeAudit({
      actorId: actor.id, action: "m8.referral_paid", entityType: "referrals", entityId: String(refId),
      before: { commission_status: ref.commission_status }, after: { commission_status: "dibayar" },
      type: "auto",
    });
    revalidatePath("/workspace/acquisition");
    return { status: "ok", message: `Komisi referral #${refId} ditandai dibayar.` };
  } catch (e) {
    return failure(e, "Gagal menandai komisi referral.");
  }
}

/**
 * Handoff ke CM (§2C.3): creator ter-binding + sudah punya owner CPM →
 * status Aktif, handoff selesai. Assignment owner dilakukan CM Lead (M1 §3.4).
 */
export async function markHandoffDone(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.acquisition");
    const acqId = Number(formData.get("acquisition_id"));
    if (!acqId) return { status: "error", message: "acquisition_id tidak valid" };

    const admin = createAdminClient();
    const { data: acq } = await admin
      .from("acquisitions")
      .select("id, creator_id, handoff_done, creators(status, owner_cpm_id)")
      .eq("id", acqId)
      .maybeSingle();
    if (!acq) return { status: "error", message: `Akuisisi #${acqId} tidak ditemukan` };
    if (acq.handoff_done) return { status: "error", message: "Handoff sudah ditandai selesai" };
    const creator = acq.creators as unknown as { status: string; owner_cpm_id: string | null } | null;
    if (!creator?.owner_cpm_id) {
      return {
        status: "error",
        message: "Creator belum di-assign ke CPM — minta CM Lead assign dulu di CM Workspace",
      };
    }

    const { error } = await admin
      .from("acquisitions").update({ handoff_done: true }).eq("id", acqId);
    if (error) return { status: "error", message: `Gagal menandai handoff: ${error.message}` };
    if (creator.status !== "aktif" && acq.creator_id) {
      await admin.from("creators").update({ status: "aktif" }).eq("id", acq.creator_id);
    }

    await writeAudit({
      actorId: actor.id, action: "m8.handoff_cm", entityType: "acquisitions", entityId: String(acqId),
      before: { handoff_done: false, creator_status: creator.status },
      after: { handoff_done: true, creator_status: "aktif" },
      type: "auto",
    });
    revalidatePath("/workspace/acquisition");
    return { status: "ok", message: `Handoff #${acqId} selesai.` };
  } catch (e) {
    return failure(e, "Gagal menandai handoff.");
  }
}

/**
 * Refresh GMV post-join (§2C.1 — KR: GMV 3 bulan setelah join, window
 * m8.gmv_post_join_days): deterministik dari creator_period_summary (Module
 * 0.5 Fase 2 — repoint dari platform_metrics_raw, sama sumber data platform,
 * grain per-periode bukan per-hari — LOCKED §6.6), per acquisition yang punya
 * binding_date.
 */
export async function refreshGmvPostJoin(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.acquisition");
    void formData;
    const windowDays = await getConfig<number>("m8.gmv_post_join_days");
    const admin = createAdminClient();

    const acquisitions = await fetchAll<{ id: number; creator_id: string | null; binding_date: string | null; quarter_end: string | null }>(
      admin, "acquisitions", "id, creator_id, binding_date, quarter_end",
      (q) => q.not("binding_date", "is", null).not("creator_id", "is", null));

    let updated = 0;
    for (const acq of acquisitions) {
      const start = acq.binding_date!;
      const end = new Date(`${start}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + Number(windowDays));
      const endIso = end.toISOString().slice(0, 10);

      const rows = await fetchAll<{ affiliate_gmv: number | null; period_start: string }>(
        admin, "creator_period_summary", "affiliate_gmv, period_start",
        (q) => q.eq("creator_id", acq.creator_id!).gte("period_start", start).lt("period_start", endIso));
      const gmv = rows.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

      // Atribusi quartal (QA): total GMV binding_date → akhir quartal berjalan.
      const qEnd = acq.quarter_end ?? quarterEnd(start);
      const qRows = await fetchAll<{ affiliate_gmv: number | null }>(
        admin, "creator_period_summary", "affiliate_gmv",
        (q) => q.eq("creator_id", acq.creator_id!).gte("period_start", start).lte("period_start", qEnd));
      const gmvQuarter = qRows.reduce((s, r) => s + Number(r.affiliate_gmv ?? 0), 0);

      const { error } = await admin
        .from("acquisitions")
        .update({ gmv_post_join: gmv, gmv_quarter_actual: gmvQuarter, quarter_end: qEnd })
        .eq("id", acq.id);
      if (error) {
        return { status: "error", message: `Gagal update GMV post-join #${acq.id}: ${error.message}` };
      }
      updated++;
    }

    await writeAudit({
      actorId: actor.id, action: "m8.gmv_post_join_refresh", entityType: "acquisitions",
      entityId: null, after: { updated, window_days: windowDays }, type: "auto",
    });
    revalidatePath("/workspace/acquisition");
    return { status: "ok", message: `GMV post-join di-refresh untuk ${updated} akuisisi (window ${windowDays} hari).` };
  } catch (e) {
    return failure(e, "Gagal refresh GMV post-join.");
  }
}

/**
 * Daftarkan creator baru dari akuisisi (manual, bukan upload sheet). Creator
 * baru langsung status 'binding' (user: "bergabung") sampai handoff ke CM lewat
 * markHandoffDone menaikkan ke 'aktif'. Deterministik, 0 token AI.
 *
 * Aturan username (case-insensitive, ada index lower(username)):
 *  - belum ada          → INSERT baris baru (id CRT- terpusat, retry tabrakan).
 *  - ada + kontrak habis → RENEWAL: UPDATE baris yang sama (tanpa duplikat id).
 *  - ada + kontrak aktif → tolak dengan pesan berisi identitas creator lama.
 */
export async function registerCreator(
  _prev: AcquisitionActionResult,
  formData: FormData
): Promise<AcquisitionActionResult> {
  try {
    const actor = await requirePermission("m8.acquisition");

    // ---- WAJIB ----
    const username = String(formData.get("username") ?? "").trim();
    const name = String(formData.get("name") ?? "").trim();
    const phone = String(formData.get("phone") ?? "").trim();
    const followers = String(formData.get("followers") ?? "").trim();
    const ownerCpmId = String(formData.get("owner_cpm_id") ?? "").trim();
    const joinDate = String(formData.get("join_date") ?? "").trim();
    const contractEndDate = String(formData.get("contract_end_date") ?? "").trim();
    const domisili = String(formData.get("domisili") ?? "").trim();
    const uid = String(formData.get("uid") ?? "").trim();
    const shareRaw = String(formData.get("commission_share") ?? "").trim();

    const missing = { status: "error" as const };
    if (!username) return { ...missing, message: "Username wajib diisi" };
    if (!name) return { ...missing, message: "Nama Creator wajib diisi" };
    if (!phone) return { ...missing, message: "No HP wajib diisi" };
    if (!followers) return { ...missing, message: "Followers wajib diisi" };
    if (!ownerCpmId) return { ...missing, message: "CM wajib dipilih" };
    if (!domisili) return { ...missing, message: "Domisili wajib diisi" };
    if (!uid) return { ...missing, message: "UID wajib diisi" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) return { ...missing, message: "Tanggal Join wajib diisi" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(contractEndDate)) {
      return { ...missing, message: "Akhir Kontrak wajib diisi" };
    }
    if (contractEndDate <= joinDate) {
      return { ...missing, message: "Akhir Kontrak harus setelah tanggal Join" };
    }

    // Sharing Komisi diinput sebagai persen (22 = 22%).
    const sharePct = Number(shareRaw);
    if (!shareRaw || Number.isNaN(sharePct) || sharePct < 0 || sharePct > 100) {
      return { ...missing, message: "Sharing Komisi wajib diisi angka 0–100 (mis. 22 untuk 22%)" };
    }
    // commission_share disimpan sebagai fraksi (0.22 = 22%), sama seperti sumber
    // sync platform (lihat formatShare). Ini nilai AWAL saat registrasi saja —
    // TIDAK ADA endpoint edit/update untuk commission_share (CLAUDE.md #3): setelah
    // ini kolomnya read-only dan perubahan hanya datang dari sync platform. INSERT
    // & RENEWAL lewat service-role client (bypass trigger protect_commission_share).
    const commissionShare = sharePct / 100;

    // Level opsional; bila diisi harus 1–8.
    const levelRaw = String(formData.get("level") ?? "").trim();
    let level: number | null = null;
    if (levelRaw) {
      const n = Number(levelRaw);
      if (!Number.isInteger(n) || n < 1 || n > 8) {
        return { status: "error", message: "Level harus antara 1–8" };
      }
      level = n;
    }

    // ---- OPSIONAL (kosong → null / omit) ----
    const platformRaw = String(formData.get("platform") ?? "").trim().toLowerCase();
    const platform = PLATFORMS.includes(platformRaw as (typeof PLATFORMS)[number]) ? platformRaw : null;
    const topNiches = parseNiches(String(formData.get("top_niches") ?? "").trim());
    const payload: Record<string, unknown> = {
      username,
      name,
      phone,
      followers,
      owner_cpm_id: ownerCpmId,
      join_date: joinDate,
      contract_end_date: contractEndDate,
      domisili,
      uid,
      level,
      platform,
      jenis_creator: String(formData.get("jenis_creator") ?? "").trim() || null,
      niche: topNiches?.[0] ?? null,
      top_niches: topNiches,
      content_quality: String(formData.get("content_quality") ?? "").trim() || null,
      gmv: parseRupiah(String(formData.get("gmv") ?? "")),
      gmv_live: parseRupiah(String(formData.get("gmv_live") ?? "")),
      gmv_video: parseRupiah(String(formData.get("gmv_video") ?? "")),
      rc_live: String(formData.get("rc_live") ?? "").trim() || null,
      rc_video: String(formData.get("rc_video") ?? "").trim() || null,
      rate_card: parseRupiah(String(formData.get("rate_card") ?? "")),
    };

    const admin = createAdminClient();

    // CM harus benar-benar CM Lead / CPM aktif (owner_cpm_id → team_members).
    const { data: cm } = await admin
      .from("team_members").select("id, role").eq("id", ownerCpmId).maybeSingle();
    if (!cm || !["cm_lead", "cpm"].includes(cm.role)) {
      return { status: "error", message: "CM yang dipilih tidak valid (harus CM Lead / CPM)" };
    }

    // Username match case-insensitive; escape wildcard ilike lalu verifikasi di JS
    // (handle bisa mengandung "_"/"." yang jadi wildcard pattern ilike).
    const escaped = username.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: matches } = await admin
      .from("creators")
      .select("id, name, status, join_date, contract_end_date, commission_share, username")
      .ilike("username", escaped);
    const existing =
      (matches ?? []).find((c) => (c.username ?? "").toLowerCase() === username.toLowerCase()) ?? null;

    const today = new Date().toISOString().slice(0, 10);

    let result: AcquisitionActionResult;

    if (!existing) {
      // ---- INSERT baru; retry pada tabrakan id CRT- yang langka. ----
      let insertedId = "";
      let lastError = "";
      for (let attempt = 0; attempt < 3 && !insertedId; attempt++) {
        const id = genId("CRT");
        const { error } = await admin.from("creators").insert({
          id, status: "binding", commission_share: commissionShare, ...payload,
        });
        if (!error) insertedId = id;
        else if (error.code === "23505") lastError = error.message; // id collision → retry
        else return { status: "error", message: `Gagal mendaftarkan creator: ${error.message}` };
      }
      if (!insertedId) {
        return { status: "error", message: `Gagal mendaftarkan creator: ${lastError}` };
      }

      await writeAudit({
        actorId: actor.id, action: "m8.creator_register", entityType: "creators",
        entityId: insertedId,
        after: { id: insertedId, status: "binding", commission_share: commissionShare, ...payload },
        type: "auto",
      });
      result = {
        status: "ok",
        message: `Creator ${name} (@${username}) terdaftar sebagai ${insertedId}, status binding.`,
      };
    } else if (existing.contract_end_date != null && String(existing.contract_end_date) < today) {
      // ---- RENEWAL (perpanjangan): kontrak sudah habis → pakai baris & id yang sama. ----
      const before = {
        status: existing.status, join_date: existing.join_date,
        contract_end_date: existing.contract_end_date, commission_share: existing.commission_share,
      };
      // Drop empty optional fields so a blank renewal form doesn't erase existing
      // master data (same rule as uploadCreators). Required fields are never null.
      const renewal: Record<string, unknown> = {
        status: "binding", commission_share: commissionShare, ...payload,
      };
      for (const k of Object.keys(renewal)) if (renewal[k] === null) delete renewal[k];
      const { error } = await admin.from("creators").update(renewal).eq("id", existing.id);
      if (error) return { status: "error", message: `Gagal memperpanjang creator: ${error.message}` };

      await writeAudit({
        actorId: actor.id, action: "m8.creator_reregister", entityType: "creators",
        entityId: existing.id, before,
        after: { id: existing.id, ...renewal },
        type: "auto",
      });
      result = {
        status: "ok",
        message: `Kontrak ${existing.name} (${existing.id}) diperpanjang s/d ${contractEndDate}, status binding.`,
      };
    } else {
      // ---- Username terpakai & kontrak masih aktif / tanpa akhir kontrak → tolak. ----
      // Termasuk kasus paling sering: form ter-submit dua kali, submit kedua
      // menemukan kreator yang baru saja dibuat submit pertama.
      return {
        status: "error",
        message:
          `Username "${username}" sudah terdaftar: ${existing.name} (${existing.id}, status ` +
          `${existing.status}, kontrak s/d ${existing.contract_end_date ?? "tidak ada"}). ` +
          "Registrasi baru hanya untuk kreator yang kontraknya sudah habis — kalau ini kiriman " +
          "kedua dari form yang sama, kreatornya sudah tersimpan dan tidak perlu diulang.",
      };
    }

    revalidatePath("/workspace/acquisition");
    revalidatePath("/creators");
    return result;
  } catch (e) {
    return failure(e, "Gagal mendaftarkan creator.");
  }
}
