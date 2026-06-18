/**
 * Typed Worker bindings. Mirrors wrangler.jsonc bindings + secrets.
 * D1 / R2 types come from @cloudflare/workers-types.
 */
export interface Env {
  // --- Bindings ---
  DB: D1Database;
  ARTIFACT_IMAGES: R2Bucket;

  // --- Vars ---
  PUBLIC_SITE_URL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  /** Public base URL objects in R2 are served from (e.g. https://images.woodstockcommunity.news). */
  R2_PUBLIC_URL?: string;

  // --- Secrets (wrangler secret put) ---
  OPENROUTER_API_KEY?: string;
  LOVABLE_API_KEY?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL?: string;
  FACEBOOK_PAGE_ACCESS_TOKEN?: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PLACE_ID?: string;
  QUEUE_PROCESSOR_SECRET?: string;
  REVALIDATION_SECRET?: string;

  // --- Added in Phase 4 ---
  // JOURNALISM_QUEUE: Queue;
}
