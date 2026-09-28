// PLAN_MSDPS_mcnapp.md Paket B (R3, Q5): slot yang di-auto-verify oleh
// run_m13_auto_verify() (migrasi 0076) TIDAK terkunci selamanya seperti verifikasi
// manual — CM boleh mengoreksinya (ke "Live Dengan Jam Baru" atau "Tidak Jadi Live")
// dalam m13.auto_verify_correction_days hari sejak auto-verify. Di luar jendela itu,
// slot terkunci sama seperti verifikasi manual biasa.

/** Deadline koreksi (ISO instant) = verified_at + correctionDays. */
export function autoVerifyCorrectionDeadline(verifiedAt: string, correctionDays: number): string {
  const d = new Date(verifiedAt);
  d.setUTCDate(d.getUTCDate() + correctionDays);
  return d.toISOString();
}

/** true bila slot ini boleh diverifikasi ULANG meski status sudah 'done' — hanya
 *  untuk slot auto_sistem yang masih dalam jendela koreksi. */
export function canReviseAutoVerified(
  slot: { status: string; actual_time_source: string | null; verified_at: string | null },
  correctionDays: number,
  nowIso: string
): boolean {
  if (slot.status !== "done" || slot.actual_time_source !== "auto_sistem" || !slot.verified_at) return false;
  return nowIso < autoVerifyCorrectionDeadline(slot.verified_at, correctionDays);
}
