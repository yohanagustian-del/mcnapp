import { describe, it, expect, beforeEach } from "vitest";
import type { ChangeSet, FieldValue, FinanceTransaction } from "./change-request";
import {
  cancelFinanceChange,
  createFinanceTransaction,
  decideFinanceChange,
  requestFinanceChange,
  type Actor,
  type AuditEntry,
  type Deps,
  type FinanceStore,
  type PendingChangeRow,
} from "./service";

/**
 * Uji orkestrasi port kit TANPA database.
 *
 * Fake store di bawah sengaja MENIRU penjaga DB, bukan cuma menyimpan data:
 *   - updateTransactionFields menolak field terkunci (seperti trigger guard_finance_txn_update)
 *   - insertChange menolak pengajuan `menunggu` kedua (seperti unique index partial)
 *   - applyChange menolak pengajuan yang sudah diputuskan (seperti apply_finance_change)
 * Jadi kalau orkestratornya suatu saat "mengambil jalan pintas" dan menyentuh field
 * terkunci langsung, tes ini gagal — bukan lolos diam-diam lalu meledak di produksi.
 */

const GUARDED = [
  "direction", "client_name", "deal_id", "creator_id", "project_id", "invoice_no", "amount",
  "payment_method", "payment_terms", "payment_status", "bank_name", "bank_account_no",
  "bank_account_name", "due_date", "paid_at",
];

const LEAD: Actor = { id: "lead-1", canCreate: true, canRequest: true, canApprove: false, isManagement: false };
const LEAD2: Actor = { id: "lead-2", canCreate: true, canRequest: true, canApprove: false, isManagement: false };
const STAFF: Actor = { id: "staff-1", canCreate: true, canRequest: false, canApprove: false, isManagement: false };
const DIRECTOR: Actor = { id: "dir-1", canCreate: true, canRequest: true, canApprove: true, isManagement: true };
const HEAD: Actor = { id: "head-1", canCreate: true, canRequest: true, canApprove: false, isManagement: true };

class FakeStore implements FinanceStore {
  txns = new Map<string, FinanceTransaction>();
  changes: PendingChangeRow[] = [];
  guarded = [...GUARDED];
  /** Setiap UPDATE yang lolos ke "DB" — dipakai untuk membuktikan apa yang disentuh. */
  writes: Record<string, FieldValue>[] = [];
  private seq = 0;
  private changeSeq = 0;

  async getTransaction(id: string) {
    return this.txns.get(id) ?? null;
  }

  async nextTransactionId(period: string) {
    if (!/^\d{6}$/.test(period)) throw new Error(`Periode harus YYYYMM, dapat "${period}"`);
    this.seq += 1;
    return `TRX-${period}-${String(this.seq).padStart(4, "0")}`;
  }

  async insertTransaction(row: Record<string, FieldValue> & { id: string; created_by: string }) {
    // Kolom nullable yang tidak dikirim form default ke null, seperti DEFAULT di DB.
    const nullables = {
      deal_id: null, creator_id: null, project_id: null, invoice_no: null,
      bank_name: null, bank_account_no: null, bank_account_name: null,
      due_date: null, paid_at: null, notes: null,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    };
    this.txns.set(row.id, { ...nullables, ...row } as unknown as FinanceTransaction);
    return row.id;
  }

  /** Meniru trigger: field terkunci DITOLAK, apa pun pemanggilnya. */
  async updateTransactionFields(id: string, patch: Record<string, FieldValue>) {
    for (const key of Object.keys(patch)) {
      if (this.guarded.includes(key)) {
        throw new Error(`Field "${key}" hanya bisa diubah lewat approval Director`);
      }
    }
    const txn = this.txns.get(id);
    if (!txn) throw new Error("tidak ada");
    Object.assign(txn, patch);
    this.writes.push({ ...patch });
  }

  async findPendingChange(transactionId: string) {
    const row = this.changes.find((c) => c.transaction_id === transactionId && c.status === "menunggu");
    return row ? { id: row.id } : null;
  }

