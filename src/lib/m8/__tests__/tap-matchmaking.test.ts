import { describe, expect, it } from "vitest";
import { buildTapMatch, tapMatchCsv, type CreatorShopPerfRow } from "../tap-matchmaking";

const r = (o: Partial<CreatorShopPerfRow>): CreatorShopPerfRow => ({
  platform: "tiktok", creator_id: "C1", shop_id: "7001", shop_name: "Toko Satu", gmv_mcn: 0, gmv_mcn_live: 0,
  gmv_mcn_video: 0, gmv_tap: 0, gmv_tap_live: 0, gmv_tap_video: 0, ...o,
});
const creators = new Map([
  ["C1", { name: "Ayu", username: "ayu", cmName: "Rina" }],
  ["C2", { name: "Bela", username: "bela", cmName: null }],
]);

describe("buildTapMatch", () => {
  it("baris creator_id NULL (K6) → \"Nama kreator tidak ada\": GMV TAP ikut total, tidak dihitung kreator, tanpa GAP", () => {
    const res = buildTapMatch(
      [
        r({ creator_id: "C1", gmv_mcn: 1000, gmv_tap: 600 }),
        r({ creator_id: null, gmv_mcn: 0, gmv_tap: 400 }),
      ],
      creators
    );
    expect(res.header).toMatchObject({ totalCreatorTap: 1, totalGmvTap: 1000, totalCreators: 1 });
    const none = res.allCreators.find((c) => c.creatorId === null)!;
    expect(none).toMatchObject({ name: "Nama kreator tidak ada", status: "tap", gmvTap: 400, gap: null, livePct: null });
  });

  it("header + tabel kiri (pakai TAP) + kanan (semua) + GAP + sumber live/video", () => {
    const res = buildTapMatch(
      [
        r({ creator_id: "C1", gmv_mcn: "1000", gmv_mcn_live: 800, gmv_tap: "600", gmv_tap_live: 450, gmv_tap_video: 150 }),
        r({ creator_id: "C2", gmv_mcn: 400, gmv_mcn_video: 400, gmv_tap: 0 }),
        r({ creator_id: "C3", gmv_mcn: 100, gmv_tap: 0 }),
      ],
      creators
    );
    expect(res.header).toEqual({
      totalCreatorTap: 1, totalGmvTap: 600, totalGmvMcnTapUsers: 1000, totalGmvAllCreators: 1500, totalCreators: 3,
    });
    expect(res.tapCreators.map((c) => c.creatorId)).toEqual(["C1"]);
    expect(res.tapCreators[0]).toMatchObject({ gap: 400, livePct: 0.8, videoPct: 0, cmName: "Rina" });
    expect(res.allCreators.map((c) => c.status)).toEqual(["tap", "no_tap", "no_tap"]);
    expect(res.allCreators[1]).toMatchObject({ cmName: "—", videoPct: 1 });
    expect(res.allCreators[2].name).toBe("C3"); // kreator tanpa profil → id, bukan crash
  });

  it("Shopee (gmv_tap null) → status unknown, total GMV TAP null — bukan 0", () => {
    const res = buildTapMatch([r({ platform: "shopee", gmv_mcn: 500, gmv_tap: null })], creators);
    expect(res.tapKnown).toBe(false);
    expect(res.header.totalGmvTap).toBeNull();
    expect(res.allCreators[0]).toMatchObject({ status: "unknown", gap: null });
  });

  it("CSV: header + satu baris per kreator, angka dibulatkan", () => {
    const csv = tapMatchCsv(buildTapMatch([r({ creator_id: "C1", gmv_mcn: 1000.4, gmv_tap: 600 })], creators));
    const [head, row] = csv.split("\n");
    expect(head).toBe("Kreator,Username,CM,Status,GMV MCN,GMV TAP,GAP,Live %,Video %");
    expect(row).toBe("Ayu,ayu,Rina,MCN · pakai TAP,1000,600,400,0.0,0.0");
  });
});
