import { describe, expect, it } from "vitest";
import { suggestParticipantTargetGmv } from "../participant-target";

describe("suggestParticipantTargetGmv", () => {
  it("splits the full target evenly for the first participant", () => {
    expect(
      suggestParticipantTargetGmv({
        projectTargetGmv: 25_000_000,
        targetCreators: 30,
        existingParticipantTargets: [],
      })
    ).toBe(833_333);
  });

  it("splits the REMAINING target over the REMAINING quota once some already have targets", () => {
    // 25jt target, 3 already assigned 2.5jt each (7.5jt spoken for), 27 slots left of 30.
    expect(
      suggestParticipantTargetGmv({
        projectTargetGmv: 25_000_000,
        targetCreators: 30,
        existingParticipantTargets: [2_500_000, 2_500_000, 2_500_000],
      })
    ).toBe(Math.round(17_500_000 / 27));
  });

  it("never goes negative when existing targets already exceed the project target", () => {
    expect(
      suggestParticipantTargetGmv({
        projectTargetGmv: 10_000_000,
        targetCreators: 5,
        existingParticipantTargets: [12_000_000],
      })
    ).toBe(0);
  });

  it("falls back to 'this is the last slot' when target_creators is unknown", () => {
    // With no quota info, every next participant is treated as filling out
    // whatever remains — the safest default when total headcount is unknown.
    expect(
      suggestParticipantTargetGmv({
        projectTargetGmv: 1_000_000,
        targetCreators: null,
        existingParticipantTargets: [],
      })
    ).toBe(1_000_000);
    expect(
      suggestParticipantTargetGmv({
        projectTargetGmv: 1_000_000,
        targetCreators: null,
        existingParticipantTargets: [400_000],
      })
    ).toBe(600_000);
  });
});