  /** Meniru unique index partial: satu pengajuan `menunggu` per transaksi. */
  async insertChange(input: { transactionId: string; changes: ChangeSet; reason: string; requestedBy: string }) {
    if (this.changes.some((c) => c.transaction_id === input.transactionId && c.status === "menunggu")) {
      throw new Error("unique violation: sudah ada pengajuan menunggu");
    }
    this.changeSeq += 1;
    this.changes.push({
      id: this.changeSeq,
      transaction_id: input.transactionId,
      changes: input.changes,
      reason: input.reason,
      status: "menunggu",
      requested_by: input.requestedBy,
    });
    return this.changeSeq;
  }

  async getChange(id: number) {
    return this.changes.find((c) => c.id === id) ?? null;
  }

  /** Meniru apply_finance_change: verifikasi status, lalu patch tanpa lewat trigger. */
  async applyChange(requestId: number, actorId: string) {
    const req = this.changes.find((c) => c.id === requestId);
    if (!req) throw new Error("tidak ditemukan");
    if (req.status !== "menunggu") throw new Error(`sudah diputuskan (${req.status})`);
    const txn = this.txns.get(req.transaction_id)!;
    for (const [field, change] of Object.entries(req.changes)) {
      (txn as unknown as Record<string, FieldValue>)[field] = change!.after;
    }
    req.status = "approved";
    req.requested_by = req.requested_by; // jejak pengaju tidak berubah
    void actorId;
  }

  async closeChange(id: number, patch: { status: "ditolak" | "dibatalkan" }) {
    const req = this.changes.find((c) => c.id === id);
    if (!req) throw new Error("tidak ditemukan");
    req.status = patch.status;
  }

  async readGuardedFields() {
    return this.guarded;
  }
}

let store: FakeStore;
let audits: AuditEntry[];
let deps: Deps;

const BASE_FIELDS = {
  client_name: "Femmy Official",
  amount: "Rp75.000.000",
  payment_method: "transfer_bank",
  bank_name: "BCA",
  bank_account_no: "1234567890",
  bank_account_name: "PT MEA Agensi Digital",
  invoice_no: "INV/2026/08/001",
  due_date: "2026-08-31",
};

beforeEach(() => {
  store = new FakeStore();
  audits = [];
  deps = {
    store,
    writeAudit: async (e) => { audits.push(e); },
    now: () => new Date("2026-08-04T00:00:00Z"),
  };
});

async function seedTxn(): Promise<string> {
  return await createFinanceTransaction(deps, LEAD, { fields: BASE_FIELDS });
}

describe("catat transaksi", () => {
  it("membuat nomor TRX-YYYYMM-NNNN dari periode jatuh tempo & mengaudit `auto`", async () => {
    const id = await seedTxn();
    expect(id).toBe("TRX-202608-0001");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "finance.transaction_create", type: "auto", entityId: id });
  });

  it("memakai periode sekarang kalau jatuh tempo kosong", async () => {
    const { due_date: _omit, ...noDue } = BASE_FIELDS;
    expect(await createFinanceTransaction(deps, LEAD, { fields: noDue })).toBe("TRX-202608-0001");
  });

  it("mengisi default arah/termin/status kalau form tidak mengirimnya", async () => {
    const id = await seedTxn();
    expect(store.txns.get(id)).toMatchObject({
      direction: "masuk", payment_terms: "invoice", payment_status: "pending",
    });
  });

  it("membaca Rupiah campur jadi angka", async () => {
    const id = await seedTxn();
    expect(store.txns.get(id)!.amount).toBe(75_000_000);
  });

  it("menolak aktor tanpa izin & field wajib kosong", async () => {
    const noPerm: Actor = { ...STAFF, canCreate: false };
    await expect(createFinanceTransaction(deps, noPerm, { fields: BASE_FIELDS })).rejects.toThrow(/Akses ditolak/);
    await expect(
      createFinanceTransaction(deps, LEAD, { fields: { client_name: "X", payment_method: "qris" } }),
    ).rejects.toThrow(/Nominal wajib diisi/);
  });
});

