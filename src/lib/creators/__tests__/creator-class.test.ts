import { describe, it, expect } from "vitest";
import {
  CREATOR_CLASSES,
  CREATOR_CLASS_LABEL,
  CREATOR_CLASS_OPTIONS,
  DEFAULT_CREATOR_CLASS,
  creatorClassLabel,
  parseCreatorClass,
} from "../creator-class";

describe("kelas kreator — nilai & label", () => {
  it("hanya tiga kelas: Reguler, Top Creator, Influencer", () => {
    expect(CREATOR_CLASSES).toEqual(["reguler", "top_creator", "influencer"]);
    expect(CREATOR_CLASS_OPTIONS.map((o) => o.label)).toEqual([
      "Reguler",
      "Top Creator",
      "Influencer",
    ]);
  });

  it("default = Reguler", () => {
    expect(DEFAULT_CREATOR_CLASS).toBe("reguler");
    expect(CREATOR_CLASS_LABEL[DEFAULT_CREATOR_CLASS]).toBe("Reguler");
  });
});

describe("parseCreatorClass", () => {
  it("menerima label persis seperti di template", () => {
    expect(parseCreatorClass("Reguler")).toBe("reguler");
    expect(parseCreatorClass("Top Creator")).toBe("top_creator");
    expect(parseCreatorClass("Influencer")).toBe("influencer");
  });

  it("toleran terhadap kapital, spasi, underscore, dan hyphen", () => {
    expect(parseCreatorClass("  top creator ")).toBe("top_creator");
    expect(parseCreatorClass("TOP_CREATOR")).toBe("top_creator");
    expect(parseCreatorClass("top-creator")).toBe("top_creator");
    expect(parseCreatorClass("INFLUENCER")).toBe("influencer");
    expect(parseCreatorClass("regular")).toBe("reguler");
  });

  it("null untuk kosong dan untuk nilai yang tidak dikenali", () => {
    for (const bad of ["", "   ", "VIP", "celeb", "tc", "incubation", "-", "123"]) {
      expect(parseCreatorClass(bad)).toBeNull();
    }
  });

  /**
   * "kelas" BUKAN creators.segment (tc | incubation | celeb). Nilai segment tidak
   * boleh diam-diam lolos jadi kelas — kalau tidak, dua sumbu itu jadi bercampur.
   */
  it("tidak menerima nilai segment sebagai kelas", () => {
    expect(parseCreatorClass("tc")).toBeNull();
    expect(parseCreatorClass("celeb")).toBeNull();
  });
});

describe("creatorClassLabel", () => {
  it("memetakan nilai DB ke label tampilan", () => {
    expect(creatorClassLabel("reguler")).toBe("Reguler");
    expect(creatorClassLabel("top_creator")).toBe("Top Creator");
    expect(creatorClassLabel("influencer")).toBe("Influencer");
  });

  /** Requirement: kolom tidak terisi → tampil Reguler. */
  it("null / kosong / nilai asing → Reguler", () => {
    expect(creatorClassLabel(null)).toBe("Reguler");
    expect(creatorClassLabel(undefined)).toBe("Reguler");
    expect(creatorClassLabel("")).toBe("Reguler");
    expect(creatorClassLabel("entah_apa")).toBe("Reguler");
  });
});
