import { describe, expect, it } from "vitest";
import {
  FUNDING_TYPES,
  fundingBadgeLabel,
  fundingNeedsCashCheck,
  fundingNeedsPaymentMethod,
  fundingProducesInvoice,
  legacyAdsPayerToFunding,
} from "../funding-spec";
import {
  OPEN_STATUSES,
  REQUEST_STATUSES,
  TERMINAL_STATUSES,
  TRANSITIONS,
  accRolesFor,
  budgetMonthOf,
  canAccRequest,
  checkMeaBudget,
  financeGate,
  initialRequestStatus,
  invoiceAmounts,
  invoiceDueDate,
  invoiceReminderState,
  invoiceSeqOf,
  nextInvoiceNumber,
  transition,
  validatePayment,
  validateRequestInput,
} from "../request";

describe("funding-spec (D-2026-10-31-3)", () => {
  it("empat tipe pendanaan; creator & brand wajib metode pembayaran", () => {
    expect(FUNDING_TYPES).toEqual(["mea_budget", "creator_budget", "brand_budget", "tiktok_ads_credit"]);
    expect(fundingNeedsPaymentMethod("creator_budget")).toBe(true);
    expect(fundingNeedsPaymentMethod("brand_budget")).toBe(true);
    expect(fundingNeedsPaymentMethod("mea_budget")).toBe(false);
    expect(fundingNeedsPaymentMethod("tiktok_ads_credit")).toBe(false);
  });

  it("cash di awal → cek uang masuk; invoice → terbit invoice (kreator maupun brand)", () => {
    expect(fundingNeedsCashCheck("brand_budget", "cash_upfront")).toBe(true);
    expect(fundingNeedsCashCheck("creator_budget", "invoice")).toBe(false);
    expect(fundingProducesInvoice("brand_budget", "invoice")).toBe(true);
    expect(fundingProducesInvoice("mea_budget", null)).toBe(false);
  });

  it("label badge & pemetaan ads_payer lama", () => {
    expect(fundingBadgeLabel("creator_budget", "invoice")).toBe("Creator Budget · Invoice");
    expect(fundingBadgeLabel("mea_budget", null)).toBe("Budget MEA");
    expect(fundingBadgeLabel(null, null)).toBeNull();
    expect(legacyAdsPayerToFunding("invoicing_mea")).toEqual({ fundingType: "creator_budget", paymentMethod: "invoice" });
    expect(legacyAdsPayerToFunding("mea")?.fundingType).toBe("mea_budget");
    expect(legacyAdsPayerToFunding("organik")).toBeNull();
  });
});

describe("mesin status Request Ads (§2.4)", () => {
  it("setiap status punya baris di tabel transisi; terminal tanpa jalan keluar", () => {
    for (const s of REQUEST_STATUSES) expect(TRANSITIONS[s]).toBeDefined();
    for (const s of TERMINAL_STATUSES) expect(Object.keys(TRANSITIONS[s])).toHaveLength(0);
    for (const s of OPEN_STATUSES) expect(TERMINAL_STATUSES).not.toContain(s);
  });

  it("alur utama: menunggu_finance → siap_dieksekusi → dikerjakan → selesai", () => {
    expect(transition("menunggu_finance", "finance_acc")).toEqual({ ok: true, to: "siap_dieksekusi" });
    expect(transition("siap_dieksekusi", "claim")).toEqual({ ok: true, to: "dikerjakan" });
    expect(transition("dikerjakan", "finish")).toEqual({ ok: true, to: "selesai" });
  });

  it("lewat jatah MEA: Director dulu, baru antrean ACC", () => {
    expect(transition("menunggu_approval_director", "director_approve")).toEqual({ ok: true, to: "menunggu_finance" });
    expect(transition("menunggu_approval_director", "director_reject")).toEqual({ ok: true, to: "ditolak" });
  });

  it("transisi tidak sah → pesan Bahasa Indonesia dalam kurung siku", () => {
    const r = transition("menunggu_finance", "claim");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^\[.*\]$/);
    expect(transition("selesai", "cancel").ok).toBe(false);
    expect(transition("dikerjakan", "cancel").ok).toBe(false);
  });

  it("brief lama 0012 (baru/menunggu_approval) tetap bisa dilanjutkan", () => {
    expect(transition("baru", "claim")).toEqual({ ok: true, to: "dikerjakan" });
    expect(transition("menunggu_approval", "director_approve")).toEqual({ ok: true, to: "menunggu_finance" });
  });
});

