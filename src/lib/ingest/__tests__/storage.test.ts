import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assertValidObjectRef, downloadIngestFile, removeIngestFiles, INGEST_BUCKET,
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
