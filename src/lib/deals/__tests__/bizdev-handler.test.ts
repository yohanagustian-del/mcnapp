import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHeader } from "@/lib/utils/csv";
import {
  BIZDEV_HANDLER_COLUMNS,
  BIZDEV_HANDLER_REQUIRED_HEADERS,
  buildBizdevHandlerRows,
  buildBizdevHandlerTemplate,
  diffHandlers,
  validateHandlerIds,
} from "../bizdev-handler-spec";
import { assignHandlersOnRegister, handlerIdsFromForm, syncShopHandlers } from "../bizdev-handlers";

describe("template ↔ parser round-trip", () => {
  it("header template = kolom yang dibaca parser, dan lolos probe header parseSheet", () => {
    const wb = XLSX.read(buildBizdevHandlerTemplate(), { type: "array" });
    expect(wb.SheetNames).toEqual(["BizDev Handler", "Petunjuk"]);
    const [header] = XLSX.utils.sheet_to_json<string[]>(wb.Sheets["BizDev Handler"], { header: 1 });
    expect(header).toEqual(BIZDEV_HANDLER_COLUMNS.map((c) => c.label));
    const normalized = header.map(normalizeHeader);
    expect(BIZDEV_HANDLER_REQUIRED_HEADERS.some((h) => normalized.includes(h))).toBe(true);

    // Isi template seperti user lalu baca balik lewat parser.
    const row = Object.fromEntries(normalized.map((h, i) => [h, ["7495001", "Skintific", "Rina", "Budi"][i]]));
    const [parsed] = buildBizdevHandlerRows([row]);
    expect(parsed).toMatchObject({ shopId: "7495001", shopName: "Skintific", names: ["Rina", "Budi"], error: null });
  });
});

