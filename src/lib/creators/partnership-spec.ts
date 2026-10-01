import { canonicalHeader } from "./import-spec";
import { normalizeUsername } from "./username";

/**
 * Status kemitraan kreator (Improvement MCN T4/T5): Management Partnership (TikTok &
 * Shopee) + Fee Agreement (TikTok saja), dari file Excel yang disiapkan user — bukan
 * data platform, tidak ada edit manual per baris (keputusan Q2).
 *
 * Satu sumber kebenaran untuk kolom template DAN parser file yang diunggah — sama
 * dengan pola import kreator (import-spec.ts + import-template.ts): template yang
 * di-download dan parser yang membacanya kembali memakai `PARTNERSHIP_COLUMNS`.
 *
 * Pure (no DB) so it can be unit-tested; matching to creators happens in the upload
 * action via normalizeUsername().
 */

export const PARTNERSHIP_PLATFORMS = ["tiktok", "shopee"] as const;
export type PartnershipPlatform = (typeof PARTNERSHIP_PLATFORMS)[number];

export const PARTNERSHIP_STATUSES = ["linked", "not_linked", "link_req", "unlink_req"] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

export const FEE_AGREEMENT_STATUSES = ["agree", "disagree", "agreement_req", "cancellation_req"] as const;
export type FeeAgreementStatus = (typeof FEE_AGREEMENT_STATUSES)[number];

/** Fallback labels; the canonical copy lives in app_config `m8.partnership_status_labels`. */
export const PARTNERSHIP_STATUS_LABEL: Record<PartnershipStatus, string> = {
  linked: "LINKED",
  not_linked: "NOT LINKED",
  link_req: "LINK REQ",
  unlink_req: "UNLINK REQ",
};
export const FEE_AGREEMENT_STATUS_LABEL: Record<FeeAgreementStatus, string> = {
  agree: "AGREE",
  disagree: "DISAGREE",
  agreement_req: "AGREEMENT REQ",
  cancellation_req: "CANCELATION REQ",
};

export type PartnershipColumnKey = "username" | "name" | "platform" | "partnership" | "fee";

export interface PartnershipColumn {
  key: PartnershipColumnKey;
  /** Header written to the template. "*" marks the required column. */
  label: string;
  /** Canonical header forms accepted when reading (see canonicalHeader). */
  aliases: string[];
  required: boolean;
  /** Format note for the "Petunjuk" sheet. */
  note: string;
}

/** Order here = template column order. */
export const PARTNERSHIP_COLUMNS: PartnershipColumn[] = [
  {
    key: "username",
    label: "Username*",
    aliases: ["username", "usernametiktok", "usernameshopee", "handle"],
    required: true,
    note: "WAJIB. Handle akun tanpa @ (contoh: vikahere). Dicocokkan ke kreator yang sudah terdaftar; username yang tidak ditemukan dilewati (tidak membuat kreator baru).",
  },
  {
    key: "name",
    label: "Nama Kreator",
    aliases: ["namakreator", "namacreator", "nama", "name"],
    required: false,
    note: "Opsional. Hanya untuk memudahkan pengecekan — tidak mengubah nama kreator di sistem.",
  },
  {
    key: "platform",
    label: "Platform",
    aliases: ["platform"],
    required: false,
    note: "Opsional. tiktok atau shopee. Kosong = tiktok.",
  },
  {
    key: "partnership",
    label: "Management Partnership",
    aliases: ["managementpartnership", "partnership", "statuspartnership", "partnershipstatus"],
    required: false,
    note: "LINKED (= binding) / NOT LINKED / LINK REQ / UNLINK REQ. LINK dan BINDING terbaca sebagai LINKED. Kosong = status lama tidak diubah.",
  },
  {
    key: "fee",
    label: "Fee Agreement",
    aliases: ["feeagreement", "feeagreementstatus", "statusfeeagreement", "fee"],
    required: false,
    note: "Khusus TikTok: AGREE / DISAGREE / AGREEMENT REQ / CANCELATION REQ. Untuk Shopee diabaikan. Kosong = status lama tidak diubah.",
  },
];

/** parseSheet header-skip probe (normalized form; "*" is stripped by normalizeHeader). */
export const PARTNERSHIP_REQUIRED_HEADERS = ["username"];

