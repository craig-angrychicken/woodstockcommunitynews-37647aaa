import type { Env } from "../env";

/**
 * R2 helpers for the artifact-images bucket.
 * Object keys follow the path convention: `{artifact_guid}/{index}.{ext}`.
 */

/** Store an image (or any blob) and return its public URL. */
export async function putObject(
  env: Env,
  key: string,
  body: ArrayBuffer | ReadableStream | string,
  contentType: string,
): Promise<string> {
  await env.ARTIFACT_IMAGES.put(key, body, {
    httpMetadata: { contentType },
  });
  return publicUrl(env, key);
}

export async function getObject(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.ARTIFACT_IMAGES.get(key);
}

export async function deleteObject(env: Env, key: string): Promise<void> {
  await env.ARTIFACT_IMAGES.delete(key);
}

/** Public URL for an object. Prefer a custom R2 domain; fall back to a /images proxy route. */
export function publicUrl(env: Env, key: string): string {
  if (env.R2_PUBLIC_URL) {
    return `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;
  }
  return `${env.PUBLIC_SITE_URL.replace(/\/$/, "")}/images/${key}`;
}