describe("buildBizdevHandlerRows", () => {
  it("kedua BizDev kosong = tidak mengubah; baris kosong total diabaikan", () => {
    const rows = buildBizdevHandlerRows([
      { shop_id: "1", shop_name: "", bizdev_1: "", bizdev_2: "" },
      { shop_id: "", shop_name: "", bizdev_1: "", bizdev_2: "" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].names).toEqual([]);
    expect(rows[0].rowNumber).toBe(2);
  });

  it("nama ganda (beda kapital) disatukan; spasi dirapikan", () => {
    const [r] = buildBizdevHandlerRows([{ shop_id: "1", bizdev_1: " Rina  Ayu ", bizdev_2: "rina ayu" }]);
    expect(r.names).toEqual(["Rina Ayu"]);
  });

  it("Shop ID notasi ilmiah / bukan angka tanpa Shop Name → error, tidak crash", () => {
    const [a, b] = buildBizdevHandlerRows([
      { shop_id: "7.495E+18", bizdev_1: "Rina" },
      { shop_id: "abc", bizdev_1: "Rina" },
    ]);
    expect(a.error).toMatch(/notasi ilmiah/);
    expect(b.error).toMatch(/bukan angka/);
  });

  it("Shop ID kotor tapi Shop Name ada → dicari lewat nama", () => {
    const [r] = buildBizdevHandlerRows([{ shop_id: "n/a", shop_name: "Dvara", bizdev_1: "Rina" }]);
    expect(r).toMatchObject({ shopId: null, shopName: "Dvara", error: null });
  });
});

describe("validateHandlerIds / diffHandlers", () => {
  it("maks 2 dan tanpa duplikat", () => {
    expect(validateHandlerIds([])).toBeNull();
    expect(validateHandlerIds(["a", "b"])).toBeNull();
    expect(validateHandlerIds(["a", "b", "c"])).toMatch(/Maksimal 2/);
    expect(validateHandlerIds(["a", "a"])).toMatch(/dua kali/);
  });
  it("selisih: hapus yang keluar, tambah yang masuk", () => {
    expect(diffHandlers(["a", "b"], ["b", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(diffHandlers(["a"], ["a"])).toEqual({ add: [], remove: [] });
  });
  it("handlerIdsFromForm membaca dua select, tanpa kosong/duplikat", () => {
    const fd = new FormData();
    fd.set("bizdev_handler_1", "u1");
    fd.set("bizdev_handler_2", "u1");
    expect(handlerIdsFromForm(fd)).toEqual(["u1"]);
  });
});

// ─── fake Supabase untuk brand_bizdev_handlers / team_members ───
function fakeDb(opts: { handlers?: { shop_key: string; member_id: string }[]; missing?: boolean; members?: string[] }) {
  const handlers = [...(opts.handlers ?? [])];
  const ops: string[] = [];
  const missingErr = { code: "PGRST205", message: "Could not find the table in the schema cache" };
  const client = {
    from(table: string) {
      if (table === "team_members") {
        const q = {
          select: () => q, in: () => q, eq: () => q,
          order: () => Promise.resolve({ data: (opts.members ?? []).map((id) => ({ id, name: id.toUpperCase() })), error: null }),
        };
        return q;
      }
      let shopKey = "";
      let memberIn: string[] = [];
      return {
        select: () => ({
          eq: (_c: string, v: string) =>
            Promise.resolve(
              opts.missing
                ? { data: null, error: missingErr }
                : { data: handlers.filter((h) => h.shop_key === v), error: null }
            ),
        }),
        delete: () => {
          const chain = {
            eq: (_c: string, v: string) => { shopKey = v; return chain; },
            in: (_c: string, v: string[]) => {
              memberIn = v;
              for (let i = handlers.length - 1; i >= 0; i--) {
                if (handlers[i].shop_key === shopKey && memberIn.includes(handlers[i].member_id)) handlers.splice(i, 1);
              }
              ops.push(`delete:${memberIn.join(",")}`);
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
        insert: (rows: { shop_key: string; member_id: string }[]) => {
          handlers.push(...rows);
          ops.push(`insert:${rows.map((r) => r.member_id).join(",")}`);
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, handlers, ops };
}

describe("syncShopHandlers", () => {
  it("menulis selisih (hapus dulu, lalu tambah) + entri audit type auto", async () => {
    const db = fakeDb({ handlers: [{ shop_key: "tiktok:A", member_id: "u1" }, { shop_key: "tiktok:A", member_id: "u2" }] });
    const { result, audit } = await syncShopHandlers(db.client, "actor", "tiktok:A", ["u2", "u3"], "row_edit");
    expect(result).toEqual({ added: ["u3"], removed: ["u1"] });
    expect(db.ops).toEqual(["delete:u1", "insert:u3"]);
    expect(audit).toMatchObject({ action: "deals.bizdev_handler", type: "auto", entityId: "tiktok:A" });
    expect(db.handlers.map((h) => h.member_id).sort()).toEqual(["u2", "u3"]);
  });

  it("tanpa perubahan → tidak menulis apa pun, audit null", async () => {
    const db = fakeDb({ handlers: [{ shop_key: "tiktok:A", member_id: "u1" }] });
    const { audit } = await syncShopHandlers(db.client, "actor", "tiktok:A", ["u1"], "upload");
    expect(audit).toBeNull();
    expect(db.ops).toEqual([]);
  });

  it("> 2 handler ditolak sebelum menyentuh DB", async () => {
    const db = fakeDb({});
    await expect(syncShopHandlers(db.client, "a", "k", ["1", "2", "3"], "upload")).rejects.toThrow(/Maksimal 2/);
    expect(db.ops).toEqual([]);
  });

  it("tabel belum ada → pesan Migrasi 0087", async () => {
    const db = fakeDb({ missing: true });
    await expect(syncShopHandlers(db.client, "a", "k", ["1"], "upload")).rejects.toThrow(/Migrasi 0087 belum di-apply/);
  });
});

describe("assignHandlersOnRegister (Registrasi Deal)", () => {
  it("brand baru tanpa handler → disimpan", async () => {
    const db = fakeDb({ members: ["u1"] });
    const r = await assignHandlersOnRegister(db.client, "actor", "tiktok:B", ["u1"]);
    expect(r.note).toBeNull();
    expect(r.audit?.after).toMatchObject({ source: "register" });
    expect(db.handlers).toHaveLength(1);
  });

  it("brand sudah punya handler → TIDAK ditimpa, beri catatan", async () => {
    const db = fakeDb({ members: ["u1", "u2"], handlers: [{ shop_key: "tiktok:B", member_id: "u2" }] });
    const r = await assignHandlersOnRegister(db.client, "actor", "tiktok:B", ["u1"]);
    expect(r.note).toMatch(/sudah punya BizDev/);
    expect(db.handlers.map((h) => h.member_id)).toEqual(["u2"]);
  });

  it("anggota bukan BizDev aktif → tidak disimpan", async () => {
    const db = fakeDb({ members: ["u1"] });
    const r = await assignHandlersOnRegister(db.client, "actor", "tiktok:B", ["zz"]);
    expect(r.note).toMatch(/hanya anggota aktif/);
    expect(db.handlers).toHaveLength(0);
  });

  it("migrasi belum di-apply → registrasi tetap jalan, catatan Migrasi 0087", async () => {
    const db = fakeDb({ members: ["u1"], missing: true });
    const r = await assignHandlersOnRegister(db.client, "actor", "tiktok:B", ["u1"]);
    expect(r.note).toMatch(/Migrasi 0087/);
  });
});
