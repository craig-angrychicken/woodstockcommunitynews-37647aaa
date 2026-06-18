// Admin API client — replaces the Supabase JS client for all data access.
// The admin SPA is gated by Cloudflare Access; requests include the Access
// cookie via credentials:"include". Base URL points at the wcn-api Worker
// (set VITE_API_BASE_URL at build; empty = same-origin /api/admin).
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function url(path: string, query?: Record<string, unknown>): string {
  const u = new URL(`${BASE}/api/admin${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    }
  }
  // Same-origin → return path+search; cross-origin → full URL.
  return BASE ? u.toString() : u.pathname + u.search;
}

async function request<T>(method: string, path: string, opts?: { query?: Record<string, unknown>; body?: unknown }): Promise<T> {
  const res = await fetch(url(path, opts?.query), {
    method,
    credentials: "include",
    headers: opts?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `${method} ${path} failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      msg = j.error || j.message || msg;
    } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, unknown>) => request<T>("GET", path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** Cloudflare Access identity (replaces Supabase auth session). */
export interface AccessIdentity {
  email?: string;
  name?: string;
  groups?: string[];
}

export async function getAccessIdentity(): Promise<AccessIdentity | null> {
  try {
    const res = await fetch("/cdn-cgi/access/get-identity", { credentials: "include" });
    if (!res.ok) return null;
    return (await res.json()) as AccessIdentity;
  } catch {
    return null;
  }
}

export function accessLogout(): void {
  window.location.href = "/cdn-cgi/access/logout";
}
