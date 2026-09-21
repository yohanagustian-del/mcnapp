/**
 * Report live stream per slot Jadwal Live (M13 ↔ M7, migrasi 0066) — aturan
 * murni tanpa I/O, supaya bisa diuji tanpa database dan dipakai server maupun
 * klien dengan definisi yang sama (CLAUDE.md #4).
 *
 * Fitur ini OPSIONAL per slot: sebuah slot boleh selamanya tanpa data sesi.
 * Yang ditentukan di sini hanya slot MANA yang layak menerima upload, dan
 * bagaimana ringkasan "sudah ada data / report" ditampilkan di kalender.
 */
import type { LiveScheduleSlot, SlotStatus } from "./types";

/** Status slot yang tidak pernah punya live → tidak ada yang bisa diunggah. */
const NO_LIVE_STATUSES: SlotStatus[] = ["off", "cancelled"];

export type SlotUploadEligibility =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Apakah slot ini boleh menerima file sesi live. Slot OFF / "tidak jadi live"
 * jelas tidak; slot masa depan juga tidak (live-nya belum terjadi — file yang
 * "sudah ada" untuk tanggal besok hampir pasti salah slot).
 */
export function slotUploadEligibility(
  slot: Pick<LiveScheduleSlot, "status" | "schedule_date">,
  todayIso: string
): SlotUploadEligibility {
  if (NO_LIVE_STATUSES.includes(slot.status)) {
    return {
      ok: false,
      reason:
        slot.status === "off"
          ? "Slot ini ditandai OFF — tidak ada live yang bisa dilaporkan."
          : "Slot ini diverifikasi tidak jadi live — tidak ada data sesi untuk diunggah.",
    };
  }
  if (slot.schedule_date > todayIso) {
    return { ok: false, reason: "Slot ini masih di masa depan — unggah data setelah live-nya berjalan." };
  }
  return { ok: true };
}

/** Ringkasan data live per slot yang ditempel di kalender & daftar. */
export interface SlotLiveSummary {
  slotId: number;
  /** Sesi yang masih dihitung (verified / confirmed_manual). */
  sessions: number;
  gmv: number;
  reportStatus: "draft" | "final" | null;
}

export interface SlotSessionRowLite {
  schedule_slot_id: number | null;
  gmv: number | string | null;
  attribution_status: string;
}

export interface SlotReportRowLite {
  schedule_slot_id: number | null;
  status: string;
}

/**
 * Gabungkan baris sesi + baris report menjadi peta per slot. Sesi `voided` dan
 * `disputed` tidak dihitung (R41 — sama dengan roll-up project). Report `final`
 * menang atas `draft` bila keduanya ada.
 */
export function summarizeSlotLive(
  sessions: SlotSessionRowLite[],
  reports: SlotReportRowLite[]
): Map<number, SlotLiveSummary> {
  const out = new Map<number, SlotLiveSummary>();
  const get = (slotId: number): SlotLiveSummary => {
    const cur = out.get(slotId) ?? { slotId, sessions: 0, gmv: 0, reportStatus: null };
    out.set(slotId, cur);
    return cur;
  };
  for (const s of sessions) {
    if (s.schedule_slot_id === null) continue;
    if (s.attribution_status !== "verified" && s.attribution_status !== "confirmed_manual") continue;
    const cur = get(s.schedule_slot_id);
    cur.sessions += 1;
    cur.gmv += Number(s.gmv ?? 0);
  }
  for (const r of reports) {
    if (r.schedule_slot_id === null) continue;
    if (r.status !== "draft" && r.status !== "final") continue;
    const cur = get(r.schedule_slot_id);
    if (cur.reportStatus !== "final") cur.reportStatus = r.status;
  }
  return out;
}

/** Label pendek untuk badge di kalender: "2 sesi · Rp1,2jt · Report final". */
export function slotLiveBadgeLabel(summary: SlotLiveSummary | undefined): string | null {
  if (!summary || (summary.sessions === 0 && !summary.reportStatus)) return null;
  const parts: string[] = [];
  if (summary.sessions > 0) parts.push(`${summary.sessions} sesi`);
  if (summary.reportStatus) parts.push(summary.reportStatus === "final" ? "Report final" : "Report draft");
  return parts.join(" · ");
}