// Canonical (a-z0-9 only) spellings → status. "Not Linked", "NOT_LINKED", "not-linked"
// all collapse to "notlinked".
const PARTNERSHIP_ALIASES: Record<string, PartnershipStatus> = {
  linked: "linked",
  link: "linked",
  binding: "linked",
  notlinked: "not_linked",
  linkreq: "link_req",
  linkrequest: "link_req",
  unlinkreq: "unlink_req",
  unlinkrequest: "unlink_req",
};
const FEE_ALIASES: Record<string, FeeAgreementStatus> = {
  agree: "agree",
  disagree: "disagree",
  agreementreq: "agreement_req",
  agreementrequest: "agreement_req",
  cancelationreq: "cancellation_req",
  cancellationreq: "cancellation_req",
  cancelationrequest: "cancellation_req",
  cancellationrequest: "cancellation_req",
};

const canon = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Result of reading one status cell: blank, a known value, or an unrecognised one. */
export type CellValue<T> = { kind: "blank" } | { kind: "value"; value: T } | { kind: "unknown"; raw: string };

export function parsePartnershipStatus(raw: string): CellValue<PartnershipStatus> {
  if (!raw.trim()) return { kind: "blank" };
  const v = PARTNERSHIP_ALIASES[canon(raw)];
  return v ? { kind: "value", value: v } : { kind: "unknown", raw: raw.trim() };
}

export function parseFeeAgreementStatus(raw: string): CellValue<FeeAgreementStatus> {
  if (!raw.trim()) return { kind: "blank" };
  const v = FEE_ALIASES[canon(raw)];
  return v ? { kind: "value", value: v } : { kind: "unknown", raw: raw.trim() };
}

export interface ParsedPartnershipRow {
  /** 1-based sheet row number (header = row 1), for messages. */
  rowNumber: number;
  username: string;
  name: string;
  platform: PartnershipPlatform;
  /** undefined = cell blank or unrecognised → leave the stored value untouched. */
  partnership?: PartnershipStatus;
  fee?: FeeAgreementStatus;
  /** Non-fatal notes (unrecognised value, fee on Shopee, …). */
  issues: string[];
  /** Fatal: the row is skipped entirely. */
  error: string | null;
}

function cell(row: Record<string, string>, column: PartnershipColumn): string {
  for (const [key, value] of Object.entries(row)) {
    if (column.aliases.includes(canonicalHeader(key))) return String(value ?? "").trim();
  }
  return "";
}

const COL = Object.fromEntries(PARTNERSHIP_COLUMNS.map((c) => [c.key, c])) as Record<
  PartnershipColumnKey,
  PartnershipColumn
>;

/**
 * Sheet rows (headers normalized by parseSheet) → parsed rows. Never throws on dirty
 * input (CLAUDE.md #7): unrecognised values are flagged and left out, not guessed.
 * A username repeated for the same platform keeps the FIRST row; later ones are errors.
 */
export function buildPartnershipRows(rows: Record<string, string>[]): ParsedPartnershipRow[] {
  const seen = new Set<string>();
  const out: ParsedPartnershipRow[] = [];
  rows.forEach((row, i) => {
    // Fully blank rows (the template's example rows, trailing rows) are not data.
    if (Object.values(row).every((v) => !String(v ?? "").trim())) return;
    out.push(parseRow(row, i + 2, seen));
  });
  return out;
}

function parseRow(row: Record<string, string>, rowNumber: number, seen: Set<string>): ParsedPartnershipRow {
  const username = normalizeUsername(cell(row, COL.username));
  const name = cell(row, COL.name);
  const rawPlatform = cell(row, COL.platform).toLowerCase();
  const issues: string[] = [];
  const out: ParsedPartnershipRow = { rowNumber, username, name, platform: "tiktok", issues, error: null };

  if (!username) {
    out.error = "Username kosong";
    return out;
  }
  if (rawPlatform && !(PARTNERSHIP_PLATFORMS as readonly string[]).includes(rawPlatform)) {
    out.error = `Platform "${rawPlatform}" tidak dikenal (hanya tiktok / shopee)`;
    return out;
  }
  out.platform = (rawPlatform || "tiktok") as PartnershipPlatform;

  const key = `${out.platform}:${username.toLowerCase()}`;
  if (seen.has(key)) {
    out.error = `Username @${username} (${out.platform}) muncul lebih dari sekali — baris pertama yang dipakai`;
    return out;
  }
  seen.add(key);

  const p = parsePartnershipStatus(cell(row, COL.partnership));
  if (p.kind === "value") out.partnership = p.value;
  else if (p.kind === "unknown") issues.push(`Management Partnership "${p.raw}" tidak dikenal — diabaikan`);

  const f = parseFeeAgreementStatus(cell(row, COL.fee));
  if (out.platform === "shopee") {
    if (f.kind !== "blank") issues.push("Fee Agreement hanya untuk TikTok — diabaikan untuk Shopee");
  } else if (f.kind === "value") out.fee = f.value;
  else if (f.kind === "unknown") issues.push(`Fee Agreement "${f.raw}" tidak dikenal — diabaikan`);

  if (out.partnership === undefined && out.fee === undefined) {
    out.error = "Tidak ada status yang bisa dibaca di baris ini";
  }
  return out;
}