describe("ajukan perubahan — pemisahan izin", () => {
  it("staff finance TIDAK boleh mengajukan", async () => {
    const id = await seedTxn();
    await expect(
      requestFinanceChange(deps, STAFF, {
        transactionId: id, fields: { payment_method: "qris" }, reason: "klien minta ganti ke QRIS",
      }),
    ).rejects.toThrow(/hanya bisa diajukan Senior\/Lead Finance/);
  });

  it("lead finance boleh mengajukan, tapi transaksi BELUM berubah", async () => {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id,
      fields: { payment_method: "virtual_account", bank_account_no: "0987654321" },
      reason: "Klien pindah ke Virtual Account BCA per 4 Agustus",
    });

    expect(out.awaitingApproval.sort()).toEqual(["bank_account_no", "payment_method"]);
    expect(out.appliedNow).toEqual([]);
    expect(out.changeRequestId).toBe(1);
    // Inti aturannya: nilai lama masih berlaku.
    expect(store.txns.get(id)).toMatchObject({
      payment_method: "transfer_bank", bank_account_no: "1234567890",
    });
    // Dan orkestratornya tidak menulis apa pun ke transaksi.
    expect(store.writes).toEqual([]);
  });
});

describe("ajukan perubahan — pemisahan field", () => {
  it("keterangan berlaku langsung + audit `auto`, tanpa pengajuan", async () => {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id, fields: { notes: "konfirmasi via email PIC" }, reason: "",
    });
    expect(out).toMatchObject({ appliedNow: ["notes"], awaitingApproval: [], changeRequestId: null });
    expect(store.txns.get(id)!.notes).toBe("konfirmasi via email PIC");
    expect(audits.at(-1)).toMatchObject({ action: "finance.transaction_edit_free", type: "auto" });
  });

  it("campuran: keterangan jalan, uang menunggu Director", async () => {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id,
      fields: { notes: "revisi PO klien", amount: "Rp80.000.000" },
      reason: "PO direvisi klien, nominal naik",
    });
    expect(out.appliedNow).toEqual(["notes"]);
    expect(out.awaitingApproval).toEqual(["amount"]);
    expect(store.txns.get(id)).toMatchObject({ notes: "revisi PO klien", amount: 75_000_000 });
    expect(audits.map((a) => a.action)).toEqual([
      "finance.transaction_create", "finance.transaction_edit_free", "finance.change_requested",
    ]);
    expect(audits.at(-1)!.type).toBe("approval");
  });

  it("mengikuti config: field terkunci digeser → jalur perubahan ikut bergeser", async () => {
    const id = await seedTxn();
    store.guarded = ["amount"]; // metode kini bebas
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id, fields: { payment_method: "qris" }, reason: "",
    });
    expect(out).toMatchObject({ appliedNow: ["payment_method"], awaitingApproval: [] });
    expect(store.txns.get(id)!.payment_method).toBe("qris");
  });
});

