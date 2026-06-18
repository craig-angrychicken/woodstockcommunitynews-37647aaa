import type { Env } from "../env";

/**
 * Call the site's on-demand revalidation endpoint for one or more paths.
 * Useful for refreshing a single story page after a DB-level fix without
 * having to re-publish the story (which would move published_at and otherwise
 * mutate the row).
 *
 * The endpoint lives at `${PUBLIC_SITE_URL}/api/revalidate` and is implemented
 * on the site side (Phase 5). Each path is hit fire-and-forget: a failure for
 * one path is non-fatal and does not abort the others.
 *
 * @param paths e.g. ["/", "/some-slug"]
 */
export interface RevalidateResult {
  path: string;
  status: number | null;
  ok: boolean;
  error?: string;
}

export async function triggerRevalidate(
  env: Env,
  paths: string[]
): Promise<{ success: boolean; results: RevalidateResult[] }> {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error("paths (string[]) is required");
  }

  const secret = env.REVALIDATION_SECRET;
  if (!secret) {
    throw new Error("REVALIDATION_SECRET is not set");
  }

  const base = new URL("/api/revalidate", env.PUBLIC_SITE_URL).toString();

  const results = await Promise.all(
    paths.map(async (path: string): Promise<RevalidateResult> => {
      const normalized = path.startsWith("/") ? path : `/${path}`;
      try {
        const res = await fetch(
          `${base}?secret=${encodeURIComponent(secret)}&path=${encodeURIComponent(normalized)}`,
          { method: "POST" }
        );
        return { path: normalized, status: res.status, ok: res.ok };
      } catch (error) {
        // Non-fatal: one path failing must not abort the others.
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`❌ trigger-revalidate failed for ${normalized}:`, error);
        return { path: normalized, status: null, ok: false, error: message };
      }
    })
  );

  return { success: true, results };
}
