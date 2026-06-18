// Server-side D1 access for the public site (replaces lib/supabase.ts).
// Bindings are request-scoped on Workers and also available under `next dev`
// / `opennextjs-cloudflare preview` via initOpenNextCloudflareForDev() (next.config.ts).
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

function getDB(): D1Database {
  return getCloudflareContext().env.DB as unknown as D1Database;
}

/** Async variant for build-time use (generateStaticParams / generateMetadata). */
async function getDBAsync(): Promise<D1Database> {
  return (await getCloudflareContext({ async: true })).env.DB as unknown as D1Database;
}

export async function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = await getDBAsync();
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null> {
  const db = await getDBAsync();
  return db.prepare(sql).bind(...params).first<T>();
}

export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export { getDB };
