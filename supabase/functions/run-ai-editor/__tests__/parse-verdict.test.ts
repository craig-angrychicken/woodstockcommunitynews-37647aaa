import { describe, it, expect } from "vitest";

// Extracted from run-ai-editor/index.ts (lines 164-177)
interface VerdictResult {
  action: "publish" | "publish_featured" | "reject" | "skip";
  reason?: string;
}

function parseVerdict(rawVerdict: string): VerdictResult {
  const verdict = rawVerdict.trim();
  const upperVerdict = verdict.toUpperCase();
  const isFeatured = upperVerdict === "PUBLISH_FEATURED";
  const isPublish = upperVerdict === "PUBLISH" || isFeatured;

  if (isPublish) {
    return { action: isFeatured ? "publish_featured" : "publish" };
  } else if (upperVerdict.startsWith("REJECT:")) {
    const reason = verdict.slice(7).trim();
    return { action: "reject", reason };
  }
  return { action: "skip" };
}

describe("parseVerdict", () => {
  it("parses PUBLISH (uppercase)", () => {
    expect(parseVerdict("PUBLISH")).toEqual({ action: "publish" });
  });

  it("parses publish (lowercase)", () => {
    expect(parseVerdict("publish")).toEqual({ action: "publish" });
  });

  it("parses Publish (mixed case)", () => {
    expect(parseVerdict("Publish")).toEqual({ action: "publish" });
  });

  it("parses PUBLISH_FEATURED (uppercase)", () => {
    expect(parseVerdict("PUBLISH_FEATURED")).toEqual({ action: "publish_featured" });
  });

  it("parses publish_featured (lowercase)", () => {
    expect(parseVerdict("publish_featured")).toEqual({ action: "publish_featured" });
  });

  it("parses Publish_Featured (mixed case)", () => {
    expect(parseVerdict("Publish_Featured")).toEqual({ action: "publish_featured" });
  });

  it("parses REJECT with reason", () => {
    expect(parseVerdict("REJECT: Low quality content")).toEqual({
      action: "reject",
      reason: "Low quality content",
    });
  });

  it("parses reject (lowercase) with reason", () => {
    expect(parseVerdict("reject: not newsworthy")).toEqual({
      action: "reject",
      reason: "not newsworthy",
    });
  });

  it("parses Reject (mixed case) with reason", () => {
    expect(parseVerdict("Reject: duplicate story")).toEqual({
      action: "reject",
      reason: "duplicate story",
    });
  });

  it("skips unexpected format", () => {
    expect(parseVerdict("I think this article is good")).toEqual({ action: "skip" });
  });

  it("skips empty string", () => {
    expect(parseVerdict("")).toEqual({ action: "skip" });
  });

  it("handles whitespace around verdict", () => {
    expect(parseVerdict("  PUBLISH  ")).toEqual({ action: "publish" });
  });

  it("handles whitespace around reject", () => {
    expect(parseVerdict("  REJECT: some reason  ")).toEqual({
      action: "reject",
      reason: "some reason",
    });
  });
});
