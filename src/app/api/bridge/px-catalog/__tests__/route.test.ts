import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Fake Supabase admin client — hanya mendukung operasi yang benar-benar
 * dipakai route.ts (px_catalog_pushes select/insert, px_catalog_items
 * upsert/update, audit_logs insert). Sengaja sempit (pola sama
 * src/lib/m7/__tests__/helpers/fake-supabase.ts) supaya query bentuk baru
 * yang tak didukung gagal berisik, bukan diam-diam salah.
 */
type Row = Record<string, unknown>;

class FakeTable {
  constructor(
    private rows: Row[],
    private key: (row: Row) => string
  ) {}

  find(pred: (row: Row) => boolean): Row[] {
    return this.rows.filter(pred);
  }

  upsert(newRows: Row[]) {
    for (const row of newRows) {
      const k = this.key(row);
      const idx = this.rows.findIndex((r) => this.key(r) === k);
      if (idx >= 0) this.rows[idx] = { ...this.rows[idx], ...row };
      else this.rows.push({ ...row });
    }
  }

  insert(row: Row) {
    this.rows.push({ ...row });
  }

  updateWhere(pred: (row: Row) => boolean, patch: Row) {
    for (const row of this.rows) {
      if (pred(row)) Object.assign(row, patch);
    }
  }

  all() {
    return this.rows;
  }
}

function buildFakeAdmin() {
  const pushes = new FakeTable([], (r) => String(r.batch_key));
  const items = new FakeTable([], (r) => `${r.client_platform_id}|${r.platform_product_id}`);
  const auditLogs = new FakeTable([], (r) => String(r.id ?? Math.random()));

  const tableOf = (name: string): FakeTable => {
    if (name === "px_catalog_pushes") return pushes;
    if (name === "px_catalog_items") return items;
    if (name === "audit_logs") return auditLogs;
    throw new Error(`FakeAdmin: tabel tak didukung: ${name}`);
  };

  function from(name: string) {
    const table = tableOf(name);
    const filters: Array<(row: Row) => boolean> = [];
    let pendingOp: { type: "upsert" | "insert" | "update"; rows?: Row[]; row?: Row; patch?: Row } | null = null;

    // Every chainable method returns `api` itself (not a fresh object), so a
    // chain like update(...).neq(...).eq(...) keeps its pendingOp/filters
    // through to the final `await api` which triggers `.then()`.
    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push((row) => row[col] === val);
        return api;
      },
      neq(col: string, val: unknown) {
        filters.push((row) => row[col] !== val);
        return api;
      },
      async maybeSingle() {
        const matched = table.find((row) => filters.every((f) => f(row)));
        return { data: matched[0] ?? null, error: null };
      },
      upsert(rows: Row | Row[]) {
        pendingOp = { type: "upsert", rows: Array.isArray(rows) ? rows : [rows] };
        return api;
      },
      insert(row: Row) {
        pendingOp = { type: "insert", row };
        return api;
      },
      update(patch: Row) {
        pendingOp = { type: "update", patch };
        return api;
      },
      then(resolve: (v: { error: null }) => void) {
        if (pendingOp?.type === "upsert") table.upsert(pendingOp.rows!);
        else if (pendingOp?.type === "insert") table.insert(pendingOp.row!);
        else if (pendingOp?.type === "update") {
          table.updateWhere((row) => filters.every((f) => f(row)), pendingOp!.patch!);
        }
        resolve({ error: null });
      },
    };
    return api;
  }

  return { from, _store: { pushes, items, auditLogs } };
}

const fakeAdmin = buildFakeAdmin();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => fakeAdmin,
}));

const { POST } = await import("../route");

const SECRET = "test-secret-px";
const ENDPOINT = "http://localhost/api/bridge/px-catalog";

function makeRequest(body: unknown, opts: { auth?: string; idempotencyKey?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== undefined) headers["Authorization"] = opts.auth;
  if (opts.idempotencyKey !== undefined) headers["Idempotency-Key"] = opts.idempotencyKey;
  return new NextRequest(ENDPOINT, { method: "POST", headers, body: JSON.stringify(body) });
}

const VALID_BODY = {
  snapshot_at: "2026-09-23T02:14:00Z",
  source: "cdps",
  policy_note: "px_catalog_item_v; verdict lolos pada policy aktif",
  rows: [
    {
      client_platform_id: "CLI-1",
      platform_product_id: "P1",
      nama_produk: "Produk A",
      platform: "tiktok",
      nama_toko: "Toko A",
      level2_category: "Kecantikan",
      price_segment: "high",
      sudah_afiliasi: false,
      dihitung_pada: "2026-09-22T18:00:00Z",
    },
  ],
};

