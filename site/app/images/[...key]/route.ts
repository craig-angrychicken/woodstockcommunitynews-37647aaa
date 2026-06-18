import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { R2Bucket } from "@cloudflare/workers-types";

export const dynamic = "force-dynamic";

// Serve migrated images from R2 (key = the /images/<key> path). Mirrors the API
// worker's route so image URLs resolve on the public site domain.
export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.map((p) => decodeURIComponent(p)).join("/");
  if (!key) return new Response("Not found", { status: 404 });

  const bucket = getCloudflareContext().env.IMAGES as unknown as R2Bucket;
  const obj = await bucket.get(key);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  const contentType = obj.httpMetadata?.contentType;
  if (contentType) headers.set("content-type", contentType);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body as unknown as ReadableStream, { headers });
}
