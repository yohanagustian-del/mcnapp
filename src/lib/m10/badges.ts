// Badge sidebar Request Ads & Finance (D-2026-10-31-6) — dihitung saat render dari
// sumber (pola pic-tap-alerts.ts), tanpa tabel notifikasi. Semua query ringan (count/limit).

import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission, type TeamMember } from "@/lib/rbac-constants";
import { todayWib } from "@/lib/utils/date";
import { canAccRequest, type RequestStatus } from "./request";
import type { FundingType, PaymentMethod } from "./funding-spec";
import { loadInvoiceConfig } from "./invoice-data";

export interface AdsBadges {
  /** Badge menu Request Ads: antrean eksekusi (executor) + approval Director + request saya yang ditolak 7 hari terakhir. */
  ads: number;
  adsTitle: string | undefined;
  /** Badge menu Finance: request menunggu ACC yang bisa di-ACC role ini + invoice jatuh tempo / segera. */
  finance: number;
  financeTitle: string | undefined;
}

const EMPTY: AdsBadges = { ads: 0, adsTitle: undefined, finance: 0, financeTitle: undefined };

export async function loadAdsBadges(member: TeamMember): Promise<AdsBadges> {
  const admin = createAdminClient();
  const parts: string[] = [];
  let ads = 0;
  try {
    if (hasPermission("m10.brief_execute", member.role)) {
      const { count } = await admin.from("ads_briefs").select("id", { count: "exact", head: true }).in("status", ["siap_dieksekusi"] satisfies RequestStatus[]);
      if (count) { ads += count; parts.push(`${count} request siap dieksekusi`); }
    }
    if (hasPermission("m10.budget_approve", member.role)) {
      const { count } = await admin.from("ads_briefs").select("id", { count: "exact", head: true }).in("status", ["menunggu_approval_director", "menunggu_approval"] satisfies RequestStatus[]);
      if (count) { ads += count; parts.push(`${count} menunggu approval Director`); }
    }
    if (hasPermission("m10.brief_create", member.role)) {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { count } = await admin.from("ads_briefs").select("id", { count: "exact", head: true })
        .eq("created_by", member.id).eq("status", "ditolak").gte("updated_at", since);
      if (count) { ads += count; parts.push(`${count} request Anda ditolak (7 hari terakhir)`); }
    }
  } catch {
    return EMPTY;
  }

  let finance = 0;
  const fparts: string[] = [];
  if (hasPermission("finance.ads_review", member.role) || hasPermission("finance.view", member.role)) {
    try {
      if (hasPermission("finance.ads_review", member.role)) {
        const { data } = await admin.from("ads_briefs").select("funding_type, payment_method")
          .in("status", ["menunggu_finance", "diajukan"] satisfies RequestStatus[]).limit(500);
        const mine = ((data ?? []) as { funding_type: FundingType | null; payment_method: PaymentMethod | null }[])
          .filter((r) => r.funding_type && canAccRequest(member.role, r.funding_type, r.payment_method)).length;
        if (mine) { finance += mine; fparts.push(`${mine} request menunggu ACC Anda`); }
      }
      if (hasPermission("finance.invoice_manage", member.role)) {
        const cfg = await loadInvoiceConfig(admin);
        const cutoff = new Date(Date.parse(`${todayWib()}T00:00:00Z`) + cfg.reminderDays * 86_400_000).toISOString().slice(0, 10);
        const { count } = await admin.from("ads_invoices").select("id", { count: "exact", head: true }).eq("status", "terbit").lte("due_date", cutoff);
        if (count) { finance += count; fparts.push(`${count} invoice jatuh tempo / segera jatuh tempo`); }
      }
    } catch {
      /* 0100 belum di-apply → tanpa badge */
    }
  }

  return {
    ads,
    adsTitle: parts.length ? parts.join(" · ") : undefined,
    finance,
    financeTitle: fparts.length ? fparts.join(" · ") : undefined,
  };
}