beforeEach(() => {
  process.env.BRIDGE_PX_SECRET = SECRET;
  fakeAdmin._store.pushes.all().length = 0;
  fakeAdmin._store.items.all().length = 0;
  fakeAdmin._store.auditLogs.all().length = 0;
});

describe("POST /api/bridge/px-catalog", () => {
  it("401 saat bearer salah", async () => {
    const res = await POST(makeRequest(VALID_BODY, { auth: "Bearer salah", idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });

  it("401 saat header Authorization tidak ada", async () => {
    const res = await POST(makeRequest(VALID_BODY, { idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });

  it("401 fail-closed saat BRIDGE_PX_SECRET belum diset", async () => {
    delete process.env.BRIDGE_PX_SECRET;
    const res = await POST(makeRequest(VALID_BODY, { auth: `Bearer ${SECRET}`, idempotencyKey: "k1" }));
    expect(res.status).toBe(401);
  });

  it("422 saat kolom asing di baris", async () => {
    const bad = { ...VALID_BODY, rows: [{ ...VALID_BODY.rows[0], extra_column: "x" }] };
    const res = await POST(makeRequest(bad, { auth: `Bearer ${SECRET}`, idempotencyKey: "k2" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/tidak sesuai kontrak/);
  });

  it("422 saat kolom asing di top-level", async () => {
    const bad = { ...VALID_BODY, extra_top_level: true };
    const res = await POST(makeRequest(bad, { auth: `Bearer ${SECRET}`, idempotencyKey: "k3" }));
    expect(res.status).toBe(422);
  });

  it("422 saat price_segment di luar 5 segmen", async () => {
    const bad = { ...VALID_BODY, rows: [{ ...VALID_BODY.rows[0], price_segment: "mid" }] };
    const res = await POST(makeRequest(bad, { auth: `Bearer ${SECRET}`, idempotencyKey: "k4" }));
    expect(res.status).toBe(422);
  });

  it("422 saat Idempotency-Key tidak ada", async () => {
    const res = await POST(makeRequest(VALID_BODY, { auth: `Bearer ${SECRET}` }));
    expect(res.status).toBe(422);
  });

  it("rows kosong diterima (snapshot katalog PX kosong)", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, rows: [] }, { auth: `Bearer ${SECRET}`, idempotencyKey: "k5" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows_received).toBe(0);
  });

  it("200 pada payload valid: upsert item + catat push + audit", async () => {
    const res = await POST(makeRequest(VALID_BODY, { auth: `Bearer ${SECRET}`, idempotencyKey: "k6" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ batch_key: "k6", rows_received: 1, duplicate: false });

    const items = fakeAdmin._store.items.all();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ client_platform_id: "CLI-1", platform_product_id: "P1", active: true });

    const pushes = fakeAdmin._store.pushes.all();
    expect(pushes).toHaveLength(1);

    const audits = fakeAdmin._store.auditLogs.all();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "px.catalog_push" });
  });

  it("Idempotency-Key berulang -> 200 hasil ASLI, nol baris baru", async () => {
    await POST(makeRequest(VALID_BODY, { auth: `Bearer ${SECRET}`, idempotencyKey: "k7" }));
    const before = fakeAdmin._store.items.all().length;

    const secondBody = { ...VALID_BODY, rows: [{ ...VALID_BODY.rows[0], platform_product_id: "P2" }] };
    const res = await POST(makeRequest(secondBody, { auth: `Bearer ${SECRET}`, idempotencyKey: "k7" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
    expect(json.rows_received).toBe(1); // hasil ASLI (1 baris pertama), bukan payload baru
    expect(fakeAdmin._store.items.all().length).toBe(before); // tidak ada baris baru dari payload kedua
  });

  it("snapshot baru menonaktifkan baris yang hilang dari push sebelumnya", async () => {
    await POST(makeRequest(VALID_BODY, { auth: `Bearer ${SECRET}`, idempotencyKey: "k8" }));

    const secondBody = {
      ...VALID_BODY,
      rows: [{ ...VALID_BODY.rows[0], platform_product_id: "P2", nama_produk: "Produk B" }],
    };
    await POST(makeRequest(secondBody, { auth: `Bearer ${SECRET}`, idempotencyKey: "k9" }));

    const items = fakeAdmin._store.items.all();
    const p1 = items.find((r) => r.platform_product_id === "P1");
    const p2 = items.find((r) => r.platform_product_id === "P2");
    expect(p1?.active).toBe(false); // hilang dari snapshot k9 -> nonaktif
    expect(p2?.active).toBe(true);
  });
});
