import { describe, expect, it } from "vitest";
import { verifyLiveSession, type LiveVerifyInput } from "../live-verify";

const baseInput: LiveVerifyInput = {
  selectedUsername: "glowbyrara",
  aliasUsernames: [],
  filenameUsername: "glowbyrara",
  sessionDate: "2026-09-05",
  projectStartDate: "2026-09-01",
  projectEndDate: "2026-09-30",
  sessionNo: 1,
  existingSessions: [],
  newSession: { startTime: "19:00", endTime: "21:00" },
  fileHashExists: false,
  hasProductFile: true,
  hasTrendFile: true,
  gmvProduct: 1_000_000,
  gmvTrend: 1_005_000,
  gmvTrendTolerance: 0.02,
};

function codeOf(results: ReturnType<typeof verifyLiveSession>, code: string) {
  return results.find((r) => r.code === code)!;
}

describe("verifyLiveSession", () => {
  it("all-green case: 7 results, all ok", () => {
    const results = verifyLiveSession(baseInput);
    expect(results).toHaveLength(7);
    expect(results.every((r) => r.level === "ok")).toBe(true);
  });

  it("V1 blocks when filename username doesn't match the selected participant or an alias", () => {
    const results = verifyLiveSession({ ...baseInput, filenameUsername: "someoneelse" });
    expect(codeOf(results, "V1").level).toBe("block");
  });

  it("V1 passes when filename username matches a known alias", () => {
    const results = verifyLiveSession({
      ...baseInput, filenameUsername: "oldhandle", aliasUsernames: ["oldhandle"],
    });
    expect(codeOf(results, "V1").level).toBe("ok");
  });

  it("V2 blocks when the session date is outside the project period", () => {
    const results = verifyLiveSession({ ...baseInput, sessionDate: "2026-10-05" });
    expect(codeOf(results, "V2").level).toBe("block");
  });

  it("V3 blocks on time overlap with another session same day", () => {
    const results = verifyLiveSession({
      ...baseInput,
      existingSessions: [{ sessionDate: "2026-09-05", sessionNo: 2, startTime: "20:00", endTime: "22:00" }],
    });
    expect(codeOf(results, "V3").level).toBe("block");
  });

  it("V3 passes for non-overlapping sessions the same day", () => {
    const results = verifyLiveSession({
      ...baseInput,
      existingSessions: [{ sessionDate: "2026-09-05", sessionNo: 2, startTime: "22:00", endTime: "23:00" }],
    });
    expect(codeOf(results, "V3").level).toBe("ok");
  });

  it("V3 skips (ok) when this session's own time range isn't known yet", () => {
    const results = verifyLiveSession({
      ...baseInput,
      newSession: { startTime: null, endTime: null },
      existingSessions: [{ sessionDate: "2026-09-05", sessionNo: 2, startTime: "19:30", endTime: "20:30" }],
    });
    expect(codeOf(results, "V3").level).toBe("ok");
  });

  it("V4 blocks a file hash that's already been ingested", () => {
    const results = verifyLiveSession({ ...baseInput, fileHashExists: true });
    expect(codeOf(results, "V4").level).toBe("block");
  });

  it("V5 warns when only one of Product/Trend Stats is present", () => {
    const results = verifyLiveSession({ ...baseInput, hasTrendFile: false, gmvTrend: null });
    expect(codeOf(results, "V5").level).toBe("warn");
  });

  it("V6 warns when GMV Product vs Trend Stats differ beyond tolerance", () => {
    const results = verifyLiveSession({ ...baseInput, gmvProduct: 1_000_000, gmvTrend: 900_000 });
    expect(codeOf(results, "V6").level).toBe("warn");
  });

  it("V6 is skipped (ok) when either GMV figure is unavailable", () => {
    const results = verifyLiveSession({ ...baseInput, gmvTrend: null });
    expect(codeOf(results, "V6").level).toBe("ok");
  });

  it("V7 blocks a session number that already exists for this creator + date", () => {
    const results = verifyLiveSession({
      ...baseInput,
      existingSessions: [{ sessionDate: "2026-09-05", sessionNo: 1, startTime: "10:00", endTime: "11:00" }],
    });
    expect(codeOf(results, "V7").level).toBe("block");
  });

  it("does not flag session_no reuse on a different date", () => {
    const results = verifyLiveSession({
      ...baseInput,
      existingSessions: [{ sessionDate: "2026-09-06", sessionNo: 1, startTime: "10:00", endTime: "11:00" }],
    });
    expect(codeOf(results, "V7").level).toBe("ok");
    expect(codeOf(results, "V3").level).toBe("ok");
  });
});