describe("jatah budget MEA per kreator per bulan (D-2026-10-31-4)", () => {
  it("tanpa jatah = 0 → request apa pun butuh Director", () => {
    const c = checkMeaBudget(null, 0, 500_000);
    expect(c.budget).toBe(0);
    expect(c.needsDirectorApproval).toBe(true);
  });

  it("di dalam jatah → langsung antrean ACC; melebihi → Director", () => {
    expect(checkMeaBudget(2_000_000, 1_000_000, 1_000_000).needsDirectorApproval).toBe(false);
    expect(checkMeaBudget(2_000_000, 1_000_000, 1_000_001).needsDirectorApproval).toBe(true);
    expect(checkMeaBudget(2_000_000, 1_500_000, null).remaining).toBe(500_000);
  });

  it("initialRequestStatus hanya menggerbang mea_budget", () => {
    const over = checkMeaBudget(0, 0, 100);
    expect(initialRequestStatus({ fundingType: "mea_budget", meaCheck: over })).toBe("menunggu_approval_director");
    expect(initialRequestStatus({ fundingType: "brand_budget", meaCheck: null })).toBe("menunggu_finance");
    expect(initialRequestStatus({ fundingType: "mea_budget", meaCheck: checkMeaBudget(1000, 0, 100) })).toBe("menunggu_finance");
  });

  it("bulan jatah = bulan tanggal live", () => {
    expect(budgetMonthOf("2026-10-31")).toBe("2026-10-01");
  });
});

describe("validasi isian & gate Finance", () => {
  it("wajib pendanaan, nominal > 0, tepat satu pemilik", () => {
    expect(validateRequestInput({ fundingType: null, paymentMethod: null, budgetRequested: 1, ownerSlotId: 1, ownerProjectId: null }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "creator_budget", paymentMethod: null, budgetRequested: 1, ownerSlotId: 1, ownerProjectId: null }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "mea_budget", paymentMethod: "invoice", budgetRequested: 1, ownerSlotId: 1, ownerProjectId: null }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "mea_budget", paymentMethod: null, budgetRequested: 0, ownerSlotId: 1, ownerProjectId: null }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "mea_budget", paymentMethod: null, budgetRequested: 1, ownerSlotId: 1, ownerProjectId: 2 }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "mea_budget", paymentMethod: null, budgetRequested: 1, ownerSlotId: null, ownerProjectId: null }).ok).toBe(false);
    expect(validateRequestInput({ fundingType: "brand_budget", paymentMethod: "invoice", budgetRequested: 1, ownerSlotId: null, ownerProjectId: 2 }).ok).toBe(true);
  });

  it("cash = Finance saja (+Director); invoice/MEA/credit = Head CM atau Finance", () => {
    expect(accRolesFor("creator_budget", "cash_upfront")).toEqual(["finance", "director"]);
    expect(canAccRequest("cm_lead", "creator_budget", "cash_upfront")).toBe(false);
    expect(canAccRequest("head", "brand_budget", "invoice")).toBe(true);
    expect(canAccRequest("cm_lead", "mea_budget", null)).toBe(true);
    expect(canAccRequest("finance", "tiktok_ads_credit", null)).toBe(true);
    expect(canAccRequest("bizdev", "mea_budget", null)).toBe(false);
    expect(canAccRequest("od_viewer", "mea_budget", null)).toBe(false);
  });

  it("cash tanpa tanggal uang masuk tidak bisa di-ACC", () => {
    const r = financeGate({ fundingType: "brand_budget", paymentMethod: "cash_upfront", cashReceivedAt: null });
    expect(r.ok).toBe(false);
    expect(financeGate({ fundingType: "brand_budget", paymentMethod: "cash_upfront", cashReceivedAt: "2026-10-31" }).ok).toBe(true);
    expect(financeGate({ fundingType: "brand_budget", paymentMethod: "invoice", cashReceivedAt: null }).ok).toBe(true);
  });
});

describe("invoice (D-2026-10-31-6)", () => {
  it("PPN otomatis dari tarif config, dibulatkan ke rupiah", () => {
    expect(invoiceAmounts(1_000_000, 0.11)).toEqual({ dpp: 1_000_000, ppn: 110_000, total: 1_110_000, ppnRate: 0.11 });
    expect(invoiceAmounts(333_333, 0.11).ppn).toBe(36_667);
  });

  it("jatuh tempo & pengingat dihitung, tidak disimpan", () => {
    expect(invoiceDueDate("2026-10-31", 14)).toBe("2026-11-14");
    expect(invoiceReminderState("2026-11-14", "2026-11-01", 3, false)).toBe("aman");
    expect(invoiceReminderState("2026-11-14", "2026-11-11", 3, false)).toBe("segera");
    expect(invoiceReminderState("2026-11-14", "2026-11-15", 3, false)).toBe("jatuh_tempo");
    expect(invoiceReminderState("2026-11-14", "2026-11-20", 3, true)).toBe("aman");
  });

  it("nomor INV-YYYYMM-NNNN berurutan per bulan, tidak dipakai ulang", () => {
    expect(nextInvoiceNumber("202610", 0)).toBe("INV-202610-0001");
    expect(nextInvoiceNumber("202610", 7)).toBe("INV-202610-0008");
    expect(invoiceSeqOf("INV-202610-0008")).toBe(8);
    expect(invoiceSeqOf("DEAL-ABCDE")).toBeNull();
    expect(() => nextInvoiceNumber("2026-10", 0)).toThrow();
  });

  it("pembayaran harus penuh dan tidak melebihi total", () => {
    expect(validatePayment(1_110_000, null).ok).toBe(false);
    expect(validatePayment(1_110_000, 2_000_000).ok).toBe(false);
    expect(validatePayment(1_110_000, 1_000_000).ok).toBe(false);
    expect(validatePayment(1_110_000, 1_110_000).ok).toBe(true);
  });
});
