import { describe, expect, it } from "vitest";
import {
  analyzeLiveSessionGroups, groupUploadedFiles, persistLiveSessions, type LiveSessionOwner,
} from "../live-ingest";
import { buildSlotLiveReportData } from "../report-data";
import { buildLiveSampleFiles, defaultSampleSpec, type LiveSampleSpec } from "../live-sample";
import { createFakeSupabase, type FakeDb } from "./helpers/fake-supabase";

/**
 * Uji RANTAI PENUH upload sesi live dari Jadwal Live, dengan file .xlsx sungguhan
 * yang dibangun `live-sample.ts` — bukan baris ad-hoc per tes.
 *
 * Yang ditutup di sini justru yang paling gampang lolos dari tes satuan: nama
 * file yang dibaca `live-filename`, deteksi Product vs Trend Stats dari ISI file,
 * normalisasi header, angka yang menyeberang dari sheet ke kolom DB, dan bentuk
 * report yang keluar di ujung. Tes satuan menguji tiap potongan; ini menguji
 * bahwa potongan-potongan itu benar-benar tersambung.
 *
 * Verifikasi manual di UI tetap perlu — ini tidak menguji tombol, izin, atau RLS.
 */

const TOLERANCE = 0.02;
const CREATOR_ID = "CRT-001";
const SLOT_ID = 77;
const SLOT_DATE = "2026-09-17";

const slotOwner: LiveSessionOwner = { kind: "slot", slotId: SLOT_ID, scheduleDate: SLOT_DATE };

function seedDb(extra: Record<string, Record<string, unknown>[]> = {}): FakeDb {
  return createFakeSupabase({
    creators: [{ id: CREATOR_ID, name: "Rara Glow", username: "tesakun", level: 3, niche: "Beauty" }],
    creator_username_aliases: [],
    live_schedule_slots: [{
      id: SLOT_ID, creator_id: CREATOR_ID, schedule_date: SLOT_DATE,
      start_time: "19:00:00", end_time: "22:00:00",
      actual_start: "19:00:00", actual_end: "21:00:00",
      brand_name: "Glow Beauty", status: "done",
    }],
    project_live_sessions: [],
    project_live_session_products: [],
    project_live_intervals: [],
    ...extra,
  });
}

