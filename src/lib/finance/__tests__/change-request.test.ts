import { describe, it, expect } from "vitest";
import {
  diffTransaction,
  normalizeFieldValue,
  partitionChanges,
  summarizeChanges,
  validateReason,
  isEditableField,
  EDITABLE_FIELDS,
  MIN_REASON_LENGTH,
} from "@/lib/finance/change-request";
import { formatTrxId, parseTrxId, trxPeriod, type FinanceTransaction } from "@/lib/finance/transaction";

const GUARDED = [
  "direction", "client_name", "deal_id", "creator_id", "project_id", "invoice_no", "amount",
  "payment_method", "payment_terms", "payment_status", "bank_name", "bank_account_no",
  "bank_account_name", "due_date", "paid_at",
];

const txn: FinanceTransaction = {
  id: "TRX-202608-0001",
  direction: "masuk",
  client_name: "Femmy Official",
  deal_id: "DEAL-A2C4E",
  creator_id: null,
  project_id: null,
  invoice_no: "INV/2026/08/001",
  amount: 75_000_000,
  payment_method: "transfer_bank",
  payment_terms: "invoice",
  payment_status: "pending",
  bank_name: "BCA",
  bank_account_no: "1234567890",
  bank_account_name: "PT MEA Agensi Digital",
  due_date: "2026-08-31",
  paid_at: null,
  notes: null,
  created_by: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
};

describe("nomor transaksi TRX-YYYYMM-NNNN", () => {
  it("memformat nomor urut jadi 4 digit", () => {
    expect(formatTrxId("202608", 1)).toBe("TRX-202608-0001");
    expect(formatTrxId("202608", 42)).toBe("TRX-202608-0042");
  });

  it("menolak periode & nomor urut tak valid", () => {
    expect(() => formatTrxId("2026-08", 1)).toThrow(/YYYYMM/);
    expect(() => formatTrxId("202608", 0)).toThrow(/Nomor urut/);
  });

  it("membaca kembali nomor transaksi", () => {
    expect(parseTrxId("TRX-202608-0001")).toEqual({ period: "202608", seq: 1 });
    expect(parseTrxId("DEAL-A2C4E")).toBeNull();
  });

  it("menurunkan periode dari tanggal", () => {
    expect(trxPeriod("2026-08-04T10:00:00Z")).toBe("202608");
    expect(trxPeriod("2026-12-31T23:00:00Z")).toBe("202612");
  });
});

describe("normalizeFieldValue", () => {
  it("membaca nominal Rupiah campur (koma & titik ribuan)", () => {
    expect(normalizeFieldValue("amount", "Rp1,075,484,867")).toBe(1_075_484_867);
    expect(normalizeFieldValue("amount", "Rp4.131.512.642")).toBe(4_131_512_642);
  });

  it("menolak nominal negatif & bukan angka", () => {
    expect(() => normalizeFieldValue("amount", "-5000")).toThrow(/negatif/);
    expect(() => normalizeFieldValue("amount", "not found")).toThrow(/bukan angka/);
  });

  it("menolak tanggal teks bebas — form finance wajib date picker", () => {
    expect(normalizeFieldValue("due_date", "2026-09-30")).toBe("2026-09-30");
    expect(() => normalizeFieldValue("due_date", "19 February 2026")).toThrow(/YYYY-MM-DD/);
  });

  it("memvalidasi enum metode/termin/status pembayaran", () => {
    expect(normalizeFieldValue("payment_method", "virtual_account")).toBe("virtual_account");
    expect(() => normalizeFieldValue("payment_method", "gopay")).toThrow(/tidak valid/);
    expect(() => normalizeFieldValue("payment_status", "lunas")).toThrow(/tidak valid/);
  });

  it("field wajib tidak boleh dikosongkan, field opsional jadi null", () => {
    expect(() => normalizeFieldValue("client_name", "  ")).toThrow(/wajib diisi/);
    expect(() => normalizeFieldValue("amount", "")).toThrow(/wajib diisi/);
    expect(normalizeFieldValue("invoice_no", "")).toBeNull();
    expect(normalizeFieldValue("notes", "")).toBeNull();
  });

  it("hanya field dalam whitelist yang bisa diajukan", () => {
    expect(isEditableField("payment_method")).toBe(true);
    expect(isEditableField("id")).toBe(false);
    expect(isEditableField("created_by")).toBe(false);
    expect(EDITABLE_FIELDS).not.toContain("id" as never);
  });
});

