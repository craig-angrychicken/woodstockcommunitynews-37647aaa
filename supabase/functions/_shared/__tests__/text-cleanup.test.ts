import { describe, it, expect } from "vitest";
import { stripEmDashes } from "../text-cleanup.ts";

describe("stripEmDashes", () => {
  it("replaces em dash with spaces around it", () => {
    expect(stripEmDashes("One thing is certain — change is coming.")).toBe(
      "One thing is certain, change is coming."
    );
  });

  it("replaces embedded em dashes (no surrounding spaces)", () => {
    expect(
      stripEmDashes("The mayor—who has served since 2020—announced the plan.")
    ).toBe("The mayor, who has served since 2020, announced the plan.");
  });

  it("replaces en dashes the same way", () => {
    expect(stripEmDashes("Saturday – Sunday")).toBe("Saturday, Sunday");
  });

  it("replaces ASCII double-hyphen em-dash stand-in", () => {
    expect(stripEmDashes("The event -- held downtown -- drew 300.")).toBe(
      "The event, held downtown, drew 300."
    );
  });

  it("cleans up comma-punctuation pileups", () => {
    expect(stripEmDashes("We arrived — .")).toBe("We arrived.");
    expect(stripEmDashes("Yes — !")).toBe("Yes!");
  });

  it("preserves newlines for multi-paragraph bodies", () => {
    const input = "First paragraph — with a dash.\n\nSecond paragraph.";
    expect(stripEmDashes(input)).toBe(
      "First paragraph, with a dash.\n\nSecond paragraph."
    );
  });

  it("leaves strings without dashes untouched", () => {
    expect(stripEmDashes("Plain news copy, no dashes here.")).toBe(
      "Plain news copy, no dashes here."
    );
  });

  it("handles null and undefined", () => {
    expect(stripEmDashes(null)).toBeNull();
    expect(stripEmDashes(undefined)).toBeNull();
  });

  it("leaves hyphens (regular dashes) alone", () => {
    expect(stripEmDashes("well-known, 5-4 vote, state-of-the-art")).toBe(
      "well-known, 5-4 vote, state-of-the-art"
    );
  });

  it("does not eat real double-hyphens inside words (no spaces)", () => {
    expect(stripEmDashes("foo--bar stays as-is")).toBe("foo--bar stays as-is");
  });
});
