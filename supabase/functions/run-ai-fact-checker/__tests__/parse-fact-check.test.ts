import { describe, it, expect } from "vitest";

// Extracted from run-ai-fact-checker/index.ts (line 108)
function hasFactCheckFlags(factCheckResult: string): boolean {
  const upperResult = factCheckResult.toUpperCase();
  return upperResult.includes("FLAG:") || upperResult.includes("CONCERNS");
}

describe("hasFactCheckFlags", () => {
  it("detects uppercase FLAG:", () => {
    expect(hasFactCheckFlags("FLAG: The claim about population is unverified")).toBe(true);
  });

  it("detects lowercase flag:", () => {
    expect(hasFactCheckFlags("flag: minor inaccuracy")).toBe(true);
  });

  it("detects mixed case Flag:", () => {
    expect(hasFactCheckFlags("Flag: Date is wrong")).toBe(true);
  });

  it("detects uppercase CONCERNS", () => {
    expect(hasFactCheckFlags("OVERALL: CONCERNS")).toBe(true);
  });

  it("detects mixed case Concerns", () => {
    expect(hasFactCheckFlags("Overall: Concerns")).toBe(true);
  });

  it("detects lowercase concerns", () => {
    expect(hasFactCheckFlags("overall: concerns")).toBe(true);
  });

  it("returns false for OVERALL: PASS", () => {
    expect(hasFactCheckFlags("VERIFIED: All claims supported.\nOVERALL: PASS")).toBe(false);
  });

  it("returns false for clean result", () => {
    expect(hasFactCheckFlags("VERIFIED: All claims in the article are supported by the source material.")).toBe(false);
  });

  it("handles empty response", () => {
    expect(hasFactCheckFlags("")).toBe(false);
  });

  it("detects multiple flags", () => {
    const result = "FLAG: Claim 1 unverified\nFLAG: Claim 2 unverified\nOVERALL: CONCERNS";
    expect(hasFactCheckFlags(result)).toBe(true);
  });
});