describe("diffTransaction", () => {
  it("hanya mengembalikan field yang benar-benar berubah", () => {
    const diff = diffTransaction(txn, {
      payment_method: "virtual_account",
      client_name: "Femmy Official", // sama → bukan perubahan
    });
    expect(Object.keys(diff)).toEqual(["payment_method"]);
    expect(diff.payment_method).toEqual({ before: "transfer_bank", after: "virtual_account" });
  });

  it("nominal sama walau ditulis beda format bukan perubahan", () => {
    expect(diffTransaction(txn, { amount: normalizeFieldValue("amount", "Rp75.000.000") })).toEqual({});
  });

  it("mengosongkan field opsional terhitung perubahan", () => {
    const diff = diffTransaction(txn, { invoice_no: null });
    expect(diff.invoice_no).toEqual({ before: "INV/2026/08/001", after: null });
  });

  it("mengisi field yang tadinya kosong terhitung perubahan", () => {
    const diff = diffTransaction(txn, { paid_at: "2026-08-20" });
    expect(diff.paid_at).toEqual({ before: null, after: "2026-08-20" });
  });

  it("field di luar usulan tidak pernah ikut", () => {
    expect(diffTransaction(txn, {})).toEqual({});
  });
});

describe("partitionChanges — approval vs berlaku langsung", () => {
  it("ganti metode pembayaran & rekening masuk jalur approval Director", () => {
    const diff = diffTransaction(txn, {
      payment_method: "virtual_account",
      bank_account_no: "0987654321",
    });
    const { guarded, free } = partitionChanges(diff, GUARDED);
    expect(Object.keys(guarded).sort()).toEqual(["bank_account_no", "payment_method"]);
    expect(free).toEqual({});
  });

  it("keterangan berlaku langsung (tidak merugikan → auto)", () => {
    const diff = diffTransaction(txn, { notes: "Klien minta ganti VA per 4 Agt" });
    const { guarded, free } = partitionChanges(diff, GUARDED);
    expect(guarded).toEqual({});
    expect(Object.keys(free)).toEqual(["notes"]);
  });

  it("campuran dipecah: uang menunggu approval, keterangan jalan", () => {
    const diff = diffTransaction(txn, { amount: 80_000_000, notes: "revisi PO klien" });
    const { guarded, free } = partitionChanges(diff, GUARDED);
    expect(Object.keys(guarded)).toEqual(["amount"]);
    expect(Object.keys(free)).toEqual(["notes"]);
  });

  it("daftar field terkunci datang dari config — daftar kosong = tak ada yang terkunci", () => {
    const diff = diffTransaction(txn, { payment_method: "qris" });
    expect(partitionChanges(diff, []).guarded).toEqual({});
    expect(Object.keys(partitionChanges(diff, []).free)).toEqual(["payment_method"]);
  });
});

describe("validateReason", () => {
  it("menolak alasan kosong atau terlalu singkat", () => {
    expect(() => validateReason("   ")).toThrow(/wajib diisi/);
    expect(() => validateReason("ganti")).toThrow(new RegExp(String(MIN_REASON_LENGTH)));
  });

  it("menerima alasan yang menjelaskan & memangkas spasi", () => {
    expect(validateReason("  Klien pindah ke virtual account BCA  ")).toBe(
      "Klien pindah ke virtual account BCA",
    );
  });
});

describe("summarizeChanges", () => {
  it("menulis before → after per field untuk panel Director & audit", () => {
    const diff = diffTransaction(txn, { payment_method: "qris", paid_at: "2026-08-20" });
    expect(summarizeChanges(diff)).toEqual([
      "Metode Pembayaran: transfer_bank → qris",
      "Tanggal Dibayar: — → 2026-08-20",
    ]);
  });
});
