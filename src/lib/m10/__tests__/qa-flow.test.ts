// QA skenario Request Ads & Finance (plan §7 butir 4) — alur ujung-ke-ujung per role,
// memakai aturan yang SAMA dengan server action (izin RBAC + mesin status + gate Finance).
// Tiap `it` = satu skenario di docs/QA_REQUEST_ADS_FINANCE.md.
import { describe, expect, it } from "vitest";
import { hasPermission, type Role } from "@/lib/rbac-constants";
import { fundingProducesInvoice } from "../funding-spec";
import {
  canAccRequest,
  checkMeaBudget,
  financeGate,
  initialRequestStatus,
  invoiceAmounts,
  invoiceDueDate,
  invoiceReminderState,
  meaBudgetExhausted,
  transition,
  validatePayment,
  type RequestStatus,
} from "../request";

function step(from: RequestStatus, action: Parameters<typeof transition>[1]): RequestStatus {
  const t = transition(from, action);
  if (!t.ok) throw new Error(`${from} --${action}--> gagal: ${t.error}`);
  return t.to;
}

const can = (perm: Parameters<typeof hasPermission>[0], role: Role) => hasPermission(perm, role);

describe("QA alur Request Ads & Finance per role", () => {
  it("S1 Budget MEA dalam jatah: CPM ajukan → Head CM ACC → Creator Support eksekusi → selesai", () => {
    expect(can("m10.brief_create", "cpm")).toBe(true);
    const check = checkMeaBudget(2_000_000, 500_000, 1_000_000);
    let s = initialRequestStatus({ fundingType: "mea_budget", meaCheck: check });
    expect(s).toBe("menunggu_finance");

    // ACC: Head CM atau Finance (asumsi A1, dikonfirmasi); executor & pemohon tidak.
    for (const r of ["cm_lead", "head", "finance", "director"] as Role[]) {
      expect(can("finance.ads_review", r) && canAccRequest(r, "mea_budget", null)).toBe(true);
    }
    for (const r of ["cpm", "creator_support", "bizdev"] as Role[]) {
      expect(can("finance.ads_review", r) && canAccRequest(r, "mea_budget", null)).toBe(false);
    }
    expect(financeGate({ fundingType: "mea_budget", paymentMethod: null, cashReceivedAt: null }).ok).toBe(true);
    expect(fundingProducesInvoice("mea_budget", null)).toBe(false);
    s = step(s, "finance_acc");

    expect(can("m10.brief_execute", "creator_support")).toBe(true);
    expect(can("m10.brief_execute", "cpm")).toBe(false);
    s = step(s, "claim");
    expect(can("m10.result_input", "creator_support")).toBe(true);
    s = step(s, "finish");
    expect(s).toBe("selesai");
    expect(transition(s, "cancel").ok).toBe(false);
  });

  it("S2 Budget MEA melebihi jatah: tertahan approval Director, lalu antrean ACC; alert jatah habis", () => {
    const over = checkMeaBudget(1_000_000, 800_000, 500_000);
    let s = initialRequestStatus({ fundingType: "mea_budget", meaCheck: over });
    expect(s).toBe("menunggu_approval_director");
    expect(transition(s, "finance_acc").ok).toBe(false); // Finance tidak bisa melompati Director
    expect(can("m10.budget_approve", "director")).toBe(true);
    for (const r of ["head", "cm_lead", "finance"] as Role[]) expect(can("m10.budget_approve", r)).toBe(false);
    s = step(s, "director_approve");
    expect(s).toBe("menunggu_finance");
    // Setelah tersimpan, terpakai 1,3 jt ≥ jatah 1 jt → alert ads_mea_budget_exhausted terbuka.
    expect(meaBudgetExhausted(checkMeaBudget(1_000_000, 1_300_000, 0))).toBe(true);
    // Head menaikkan jatah ke 2 jt → alert tertutup.
    expect(meaBudgetExhausted(checkMeaBudget(2_000_000, 1_300_000, 0))).toBe(false);
    expect(can("m10.mea_budget_set", "head")).toBe(true);
    expect(can("m10.mea_budget_set", "cm_lead")).toBe(false);
  });

  it("S3 Creator Budget cash di awal: hanya Finance, wajib tanggal uang masuk, tanpa invoice", () => {
    expect(canAccRequest("cm_lead", "creator_budget", "cash_upfront")).toBe(false);
    expect(canAccRequest("head", "creator_budget", "cash_upfront")).toBe(false);
    expect(canAccRequest("finance", "creator_budget", "cash_upfront")).toBe(true);
    expect(canAccRequest("director", "creator_budget", "cash_upfront")).toBe(true);
    expect(financeGate({ fundingType: "creator_budget", paymentMethod: "cash_upfront", cashReceivedAt: null }).ok).toBe(false);
    expect(financeGate({ fundingType: "creator_budget", paymentMethod: "cash_upfront", cashReceivedAt: "2026-10-31" }).ok).toBe(true);
    expect(can("finance.invoice_manage", "finance")).toBe(true); // tombol catat uang masuk
    expect(fundingProducesInvoice("creator_budget", "cash_upfront")).toBe(false);
  });

  it("S4 Brand Budget invoice: Head CM boleh ACC → invoice terbit, PPN & jatuh tempo, lunas hanya penuh oleh Finance", () => {
    expect(canAccRequest("cm_lead", "brand_budget", "invoice")).toBe(true);
    expect(financeGate({ fundingType: "brand_budget", paymentMethod: "invoice", cashReceivedAt: null }).ok).toBe(true);
    expect(fundingProducesInvoice("brand_budget", "invoice")).toBe(true);

    const amt = invoiceAmounts(1_000_000, 0.11);
    expect(amt).toEqual({ dpp: 1_000_000, ppn: 110_000, total: 1_110_000, ppnRate: 0.11 });
    const due = invoiceDueDate("2026-10-31", 14);
    expect(due).toBe("2026-11-14");
    expect(invoiceReminderState(due, "2026-11-10", 3, false)).toBe("aman");
    expect(invoiceReminderState(due, "2026-11-11", 3, false)).toBe("segera");
    expect(invoiceReminderState(due, "2026-11-15", 3, false)).toBe("jatuh_tempo");
    expect(invoiceReminderState(due, "2026-11-15", 3, true)).toBe("aman");

    // Catat bayar/terkirim/batal invoice = Finance (+Director) saja; Head CM tidak.
    expect(can("finance.invoice_manage", "cm_lead")).toBe(false);
    expect(can("finance.invoice_manage", "finance")).toBe(true);
    expect(validatePayment(amt.total, 1_000_000).ok).toBe(false);
    expect(validatePayment(amt.total, 1_110_000).ok).toBe(true);
  });

  it("S5 TikTok Ads Credit: ACC Head CM atau Finance, tanpa invoice & tanpa cek cash", () => {
    expect(canAccRequest("cm_lead", "tiktok_ads_credit", null)).toBe(true);
    expect(canAccRequest("finance", "tiktok_ads_credit", null)).toBe(true);
    expect(fundingProducesInvoice("tiktok_ads_credit", null)).toBe(false);
    expect(financeGate({ fundingType: "tiktok_ads_credit", paymentMethod: null, cashReceivedAt: null }).ok).toBe(true);
  });

  it("S6 Pemisahan peran: Finance & Creator Support tidak membuat request; tolak/batal sesuai status", () => {
    expect(can("m10.brief_create", "finance")).toBe(false);
    expect(can("m10.brief_create", "creator_support")).toBe(false);
    for (const r of ["cm_lead", "cpm", "bizdev_lead", "bizdev", "campaign_ops"] as Role[]) {
      expect(can("m10.brief_create", r)).toBe(true);
    }
    expect(step("menunggu_finance", "finance_reject")).toBe("ditolak");
    expect(step("siap_dieksekusi", "cancel")).toBe("batal");
    expect(transition("dikerjakan", "cancel").ok).toBe(false);
    expect(transition("menunggu_finance", "claim").ok).toBe(false); // belum ACC → belum bisa dieksekusi
  });
});
