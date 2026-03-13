import { describe, it, expect } from "vitest";

// Re-implement the pure utility functions from fetch-rss-feeds for testing
// These are extracted from the main function to enable unit testing

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function extractTag(xml: string, tagName: string): string {
  const cdataRegex = new RegExp(
    `<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  if (!match) return "";

  let content = match[1].trim();

  const cdataInnerRegex = /^<!\[CDATA\[([\s\S]*)\]\]>$/;
  const cdataInner = content.match(cdataInnerRegex);
  if (cdataInner) {
    content = cdataInner[1].trim();
  }

  return content;
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

describe("cleanText", () => {
  it("strips HTML tags", () => {
    expect(cleanText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(cleanText("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(cleanText("&lt;script&gt;")).toBe("<script>");
    expect(cleanText("He said &quot;hi&quot;")).toBe('He said "hi"');
  });

  it("replaces &nbsp; with space", () => {
    expect(cleanText("Hello&nbsp;World")).toBe("Hello World");
  });

  it("trims whitespace", () => {
    expect(cleanText("  hello  ")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(cleanText("")).toBe("");
  });
});

describe("extractTag", () => {
  it("extracts simple tag content", () => {
    expect(extractTag("<title>My Title</title>", "title")).toBe("My Title");
  });

  it("extracts CDATA content", () => {
    const xml = "<description><![CDATA[Some <b>content</b> here]]></description>";
    expect(extractTag(xml, "description")).toBe("Some <b>content</b> here");
  });

  it("handles missing tags", () => {
    expect(extractTag("<item><title>T</title></item>", "link")).toBe("");
  });

  it("handles tags with attributes", () => {
    const xml = '<link rel="alternate" type="text/html">http://example.com</link>';
    expect(extractTag(xml, "link")).toBe("http://example.com");
  });

  it("is case insensitive", () => {
    expect(extractTag("<Title>Test</Title>", "title")).toBe("Test");
  });

  it("trims content", () => {
    expect(extractTag("<title>  spaced  </title>", "title")).toBe("spaced");
  });
});

describe("parseDate", () => {
  it("parses RFC 2822 dates", () => {
    const result = parseDate("Mon, 10 Mar 2025 14:30:00 GMT");
    expect(result).toBeInstanceOf(Date);
    expect(result!.getUTCFullYear()).toBe(2025);
  });

  it("parses ISO 8601 dates", () => {
    const result = parseDate("2025-03-10T14:30:00Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.getUTCMonth()).toBe(2); // March = 2
  });

  it("returns null for undefined", () => {
    expect(parseDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid date", () => {
    expect(parseDate("not a date")).toBeNull();
  });
});