describe("ajukan perubahan — penjaga input", () => {
  it("menolak kalau tidak ada yang berubah", async () => {
    const id = await seedTxn();
    await expect(
      requestFinanceChange(deps, LEAD, {
        transactionId: id, fields: { payment_method: "transfer_bank" }, reason: "tidak ada bedanya",
      }),
    ).rejects.toThrow(/Tidak ada field yang berubah/);
  });

  it("alasan wajib kalau ada field terkunci", async () => {
    const id = await seedTxn();
    await expect(
      requestFinanceChange(deps, LEAD, { transactionId: id, fields: { payment_method: "qris" }, reason: "ganti" }),
    ).rejects.toThrow(/terlalu singkat/);
  });

  it("alasan TIDAK wajib kalau cuma field bebas (tak ada yang memutuskan)", async () => {
    const id = await seedTxn();
    await expect(
      requestFinanceChange(deps, LEAD, { transactionId: id, fields: { notes: "typo" }, reason: "" }),
    ).resolves.toMatchObject({ appliedNow: ["notes"] });
  });

  it("menolak transaksi yang tidak ada", async () => {
    await expect(
      requestFinanceChange(deps, LEAD, {
        transactionId: "TRX-202608-9999", fields: { notes: "x" }, reason: "",
      }),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  it("pengajuan kedua ditolak dengan pesan yang bisa ditindaklanjuti, bukan error DB", async () => {
    const id = await seedTxn();
    await requestFinanceChange(deps, LEAD, {
      transactionId: id, fields: { amount: "Rp80.000.000" }, reason: "PO direvisi klien",
    });
    await expect(
      requestFinanceChange(deps, LEAD2, {
        transactionId: id, fields: { amount: "Rp1.000.000" }, reason: "pengajuan tandingan lead lain",
      }),
    ).rejects.toThrow(/Batalkan dulu sebelum mengajukan yang baru/);
    // Bukan unique-violation dari store.
    expect(store.changes.filter((c) => c.status === "menunggu")).toHaveLength(1);
  });

  it("tanggal teks bebas ditolak sebelum menyentuh store", async () => {
    const id = await seedTxn();
    await expect(
      requestFinanceChange(deps, LEAD, {
        transactionId: id, fields: { due_date: "19 February 2026" }, reason: "ganti jatuh tempo klien",
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
    expect(store.changes).toHaveLength(0);
  });
});

describe("keputusan Director", () => {
  async function pending(): Promise<{ id: string; requestId: number }> {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id,
      fields: { payment_method: "virtual_account", bank_account_no: "0987654321", amount: "Rp80.000.000" },
      reason: "Klien pindah ke Virtual Account BCA, PO direvisi",
    });
    return { id, requestId: out.changeRequestId! };
  }

  it("approve menerapkan semua field sekali jalan + audit `approval`", async () => {
    const { id, requestId } = await pending();
    await decideFinanceChange(deps, DIRECTOR, { requestId, approve: true, note: "sudah dicek ke PIC" });
    expect(store.txns.get(id)).toMatchObject({
      payment_method: "virtual_account", bank_account_no: "0987654321", amount: 80_000_000,
    });
    expect(store.changes[0].status).toBe("approved");
    expect(audits.at(-1)).toMatchObject({ action: "finance.change_approved", type: "approval" });
  });

  it("lead & head TIDAK bisa memutuskan — hanya Director", async () => {
    const { requestId } = await pending();
    for (const actor of [LEAD, LEAD2, STAFF, HEAD]) {
      await expect(
        decideFinanceChange(deps, actor, { requestId, approve: true }),
      ).rejects.toThrow(/hanya Director/);
    }
    expect(store.changes[0].status).toBe("menunggu");
  });

  it("pengaju tidak boleh menyetujui pengajuannya sendiri walau punya izin approve", async () => {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, DIRECTOR, {
      transactionId: id, fields: { amount: "Rp90.000.000" }, reason: "Director mengajukan sendiri",
    });
    await expect(
      decideFinanceChange(deps, DIRECTOR, { requestId: out.changeRequestId!, approve: true }),
    ).rejects.toThrow(/tidak boleh menyetujui.*sendiri/);
  });

  it("penolakan wajib beralasan, dan transaksi tidak berubah", async () => {
    const { id, requestId } = await pending();
    await expect(
      decideFinanceChange(deps, DIRECTOR, { requestId, approve: false, note: "  " }),
    ).rejects.toThrow(/Alasan penolakan wajib diisi/);

    await decideFinanceChange(deps, DIRECTOR, { requestId, approve: false, note: "Rekening belum diverifikasi" });
    expect(store.changes[0].status).toBe("ditolak");
    expect(store.txns.get(id)).toMatchObject({ payment_method: "transfer_bank", amount: 75_000_000 });
    expect(audits.at(-1)).toMatchObject({ action: "finance.change_rejected", type: "approval" });
  });

  it("setelah ditolak, pengajuan baru boleh dibuat lagi", async () => {
    const { id, requestId } = await pending();
    await decideFinanceChange(deps, DIRECTOR, { requestId, approve: false, note: "salah rekening" });
    await expect(
      requestFinanceChange(deps, LEAD, {
        transactionId: id, fields: { payment_method: "qris" }, reason: "Klien akhirnya pilih QRIS",
      }),
    ).resolves.toMatchObject({ awaitingApproval: ["payment_method"] });
  });

  it("memutuskan dua kali ditolak", async () => {
    const { requestId } = await pending();
    await decideFinanceChange(deps, DIRECTOR, { requestId, approve: true });
    await expect(
      decideFinanceChange(deps, DIRECTOR, { requestId, approve: true }),
    ).rejects.toThrow(/sudah diputuskan/);
  });
});

describe("pembatalan", () => {
  async function pending(): Promise<number> {
    const id = await seedTxn();
    const out = await requestFinanceChange(deps, LEAD, {
      transactionId: id, fields: { amount: "Rp80.000.000" }, reason: "PO direvisi klien",
    });
    return out.changeRequestId!;
  }

  it("pengaju boleh membatalkan", async () => {
    const requestId = await pending();
    await cancelFinanceChange(deps, LEAD, { requestId, note: "salah input" });
    expect(store.changes[0].status).toBe("dibatalkan");
    expect(audits.at(-1)).toMatchObject({ action: "finance.change_cancelled", type: "approval" });
  });

  it("management boleh membatalkan pengajuan orang lain, lead lain tidak", async () => {
    const r1 = await pending();
    await expect(cancelFinanceChange(deps, LEAD2, { requestId: r1 })).rejects.toThrow(/Hanya pengaju atau management/);
    await cancelFinanceChange(deps, HEAD, { requestId: r1 });
    expect(store.changes[0].status).toBe("dibatalkan");
  });

  it("tidak bisa membatalkan yang sudah diputuskan", async () => {
    const requestId = await pending();
    await decideFinanceChange(deps, DIRECTOR, { requestId, approve: true });
    await expect(cancelFinanceChange(deps, LEAD, { requestId })).rejects.toThrow(/sudah diputuskan/);
  });

  it("setelah dibatalkan, pengajuan baru boleh dibuat", async () => {
    const requestId = await pending();
    const txnId = store.changes[0].transaction_id;
    await cancelFinanceChange(deps, LEAD, { requestId });
    await expect(
      requestFinanceChange(deps, LEAD, {
        transactionId: txnId, fields: { amount: "Rp90.000.000" }, reason: "nominal final dari klien",
      }),
    ).resolves.toMatchObject({ awaitingApproval: ["amount"] });
  });
});

describe("orkestrator tidak pernah menyentuh field terkunci langsung", () => {
  it("seluruh UPDATE yang keluar dari orkestrator hanya berisi field bebas", async () => {
    const id = await seedTxn();
    await requestFinanceChange(deps, LEAD, {
      transactionId: id,
      fields: { notes: "catatan", amount: "Rp80.000.000", payment_method: "qris" },
      reason: "klien revisi nominal & metode",
    });
    await decideFinanceChange(deps, DIRECTOR, {
      requestId: store.changes[0].id, approve: true, note: null,
    });
    // Fake store menolak field terkunci; kalau orkestrator mengambil jalan pintas,
    // tes sudah gagal di atas. Ini menegaskan APA yang sebenarnya lewat.
    for (const write of store.writes) {
      for (const key of Object.keys(write)) expect(GUARDED).not.toContain(key);
    }
    expect(store.writes).toEqual([{ notes: "catatan" }]);
  });
});
