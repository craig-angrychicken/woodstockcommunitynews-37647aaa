import { describe, it, expect } from "vitest";

// Re-implement the parseStructuredResponse function for testing
// (extracted from process-journalism-queue-item/index.ts)
interface StructuredStoryResponse {
  headline: string;
  subhead?: string;
  byline?: string;
  source_name?: string;
  source_url?: string;
  body: string[] | string;
  skip?: boolean;
  skip_reason?: string | null;
}

function parseStructuredResponse(content: string): StructuredStoryResponse | null {
  try {
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.skip === true) return parsed as StructuredStoryResponse;
    if (!parsed.headline || (!parsed.body && !Array.isArray(parsed.body))) return null;

    return parsed as StructuredStoryResponse;
  } catch {
    return null;
  }
}

describe("parseStructuredResponse", () => {
  it("parses valid JSON response", () => {
    const input = JSON.stringify({
      headline: "Test Headline",
      subhead: "A subhead",
      byline: "Test Staff",
      source_name: "Source",
      source_url: "https://example.com",
      body: ["Para 1", "Para 2"],
      skip: false,
      skip_reason: null,
    });

    const result = parseStructuredResponse(input);
    expect(result).not.toBeNull();
    expect(result!.headline).toBe("Test Headline");
    expect(result!.subhead).toBe("A subhead");
    expect(result!.body).toEqual(["Para 1", "Para 2"]);
    expect(result!.skip).toBe(false);
  });

  it("handles JSON wrapped in markdown code fences", () => {
    const input = '```json\n{"headline":"Fenced","body":["Content"]}\n```';
    const result = parseStructuredResponse(input);
    expect(result).not.toBeNull();
    expect(result!.headline).toBe("Fenced");
  });

  it("handles code fences without language tag", () => {
    const input = '```\n{"headline":"NoLang","body":["Content"]}\n```';
    const result = parseStructuredResponse(input);
    expect(result).not.toBeNull();
    expect(result!.headline).toBe("NoLang");
  });

  it("parses skip response", () => {
    const input = JSON.stringify({
      headline: "",
      body: [],
      skip: true,
      skip_reason: "Not relevant to local area",
    });

    const result = parseStructuredResponse(input);
    expect(result).not.toBeNull();
    expect(result!.skip).toBe(true);
    expect(result!.skip_reason).toBe("Not relevant to local area");
  });

  it("returns null for plain text (legacy format)", () => {
    const input = "# My Headline\n\nSome content here.";
    expect(parseStructuredResponse(input)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseStructuredResponse("{invalid json}")).toBeNull();
  });

  it("returns null for JSON missing required fields", () => {
    const input = JSON.stringify({ subhead: "No headline" });
    expect(parseStructuredResponse(input)).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseStructuredResponse('"just a string"')).toBeNull();
    expect(parseStructuredResponse("42")).toBeNull();
    expect(parseStructuredResponse("null")).toBeNull();
  });

  it("handles body as string instead of array", () => {
    const input = JSON.stringify({
      headline: "Test",
      body: "Single string body",
    });
    const result = parseStructuredResponse(input);
    expect(result).not.toBeNull();
    expect(result!.body).toBe("Single string body");
  });
});
