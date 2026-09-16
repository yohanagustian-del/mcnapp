import { describe, expect, it } from "vitest";
import { slugifyProjectName } from "../slug";

describe("slugifyProjectName", () => {
  it("lowercases and dashes the name, then appends the id", () => {
    expect(slugifyProjectName("Bootcamp Beauty & Personal Care", 9)).toBe(
      "bootcamp-beauty-personal-care-9"
    );
  });

  it("trims leading/trailing dashes from punctuation at the edges", () => {
    expect(slugifyProjectName("!!Flash Sale 9.9!!", 12)).toBe("flash-sale-9-9-12");
  });

  it("falls back to 'project' when the name has no alphanumeric characters", () => {
    expect(slugifyProjectName("!!!", 3)).toBe("project-3");
  });

  it("different names with the same id still differ (id alone isn't the whole slug)", () => {
    expect(slugifyProjectName("China Trip", 5)).not.toBe(slugifyProjectName("Showcase", 5));
  });
});
