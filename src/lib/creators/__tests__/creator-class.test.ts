import { describe, it, expect } from "vitest";
import {
  CREATOR_CLASSES,
  CREATOR_CLASS_DESCRIPTION,
  CREATOR_CLASS_HINT,
  CREATOR_CLASS_LABEL,
  CREATOR_CLASS_OPTIONS,
  DEFAULT_CREATOR_CLASS,
  creatorClassLabel,
  parseCreatorClass,
} from "../creator-class";

describe("kelas kreator — nilai & label", () => {
  it("empat kelas: Reguler, Kreator Prioritas, Influencer, Eksternal", () => {
    expect(CREATOR_CLASSES).toEqual(["reguler", "top_creator", "influencer", "eksternal"]);
    expect(CREATOR_CLASS_OPTIONS.map((o) => o.label)).toEqual([
      "Reguler",
      "Kreator Prioritas",
      "Influencer",
      "Eksternal",
    ]);
  });

  /** Keterangan dipakai form Tambah/Edit Kreator dan sheet Petunjuk template. */
  it("setiap kelas punya keterangan, dan hint memuat semuanya", () => {
    for (const c of CREATOR_CLASSES) {
      expect(CREATOR_CLASS_DESCRIPTION[c].length).toBeGreaterThan(0);
      expect(CREATOR_CLASS_HINT).toContain(CREATOR_CLASS_LABEL[c]);
    }
    expect(CREATOR_CLASS_HINT).toContain("LUAR agency");
  });

  it("default = Reguler", () => {
    expect(DEFAULT_CREATOR_CLASS).toBe("reguler");
    expect(CREATOR_CLASS_LABEL[DEFAULT_CREATOR_CLASS]).toBe("Reguler");
  });
});

describe("parseCreatorClass", () => {
  it("menerima label persis seperti di template", () => {
    expect(parseCreatorClass("Reguler")).toBe("reguler");
    expect(parseCreatorClass("Kreator Prioritas")).toBe("top_creator");
    expect(parseCreatorClass("Influencer")).toBe("influencer");
    expect(parseCreatorClass("Eksternal")).toBe("eksternal");
  });

  /** Sheet campaign menulis "External"/"external creator" dalam bahasa Inggris. */
  it("menerima ejaan Inggris External", () => {
    expect(parseCreatorClass("External")).toBe("eksternal");
    expect(parseCreatorClass("EXTERNAL CREATOR")).toBe("eksternal");
    expect(parseCreatorClass("kreator eksternal")).toBe("eksternal");
  });

  /** Sheet lama & template yang sudah ter-download masih menulis "Top Creator". */
  it("masih menerima label lama Top Creator", () => {
    expect(parseCreatorClass("Top Creator")).toBe("top_creator");
    expect(parseCreatorClass("top")).toBe("top_creator");
  });

  it("toleran terhadap kapital, spasi, underscore, dan hyphen", () => {
    expect(parseCreatorClass("  kreator prioritas ")).toBe("top_creator");
    expect(parseCreatorClass("KREATOR_PRIORITAS")).toBe("top_creator");
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
    expect(creatorClassLabel("top_creator")).toBe("Kreator Prioritas");
    expect(creatorClassLabel("influencer")).toBe("Influencer");
    expect(creatorClassLabel("eksternal")).toBe("Eksternal");
  });

  /** Requirement: kolom tidak terisi → tampil Reguler. */
  it("null / kosong / nilai asing → Reguler", () => {
    expect(creatorClassLabel(null)).toBe("Reguler");
    expect(creatorClassLabel(undefined)).toBe("Reguler");
    expect(creatorClassLabel("")).toBe("Reguler");
    expect(creatorClassLabel("entah_apa")).toBe("Reguler");
  });
});
