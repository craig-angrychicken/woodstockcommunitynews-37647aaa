import { describe, it, expect } from "vitest";

// Extracted from run-ai-rewriter/index.ts (lines 102-107)
function extractTitle(rewrittenContent: string, fallbackTitle: string): string {
  const lines = rewrittenContent.split("\n").filter((l: string) => l.trim());
  const rawTitle = lines[0] || "";
  return rawTitle
    .replace(/^#+\s*/, "")
    .replace(/^HEADLINE:\s*/i, "")
    .replace(/^TITLE:\s*/i, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^["'](.+)["']$/, "$1")
    .trim() || fallbackTitle;
}

describe("extractTitle", () => {
  it("extracts plain title", () => {
    expect(extractTitle("My Great Headline\n\nBody text here.", "Fallback")).toBe("My Great Headline");
  });

  it("strips markdown heading prefix", () => {
    expect(extractTitle("# My Great Headline\n\nBody text.", "Fallback")).toBe("My Great Headline");
  });

  it("strips ## heading prefix", () => {
    expect(extractTitle("## Subheadline\n\nBody.", "Fallback")).toBe("Subheadline");
  });

  it("strips HEADLINE: prefix (uppercase)", () => {
    expect(extractTitle("HEADLINE: Breaking News\n\nBody.", "Fallback")).toBe("Breaking News");
  });

  it("strips Headline: prefix (mixed case)", () => {
    expect(extractTitle("Headline: Breaking News\n\nBody.", "Fallback")).toBe("Breaking News");
  });

  it("strips TITLE: prefix", () => {
    expect(extractTitle("TITLE: Local Event Report\n\nBody.", "Fallback")).toBe("Local Event Report");
  });

  it("strips Title: prefix (mixed case)", () => {
    expect(extractTitle("Title: Local Event Report\n\nBody.", "Fallback")).toBe("Local Event Report");
  });

  it("strips bold markdown wrapping", () => {
    expect(extractTitle("**Bold Headline**\n\nBody.", "Fallback")).toBe("Bold Headline");
  });

  it("strips double-quote wrapping", () => {
    expect(extractTitle('"Quoted Headline"\n\nBody.', "Fallback")).toBe("Quoted Headline");
  });

  it("strips single-quote wrapping", () => {
    expect(extractTitle("'Single Quoted'\n\nBody.", "Fallback")).toBe("Single Quoted");
  });

  it("falls back when content is empty", () => {
    expect(extractTitle("", "Fallback Title")).toBe("Fallback Title");
  });

  it("falls back when first line is only whitespace", () => {
    expect(extractTitle("   \n\nBody text.", "Fallback Title")).toBe("Body text.");
  });

  it("handles combined prefix and formatting", () => {
    expect(extractTitle("# HEADLINE: **Big News**", "Fallback")).toBe("Big News");
  });
});
