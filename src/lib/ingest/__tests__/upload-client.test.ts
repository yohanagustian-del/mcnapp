import { gunzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Small parts so the split path runs without allocating 45MB+ in a unit test.
vi.mock("../bucket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bucket")>()),
  INGEST_PART_BYTES: 1000,
  INGEST_MAX_OBJECT_BYTES: 50_000,
}));

const uploads: { path: string; body: Blob }[] = [];
const upload = vi.fn(async (path: string, body: Blob) => {
  uploads.push({ path, body });
  return { error: null as { message: string } | null };
});
const remove = vi.fn(async () => ({ data: null, error: null }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "uid-1" } }, error: null }) },
    storage: { from: () => ({ upload, remove }) },
  }),
}));

import { uploadIngestFile } from "../upload-client";

// Incompressible-ish text so gzip output spans several 1000-byte parts.
const csv = "Status Pesanan,Harga\n" +
  Array.from({ length: 400 }, (_, i) => `Selesai,${(i * 7919) % 104729}-${Math.sin(i).toFixed(8)}`).join("\n");

describe("uploadIngestFile", () => {
  beforeEach(() => {
    uploads.length = 0;
    upload.mockClear();
    remove.mockClear();
  });

  it("gzips a CSV, splits it into ordered parts, and the parts rejoin to the original", async () => {
    const stages: string[] = [];
    const ref = await uploadIngestFile(new File([csv], "Report.csv"), "shopee", (s) => stages.push(s));

    expect(uploads.length).toBeGreaterThan(1);
    expect(ref.name).toBe("Report.csv");
    expect(ref.parts).toEqual(uploads.map((u) => u.path));
    expect(ref.path).toBe(ref.parts![0]);
    expect(ref.path).toMatch(/^uid-1\/.+-shopee\.csv\.gz\.part000$/);
    expect(uploads.every((u) => u.body.size <= 1000)).toBe(true);

    const joined = Buffer.from(await new Blob(uploads.map((u) => u.body)).arrayBuffer());
    expect(gunzipSync(joined).toString("utf8")).toBe(csv);
    expect(stages[0]).toBe("Mengompres file…");
    expect(stages.at(-1)).toBe(`Mengunggah bagian ${uploads.length}/${uploads.length} ke storage…`);
  });

  it("uploads a small non-CSV as one object without parts", async () => {
    const ref = await uploadIngestFile(new File([new Uint8Array(500)], "MCN.xlsx"), "mcn");
    expect(uploads).toHaveLength(1);
    expect(ref.parts).toBeUndefined();
    expect(ref.path).toMatch(/-mcn\.xlsx$/);
  });

  it("removes already-uploaded parts when a later part fails", async () => {
    upload
      .mockImplementationOnce(async (path: string, body: Blob) => { uploads.push({ path, body }); return { error: null }; })
      .mockImplementationOnce(async () => ({ error: { message: "Payload too large" } }));
    await expect(uploadIngestFile(new File([csv], "Report.csv"), "shopee")).rejects.toThrow(/Payload too large/);
    expect(remove).toHaveBeenCalledWith([uploads[0].path]);
  });

  it("rejects a file over the total limit before uploading anything", async () => {
    const big = new File([new Uint8Array(60_000)], "big.xlsx");
    await expect(uploadIngestFile(big, "mcn")).rejects.toThrow(/terlalu besar/);
    expect(upload).not.toHaveBeenCalled();
  });
});
