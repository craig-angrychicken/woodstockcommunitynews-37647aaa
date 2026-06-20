import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "../env";

/**
 * Verify a Cloudflare Access JWT for the admin API.
 * Access injects the token as the `Cf-Access-Jwt-Assertion` header (or CF_Authorization cookie)
 * on requests that have passed the Access policy. We additionally verify signature + audience
 * here so the Worker can't be called directly, bypassing Access.
 */

// Cache one JWKS per team domain across invocations in the same isolate.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export interface AccessIdentity {
  email?: string;
  sub: string;
}

/** Returns the verified identity, or null if the token is missing/invalid. */
export async function verifyAccess(req: Request, env: Env): Promise<AccessIdentity | null> {
  const token =
    req.headers.get("Cf-Access-Jwt-Assertion") ??
    cookie(req, "CF_Authorization");
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    });
    return { email: payload.email as string | undefined, sub: String(payload.sub) };
  } catch (err) {
    console.warn("[auth] Access JWT verification failed:", (err as Error).message);
    return null;
  }
}

function cookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