export interface PartnershipState {
  partnership: PartnershipStatus | null;
  fee: FeeAgreementStatus | null;
}

/**
 * Apply a parsed row onto the stored state: blank/unrecognised cells keep the old value.
 * Shopee never carries a fee status (DB check ck_cps_fee_tiktok_only).
 */
export function mergePartnershipState(
  old: PartnershipState | null,
  row: Pick<ParsedPartnershipRow, "platform" | "partnership" | "fee">
): PartnershipState {
  return {
    partnership: row.partnership ?? old?.partnership ?? null,
    fee: row.platform === "shopee" ? null : (row.fee ?? old?.fee ?? null),
  };
}

const PARTNERSHIP_HEALTHY: PartnershipStatus[] = ["linked", "link_req"];
const PARTNERSHIP_DROP: PartnershipStatus[] = ["unlink_req", "not_linked"];
const FEE_DROP: FeeAgreementStatus[] = ["disagree", "cancellation_req"];

/**
 * Which parts of a status change are regressions (→ platform_alert, not approval —
 * the status comes from the platform-side relationship, it can't be undone here):
 *  - partnership: linked/link_req → unlink_req/not_linked
 *  - fee:         agree → disagree/cancellation_req
 * A first upload (no old state) is never a regression — there is nothing it dropped from.
 */
export function partnershipRegressions(
  old: PartnershipState | null,
  next: PartnershipState
): { partnership: boolean; fee: boolean } {
  return {
    partnership:
      !!old?.partnership &&
      PARTNERSHIP_HEALTHY.includes(old.partnership) &&
      !!next.partnership &&
      PARTNERSHIP_DROP.includes(next.partnership),
    fee: old?.fee === "agree" && !!next.fee && FEE_DROP.includes(next.fee),
  };
}

export function isPartnershipRegression(old: PartnershipState | null, next: PartnershipState): boolean {
  const r = partnershipRegressions(old, next);
  return r.partnership || r.fee;
}

export function partnershipStateChanged(old: PartnershipState | null, next: PartnershipState): boolean {
  return (old?.partnership ?? null) !== next.partnership || (old?.fee ?? null) !== next.fee;
}

/** Badge tone shared by CM Workspace, /creators and /creators/[id] (Improvement MCN T6/T7). */
export type PartnershipTone = "green" | "yellow" | "red" | "none";

export function partnershipTone(status: PartnershipStatus | FeeAgreementStatus | null | undefined): PartnershipTone {
  switch (status) {
    case "linked":
    case "agree":
      return "green";
    case "link_req":
    case "agreement_req":
      return "yellow";
    case "unlink_req":
    case "not_linked":
    case "disagree":
    case "cancellation_req":
      return "red";
    default:
      return "none";
  }
}

export const PARTNERSHIP_TONE_CLASS: Record<PartnershipTone, string> = {
  green: "bg-green-100 text-green-800",
  yellow: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  none: "bg-slate-100 text-slate-500",
};

export interface PartnershipStatusLabels {
  partnership: Record<PartnershipStatus, { label: string; meaning: string }>;
  fee_agreement: Record<FeeAgreementStatus, { label: string; meaning: string }>;
}

/** Read app_config `m8.partnership_status_labels`, falling back per status to the constants. */
export function resolvePartnershipLabels(raw: unknown): PartnershipStatusLabels {
  const v = (raw ?? {}) as Partial<Record<"partnership" | "fee_agreement", Record<string, unknown>>>;
  const pick = <K extends string>(
    src: Record<string, unknown> | undefined,
    keys: readonly K[],
    fallback: Record<K, string>
  ) =>
    Object.fromEntries(
      keys.map((k) => {
        const e = (src?.[k] ?? {}) as { label?: unknown; meaning?: unknown };
        return [
          k,
          {
            label: typeof e.label === "string" && e.label ? e.label : fallback[k],
            meaning: typeof e.meaning === "string" ? e.meaning : "",
          },
        ];
      })
    ) as Record<K, { label: string; meaning: string }>;
  return {
    partnership: pick(v.partnership, PARTNERSHIP_STATUSES, PARTNERSHIP_STATUS_LABEL),
    fee_agreement: pick(v.fee_agreement, FEE_AGREEMENT_STATUSES, FEE_AGREEMENT_STATUS_LABEL),
  };
}
