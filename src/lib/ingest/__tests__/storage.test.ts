import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { zipSync } from "fflate";
import {
  assertValidObjectRef, downloadIngestFile, ingestObjectPaths, removeIngestFiles, unpackIngestObject,
  INGEST_BUCKET, INGEST_MAX_PARTS,
} from "../storage";

describe("assertValidObjectRef", () => {
  it("accepts a well-formed ref", () => {
    expect(() =>
      assertValidObjectRef({ path: "uid-1/abc-mcn.xlsx", name: "data.xlsx" }, "MCN")
    ).not.toThrow();
  });

  it("rejects path traversal, absolute paths, and empty/oversized paths", () => {
    expect(() => assertValidObjectRef({ path: "../secret", name: "a" }, "MCN")).toThrow(/Path/);
    expect(() => assertValidObjectRef({ path: "/etc/passwd", name: "a" }, "MCN")).toThrow(/Path/);
    expect(() => assertValidObjectRef({ path: "", name: "a" }, "MCN")).toThrow(/Path/);
    expect(() =>
      assertValidObjectRef({ path: "u/" + "x".repeat(600), name: "a" }, "MCN")
    ).toThrow(/Path/);
  });

  it("accepts a split ref whose parts start with path, rejects malformed parts", () => {
    const parts = ["uid/a.csv.gz.part000", "uid/a.csv.gz.part001"];
    expect(() => assertValidObjectRef({ path: parts[0], name: "a.csv", parts }, "Shopee")).not.toThrow();
    const bad = (p: unknown) => () => assertValidObjectRef({ path: parts[0], name: "a.csv", parts: p }, "Shopee");
    expect(bad([parts[1], parts[0]])).toThrow(/Bagian/); // parts[0] must be path
    expect(bad([parts[0], "../other/x"])).toThrow(/Bagian/);
    expect(bad([])).toThrow(/Bagian/);
    expect(bad("uid/a")).toThrow(/Bagian/);
    expect(bad(Array.from({ length: INGEST_MAX_PARTS + 1 }, (_, i) => (i === 0 ? parts[0] : `uid/p${i}`)))).toThrow(/Bagian/);
  });

  it("ingestObjectPaths lists every object behind a ref (for cleanup)", () => {
    expect(ingestObjectPaths({ path: "uid/a.xlsx", name: "a.xlsx" })).toEqual(["uid/a.xlsx"]);
    expect(ingestObjectPaths({ path: "uid/a.p0", name: "a.csv", parts: ["uid/a.p0", "uid/a.p1"] }))
      .toEqual(["uid/a.p0", "uid/a.p1"]);
  });

  it("rejects a missing/empty name and non-object refs", () => {
    expect(() => assertValidObjectRef({ path: "uid/x.csv", name: "" }, "MCN")).toThrow(/Nama/);
    expect(() => assertValidObjectRef(null, "MCN")).toThrow(/Referensi/);
    expect(() => assertValidObjectRef("nope", "MCN")).toThrow(/Referensi/);
  });
});

describe("downloadIngestFile", () => {
  function mockAdmin(download: unknown): SupabaseClient {
    return {
      storage: { from: (_bucket: string) => ({ download: () => Promise.resolve(download) }) },
    } as unknown as SupabaseClient;
  }

  it("reconstructs a File carrying the ORIGINAL filename (so extension detection works)", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "text/csv" });
    const admin = mockAdmin({ data: blob, error: null });
    const file = await downloadIngestFile(admin, { path: "uid/rand-mcn.csv", name: "MCN semua transaksi.csv" });
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("MCN semua transaksi.csv");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("throws a clear error when the object is missing", async () => {
    const admin = mockAdmin({ data: null, error: { message: "Object not found" } });
    await expect(
      downloadIngestFile(admin, { path: "uid/rand-mcn.csv", name: "data.csv" })
    ).rejects.toThrow(/Gagal mengunduh file dari storage/);
  });
});

