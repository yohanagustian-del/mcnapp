import { z } from "zod";

/** External Creator Workspace — pipeline scouting (M8 §2D.1). Options fixed by business decision. */
export const NICHE_OPTIONS = [
  "BHPC",
  "FASHION MEN",
  "KITCHENWARE",
  "HOME SUPPLIES",
  "FNB",
  "MOM N BABY",
  "AUTOMOTIVE",
  "FASHION & ACCECORIS",
  "FASHION WOMEN",
  "MUSLIM FASHION",
  "LIFESTYLE",
  "BAG & SHOES",
  "GADGET",
  "ELECTRONIC",
  "KIDS FASHION",
] as const;

export const PLATFORM_OPTIONS = [
  { value: "tiktok", label: "TikTok" },
  { value: "shopee", label: "Shopee" },
] as const;

export const CHANNEL_OPTIONS = [
  { value: "live", label: "Live" },
  { value: "video", label: "Video" },
  { value: "vt_live", label: "VT & Live" },
  { value: "product_card", label: "Product Card" },
] as const;

/** Date fields that make up the scouting pipeline, in stage order. */
export const APPROACH_DATE_STAGES = [
  { field: "scouting_date", label: "Scouting" },
  { field: "reachout_date", label: "Reachout" },
  { field: "respon_date", label: "Respon" },
  { field: "follow_up_1_date", label: "Follow Up 1" },
  { field: "follow_up_2_date", label: "Follow Up 2" },
  { field: "follow_up_3_date", label: "Follow Up 3" },
  { field: "using_tap_date", label: "Using TAP" },
] as const;

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const optionalText = z.preprocess(emptyToUndefined, z.string().trim().optional());
const optionalDate = z.preprocess(emptyToUndefined, z.string().optional());
const optionalInt = z.preprocess(emptyToUndefined, z.coerce.number().int("Harus angka bulat").nonnegative("Tidak boleh negatif").optional());
const optionalGmv = z.preprocess(emptyToUndefined, z.coerce.number().nonnegative("Tidak boleh negatif").optional());

export const externalApproachSchema = z.object({
  username: z.string().trim().min(1, "Username wajib diisi"),
  brand: z.string().trim().min(1, "Brand wajib diisi"),
  creator_id: optionalText,
  niche: z.preprocess(emptyToUndefined, z.enum(NICHE_OPTIONS).optional()),
  platform: z.preprocess(
    emptyToUndefined,
    z.enum(PLATFORM_OPTIONS.map((o) => o.value) as [string, ...string[]]).optional()
  ),
  followers: optionalInt,
  // UI shows a fixed "+62" prefix; this is only the trailing digits the user types.
  wa_number: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^0?\d{6,15}$/, "Nomor WA tidak valid")
      .optional()
  ),
  gmv: optionalGmv,
  channel: z.preprocess(
    emptyToUndefined,
    z.enum(CHANNEL_OPTIONS.map((o) => o.value) as [string, ...string[]]).optional()
  ),
  scouting_date: optionalDate,
  reachout_date: optionalDate,
  respon_date: optionalDate,
  follow_up_1_date: optionalDate,
  follow_up_2_date: optionalDate,
  follow_up_3_date: optionalDate,
  using_tap_date: optionalDate,
  prove_link: optionalText,
  notes: optionalText,
});

export type ExternalApproachInput = z.infer<typeof externalApproachSchema>;

/** "0812..." / "812..." → "62812..." — the single normalized shape stored in DB. */
export function toWaContact(waNumber: string | undefined): string | null {
  if (!waNumber) return null;
  const digits = waNumber.replace(/^0+/, "");
  return `62${digits}`;
}

/** Strips the "62" prefix back off for pre-filling the edit form's input. */
export function fromWaContact(waContact: string | null | undefined): string {
  if (!waContact) return "";
  return waContact.startsWith("62") ? waContact.slice(2) : waContact;
}

export interface ExternalApproachRow {
  id: number;
  creator_name: string;
  creator_id: string | null;
  /** Nama pengisi data (team_members.name via approached_by), auto — bukan field form. */
  approached_by_name: string | null;
  brand: string | null;
  niche: string | null;
  platform: string | null;
  followers: number | null;
  wa_contact: string | null;
  gmv: number | null;
  channel: string | null;
  approach_date: string | null;
  reachout_date: string | null;
  respon_date: string | null;
  follow_up_1_date: string | null;
  follow_up_2_date: string | null;
  follow_up_3_date: string | null;
  using_tap_date: string | null;
  prove_link: string | null;
  notes: string | null;
}