/** Spec → File[] persis seperti yang di-drop tim ke form upload. */
function sampleFiles(spec: LiveSampleSpec = defaultSampleSpec()): File[] {
  return buildLiveSampleFiles(spec).map(
    (f) => new File([f.data as BlobPart], f.name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
}

/** Upload penuh satu sesi ke slot; mengembalikan db + hasilnya. */
async function uploadToSlot(spec: LiveSampleSpec = defaultSampleSpec(), db: FakeDb = seedDb()) {
  const { groups, unreadable } = await groupUploadedFiles(sampleFiles(spec));
  const analyzed = await analyzeLiveSessionGroups(db.client, slotOwner, CREATOR_ID, groups, TOLERANCE);
  const result = await persistLiveSessions(db.client, slotOwner, CREATOR_ID, analyzed, {
    actorId: "00000000-0000-0000-0000-000000000001", brand: "Glow Beauty", overrides: {},
  });
  return { db, groups, unreadable, analyzed, result };
}

describe("upload sesi live dari Jadwal Live — rantai penuh", () => {
  it("mengelompokkan Product & Trend Stats dari nama file, jenisnya dari isi file", async () => {
    const { groups, unreadable } = await groupUploadedFiles(sampleFiles());
    expect(unreadable).toEqual([]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ username: "tesakun", sessionNo: 1, date: "2026-09-17" });
    // Inilah yang tidak bisa diuji tanpa file sungguhan: file bernama "Product"
    // dikenali sebagai product karena punya kolom product_id, bukan karena namanya.
    expect(groups[0].product).toBeDefined();
    expect(groups[0].trend).toBeDefined();
  });

  it("V1–V7 semuanya hijau untuk file yang benar", async () => {
    const { analyzed } = await uploadToSlot();
    expect(analyzed).toHaveLength(1);
    expect(analyzed[0].checks.map((c) => c.code)).toEqual(["V1", "V2", "V3", "V4", "V5", "V6", "V7"]);
    expect(analyzed[0].checks.filter((c) => c.level !== "ok")).toEqual([]);
    expect(analyzed[0].overallLevel).toBe("ok");
  });

  it("angka menyeberang utuh dari sheet ke baris sesi", async () => {
    const { db, result } = await uploadToSlot();
    expect(result.saved).toHaveLength(1);
    expect(result.skipped).toEqual([]);

    const session = db.rows("project_live_sessions")[0];
    // GMV/order/item = jumlah baris file Product (sumber kebenaran §9).
    expect(session.gmv).toBe(3_300_000);
    expect(session.orders).toBe(33);
    expect(session.items).toBe(36);
    // Trend Stats membagi GMV yang sama → V6 hijau, gmv_trend = gmv.
    expect(session.gmv_trend).toBe(3_300_000);
    // Jam & durasi dari interval pertama/terakhir Trend Stats (5 interval × 30 menit).
    expect(session.start_time).toBe("19:00");
    expect(session.end_time).toBe("21:00");
    expect(session.duration_min).toBe(120);
    expect(session.views).toBe(2_000);
    expect(session.viewers_peak).toBe(140);
    expect(session.impressions_live).toBe(25_000);
    // Pemilik = slot, bukan project (migrasi 0066).
    expect(session.schedule_slot_id).toBe(SLOT_ID);
    expect(session.project_id).toBeNull();
    expect(session.attribution_status).toBe("verified");

    // Rincian per produk & linimasa ikut tersimpan.
    expect(db.rows("project_live_session_products")).toHaveLength(4);
    expect(db.rows("project_live_intervals")).toHaveLength(5);
  });

  it("report slot terbentuk dari sesi yang baru tersimpan", async () => {
    const { db } = await uploadToSlot();
    const data = await buildSlotLiveReportData(db.client, SLOT_ID);

    expect(data.period.type).toBe("live_slot");
    expect(data.period.project_name).toBe("Glow Beauty");
    expect(data.creator.username).toBe("tesakun");
    expect(data.metrics.gmv).toBe(3_300_000);
    expect(data.live?.sessions).toBe(1);
    expect(data.live?.duration_min).toBe(120);
    expect(data.live?.timeline).toHaveLength(5);
    // Produk terlaris = yang benar-benar laku; dua produk ber-GMV nol tidak ikut.
    expect(data.live?.products.map((p) => p.name)).toEqual(["Serum Glow 30ml", "Toner Calm 100ml"]);
    expect(data.live?.products_total).toBe(4);
    expect(data.live?.products_sold).toBe(2);
    // Produk paling banyak dilihat tapi nol pesanan — kalimat yang paling dicari kreator.
    expect(data.live?.top_unsold?.name).toBe("Sunscreen SPF50");
    // Catatan deterministik memang terbentuk (bukan array kosong).
    expect(data.live?.notes.length).toBeGreaterThan(0);
  });
});

describe("batch dua sesi sehari — persis yang dihasilkan scripts/gen-sample-live-files.ts", () => {
  /**
   * Bentuk inilah yang akan benar-benar diunggah tim saat QA manual: dua sesi di
   * hari yang sama, jam berbeda, empat file sekaligus. V3 (tumpang tindih jam)
   * dan V7 (nomor sesi ganda) harus menilai keduanya SALING BERHADAPAN, bukan
   * hanya terhadap sesi yang sudah ada di database.
   */
  const dua = () => [
    defaultSampleSpec({ date: SLOT_DATE, sessionNo: 1, startTime: "13:00", intervals: 4 }),
    defaultSampleSpec({ date: SLOT_DATE, sessionNo: 2, startTime: "19:00", intervals: 5 }),
  ];

  it("dua sesi yang tidak bertumpuk lolos dan tersimpan keduanya", async () => {
    const db = seedDb();
    const files = dua().flatMap((spec) => sampleFiles(spec));
    const { groups } = await groupUploadedFiles(files);
    expect(groups).toHaveLength(2);

    const analyzed = await analyzeLiveSessionGroups(db.client, slotOwner, CREATOR_ID, groups, TOLERANCE);
    expect(analyzed.every((a) => a.overallLevel === "ok")).toBe(true);

    const result = await persistLiveSessions(db.client, slotOwner, CREATOR_ID, analyzed, {
      actorId: "00000000-0000-0000-0000-000000000001", brand: "Glow Beauty", overrides: {},
    });
    expect(result.saved).toHaveLength(2);

    const sessions = db.rows("project_live_sessions");
    expect(sessions.map((s) => s.session_no).sort()).toEqual([1, 2]);
    expect(sessions.find((s) => s.session_no === 1)!.duration_min).toBe(90);
    expect(sessions.find((s) => s.session_no === 2)!.duration_min).toBe(120);

    // Report slot menjumlah keduanya.
    const data = await buildSlotLiveReportData(db.client, SLOT_ID);
    expect(data.live?.sessions).toBe(2);
    expect(data.metrics.gmv).toBe(6_600_000);
  });

  it("V3: dua sesi dalam satu batch yang jamnya BERTUMPUK saling menandai", async () => {
    const db = seedDb();
    const files = [
      ...sampleFiles(defaultSampleSpec({ date: SLOT_DATE, sessionNo: 1, startTime: "19:00", intervals: 5 })),
      ...sampleFiles(defaultSampleSpec({ date: SLOT_DATE, sessionNo: 2, startTime: "20:00", intervals: 5 })),
    ];
    const { groups } = await groupUploadedFiles(files);
    const analyzed = await analyzeLiveSessionGroups(db.client, slotOwner, CREATOR_ID, groups, TOLERANCE);
    expect(analyzed.every((a) => a.checks.find((c) => c.code === "V3")!.level !== "ok")).toBe(true);
  });
});

describe("penjagaan yang harus MENOLAK", () => {
  it("V1: username nama file bukan kreator pemilik slot → block, tidak tersimpan", async () => {
    const { db, result, analyzed } = await uploadToSlot(defaultSampleSpec({ username: "akunlain" }));
    const v1 = analyzed[0].checks.find((c) => c.code === "V1")!;
    expect(v1.level).toBe("block");
    expect(v1.message).toContain("@akunlain");
    expect(result.saved).toEqual([]);
    expect(db.rows("project_live_sessions")).toHaveLength(0);
  });

  it("V2: tanggal 2 hari dari slot → block (±1 hari saja yang dimaafkan)", async () => {
    const { analyzed, result } = await uploadToSlot(defaultSampleSpec({ date: "2026-09-19" }));
    const v2 = analyzed[0].checks.find((c) => c.code === "V2")!;
    expect(v2.level).toBe("block");
    expect(v2.message).toContain("tanggal jadwal (±1 hari)");
    expect(result.saved).toEqual([]);
  });

  it("V2: tanggal 1 hari setelah slot DITERIMA — live lewat tengah malam", async () => {
    const { analyzed, result } = await uploadToSlot(defaultSampleSpec({ date: "2026-09-18" }));
    expect(analyzed[0].checks.find((c) => c.code === "V2")!.level).toBe("ok");
    expect(result.saved).toHaveLength(1);
  });

  it("V4: file yang sama diunggah ulang ke PROJECT ditolak, dan pesannya menyebut slot pemegangnya", async () => {
    const spec = defaultSampleSpec();
    const { db } = await uploadToSlot(spec);

    const projectOwner: LiveSessionOwner = {
      kind: "project", projectId: 13, startDate: "2026-09-01", endDate: "2026-09-30",
    };
    const { groups } = await groupUploadedFiles(sampleFiles(spec));
    const analyzed = await analyzeLiveSessionGroups(db.client, projectOwner, CREATOR_ID, groups, TOLERANCE);

    const v4 = analyzed[0].checks.find((c) => c.code === "V4")!;
    expect(v4.level).toBe("block");
    expect(v4.message).toMatch(/slot/i);
    expect(v4.message).toContain(String(SLOT_ID));
  });

  it("V6: GMV Trend jauh berbeda dari Product → warn, dan tidak tersimpan tanpa konfirmasi tim", async () => {
    // File Trend dari sesi lain (GMV jauh lebih kecil) dipasangkan ke Product sesi ini.
    const spec = defaultSampleSpec();
    const [product] = buildLiveSampleFiles(spec);
    const [, trendLain] = buildLiveSampleFiles(
      defaultSampleSpec({ products: [{ ...spec.products[0], gmv: 100_000, orders: 1, items: 1, customers: 1 }] })
    );
    const files = [
      new File([product.data as BlobPart], product.name),
      new File([trendLain.data as BlobPart], trendLain.name),
    ];

    const db = seedDb();
    const { groups } = await groupUploadedFiles(files);
    const analyzed = await analyzeLiveSessionGroups(db.client, slotOwner, CREATOR_ID, groups, TOLERANCE);
    expect(analyzed[0].checks.find((c) => c.code === "V6")!.level).toBe("warn");
    expect(analyzed[0].overallLevel).toBe("warn");

    const tanpaKonfirmasi = await persistLiveSessions(db.client, slotOwner, CREATOR_ID, analyzed, {
      actorId: "00000000-0000-0000-0000-000000000001", brand: null, overrides: {},
    });
    expect(tanpaKonfirmasi.saved).toEqual([]);
    expect(tanpaKonfirmasi.skipped[0].reason).toMatch(/konfirmasi tim/i);

    const denganKonfirmasi = await persistLiveSessions(db.client, slotOwner, CREATOR_ID, analyzed, {
      actorId: "00000000-0000-0000-0000-000000000001", brand: null,
      overrides: { [analyzed[0].group.key]: { confirmed: true, reason: "Sudah dicek manual" } },
    });
    expect(denganKonfirmasi.saved).toHaveLength(1);
    expect(db.rows("project_live_sessions")[0].attribution_status).toBe("confirmed_manual");
  });

  it("Trend Stats tanpa file Product ditolak — tidak ada sumber GMV", async () => {
    const [, trend] = buildLiveSampleFiles(defaultSampleSpec());
    const db = seedDb();
    const { groups } = await groupUploadedFiles([new File([trend.data as BlobPart], trend.name)]);
    const analyzed = await analyzeLiveSessionGroups(db.client, slotOwner, CREATOR_ID, groups, TOLERANCE);
    expect(analyzed[0].overallLevel).toBe("block");
    expect(analyzed[0].blockedReason).toMatch(/Butuh file Product/i);
  });

  it("nama file tak terbaca dilaporkan, bukan membuat seluruh upload gagal", async () => {
    const [product] = buildLiveSampleFiles(defaultSampleSpec());
    const files = [
      new File([product.data as BlobPart], product.name),
      new File([product.data as BlobPart], "entah-apa.xlsx"),
    ];
    const { groups, unreadable } = await groupUploadedFiles(files);
    expect(groups).toHaveLength(1);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0].name).toBe("entah-apa.xlsx");
  });
});