describe("removeIngestFiles", () => {
  it("removes non-empty paths from the ingest bucket", async () => {
    const remove = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const from = vi.fn((_bucket: string) => ({ remove }));
    const admin = { storage: { from } } as unknown as SupabaseClient;

    await removeIngestFiles(admin, ["uid/a.csv", "", "uid/b.csv"]);
    expect(from).toHaveBeenCalledWith(INGEST_BUCKET);
    expect(remove).toHaveBeenCalledWith(["uid/a.csv", "uid/b.csv"]);
  });

  it("is a no-op (no storage call) when there are no valid paths", async () => {
    const from = vi.fn();
    const admin = { storage: { from } } as unknown as SupabaseClient;
    await removeIngestFiles(admin, ["", ""]);
    expect(from).not.toHaveBeenCalled();
  });

  it("never throws when the storage remove fails", async () => {
    const admin = {
      storage: { from: () => ({ remove: () => Promise.reject(new Error("boom")) }) },
    } as unknown as SupabaseClient;
    await expect(removeIngestFiles(admin, ["uid/a.csv"])).resolves.toBeUndefined();
  });
});

describe("unpackIngestObject / downloadIngestFile decompression", () => {
  const csv = "Status Pesanan,Harga\nSelesai,Rp1.000\n" + "Selesai,Rp2.000 — ß ✓\n".repeat(2000);
  const csvBytes = new TextEncoder().encode(csv);

  function mockAdmin(blob: Blob): SupabaseClient {
    return {
      storage: { from: () => ({ download: () => Promise.resolve({ data: blob, error: null }) }) },
    } as unknown as SupabaseClient;
  }

  it("inflates a browser-gzipped CSV by magic bytes and keeps the original name", async () => {
    const gz = new Blob([gzipSync(csvBytes)], { type: "application/gzip" });
    const file = await downloadIngestFile(mockAdmin(gz), { path: "uid/x-shopee.csv.gz", name: "Report.csv" });
    expect(file.name).toBe("Report.csv");
    expect(file.type).toBe("text/csv");
    expect(await file.text()).toBe(csv);
  });

  it("extracts the single CSV inside a user-picked .zip and uses the entry's name", async () => {
    const zip = zipSync({ "export/ConversionReport.csv": csvBytes, "__MACOSX/._x.csv": new Uint8Array([1]) });
    const file = await downloadIngestFile(mockAdmin(new Blob([zip])), { path: "uid/x-shopee.zip", name: "arsip.zip" });
    expect(file.name).toBe("ConversionReport.csv");
    expect(await file.text()).toBe(csv);
  });

  it("joins a split upload's parts in order before inflating", async () => {
    const gz = gzipSync(csvBytes);
    const cuts = [0, 7, Math.floor(gz.length / 2), gz.length]; // odd boundaries, mid-gzip-stream
    const byPath = new Map(
      cuts.slice(0, -1).map((c, i) => [`uid/x.csv.gz.part00${i}`, new Blob([gz.subarray(c, cuts[i + 1])])])
    );
    const download = vi.fn((path: string) => Promise.resolve({ data: byPath.get(path) ?? null, error: null }));
    const admin = { storage: { from: () => ({ download }) } } as unknown as SupabaseClient;
    const parts = [...byPath.keys()];
    const file = await downloadIngestFile(admin, { path: parts[0], name: "Report.csv", parts });
    expect(download.mock.calls.map((c) => c[0])).toEqual(parts);
    expect(file.name).toBe("Report.csv");
    expect(await file.text()).toBe(csv);
  });

  it("rejects a .zip with zero or several data files", async () => {
    const two = zipSync({ "a.csv": csvBytes, "b.csv": csvBytes });
    await expect(unpackIngestObject(new Blob([two]), "dua.zip")).rejects.toThrow(/tepat SATU/);
    const none = zipSync({ "readme.txt": new Uint8Array([65]) });
    await expect(unpackIngestObject(new Blob([none]), "kosong.zip")).rejects.toThrow(/tidak berisi/);
  });

  it("passes xlsx (a zip by content, not by name) and plain CSV through untouched", async () => {
    const xlsxLike = zipSync({ "xl/workbook.xml": new Uint8Array([60]) });
    const out = await unpackIngestObject(new Blob([xlsxLike]), "MCN.xlsx");
    expect(out.name).toBe("MCN.xlsx");
    expect(new Uint8Array(await new Blob(out.parts).arrayBuffer())).toEqual(xlsxLike);
    const plain = await unpackIngestObject(new Blob([csvBytes]), "lama.csv");
    expect(await new Blob(plain.parts).text()).toBe(csv);
  });

  it("reports a corrupt gzip as a readable error", async () => {
    const broken = new Blob([new Uint8Array([0x1f, 0x8b, 0, 1, 2, 3])]);
    await expect(unpackIngestObject(broken, "rusak.csv")).rejects.toThrow(/rusak saat diekstrak/);
  });
});
