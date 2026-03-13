import { describe, it, expect } from "vitest";
import { corsHeaders, handleCorsPrelight } from "../cors.ts";

describe("corsHeaders", () => {
  it("includes required CORS headers", () => {
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("*");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(corsHeaders["Access-Control-Allow-Headers"]).toContain("content-type");
  });
});

describe("handleCorsPrelight", () => {
  it("returns Response for OPTIONS request", () => {
    const req = new Request("https://example.com", { method: "OPTIONS" });
    const result = handleCorsPrelight(req);
    expect(result).toBeInstanceOf(Response);
    expect(result!.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("returns null for non-OPTIONS requests", () => {
    const req = new Request("https://example.com", { method: "GET" });
    expect(handleCorsPrelight(req)).toBeNull();

    const postReq = new Request("https://example.com", { method: "POST" });
    expect(handleCorsPrelight(postReq)).toBeNull();
  });
});
