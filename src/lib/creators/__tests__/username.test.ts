import { describe, expect, it } from "vitest";
import { likePatternForUsername, normalizeUsername, pickExactUsername } from "@/lib/creators/username";

describe("normalizeUsername", () => {
  it("strips the leading @ and surrounding spaces", () => {
    expect(normalizeUsername("  @vikahere ")).toBe("vikahere");
    expect(normalizeUsername("vikahere")).toBe("vikahere");
    expect(normalizeUsername("@@vikahere")).toBe("vikahere");
  });

  it("keeps an empty input empty (caller decides the error)", () => {
    expect(normalizeUsername("   ")).toBe("");
  });
});

describe("likePatternForUsername", () => {
  it("escapes LIKE wildcards that are ordinary characters in usernames", () => {
    expect(likePatternForUsername("yr_ofc")).toBe("yr\\_ofc");
    expect(likePatternForUsername("100%real")).toBe("100\\%real");
    expect(likePatternForUsername("vikahere")).toBe("vikahere");
  });
});

describe("pickExactUsername", () => {
  const rows = [
    { id: "CRT-1", username: "Winris12" },
    { id: "CRT-2", username: "vikahere" },
    { id: "CRT-3", username: null },
  ];

  it("matches case-insensitively — same platform account", () => {
    expect(pickExactUsername(rows, "winris12")?.id).toBe("CRT-1");
    expect(pickExactUsername(rows, "VIKAHERE")?.id).toBe("CRT-2");
  });

  it("rejects near-misses that only survived the LIKE query", () => {
    expect(pickExactUsername(rows, "winris")).toBeNull();
    expect(pickExactUsername(rows, "")).toBeNull();
  });
});
