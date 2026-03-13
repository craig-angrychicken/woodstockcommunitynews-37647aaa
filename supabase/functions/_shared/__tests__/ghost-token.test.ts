import { describe, it, expect } from "vitest";
import { generateGhostToken } from "../ghost-token.ts";

describe("generateGhostToken", () => {
  it("generates a valid JWT-like token with three parts", async () => {
    // Use a fake API key in the format id:hexsecret
    const fakeApiKey = "abcdef1234:aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344";
    const token = await generateGhostToken(fakeApiKey);

    const parts = token.split(".");
    expect(parts).toHaveLength(3);

    // Decode header
    const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
    expect(header.kid).toBe("abcdef1234");

    // Decode payload
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload.aud).toBe("/admin/");
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.exp - payload.iat).toBe(300); // 5 minutes
  });

  it("produces different tokens at different times", async () => {
    const key = "test1234:aabbccdd11223344aabbccdd11223344aabbccdd11223344aabbccdd11223344";
    const token1 = await generateGhostToken(key);

    // Wait a tick so iat changes
    await new Promise((r) => setTimeout(r, 1100));
    const token2 = await generateGhostToken(key);

    expect(token1).not.toBe(token2);
  });
});
