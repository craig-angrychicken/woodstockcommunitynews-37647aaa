import type { Env } from "../env";

/**
 * Thin helpers over the D1 binding. SQLite dialect, `?` placeholders.
 *
 * Notes:
 *  - booleans are stored as INTEGER 0/1
 *  - timestamps are ISO-8601 TEXT (use datetime('now') / pass new Date().toISOString())
 *  - JSON columns are TEXT — use toJson()/fromJson() at the edges
 *  - embeddings live in a TEXT column and similarity is computed in-worker
 */

export async function all<T = Record<string, unknown>>(
  env: Env,
  query: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await env.DB.prepare(query).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, unknown>>(
  env: Env,
  query: string,
  ...params: unknown[]
): Promise<T | null> {
  return env.DB.prepare(query).bind(...params).first<T>();
}

export async function run(env: Env, query: string, ...params: unknown[]): Promise<D1Result> {
  return env.DB.prepare(query).bind(...params).run();
}

/** Insert a row from an object; returns the inserted row. Values that are objects/arrays are JSON-encoded. */
export async function insert<T = Record<string, unknown>>(
  env: Env,
  table: string,
  row: Record<string, unknown>,
): Promise<T | null> {
  const cols = Object.keys(row);
  if (cols.length === 0) throw new Error(`insert(${table}): empty row`);
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((c) => encodeValue(row[c]));
  const sql = `insert into ${table} (${cols.join(", ")}) values (${placeholders}) returning *`;
  return env.DB.prepare(sql).bind(...values).first<T>();
}

/** Normalize a JS value for D1: objects/arrays → JSON text, booleans → 0/1, undefined → null. */
export function encodeValue(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return v;
}

export function toJson(v: unknown): string {
  return JSON.stringify(v ?? null);
}

export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (text == null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
