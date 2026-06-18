import type { Env } from "../env";
import type { ArtifactRow, StoryArtifactRow } from "../_shared/types";
import { all, run } from "../_shared/db";
import { putObject, publicUrl } from "../_shared/r2";
import { fetchPageHTML, extractImagesFromMeta } from "../_shared/readability";

const MAX_ARTIFACTS = 50;

export interface BackfillArtifactImagesResult {
  success: boolean;
  totalProcessed?: number;
  updatedArtifacts?: number;
  updatedStories?: number;
  failed?: number;
  message: string;
  updated?: number;
  error?: string;
}

/**
 * Download an image from `imageUrl` and store it in R2 under a key derived
 * from the artifact id. Returns the stored image path (`/images/<key>` or an
 * absolute R2 public URL via `publicUrl`), or null on any failure.
 */
async function downloadAndStoreImage(
  env: Env,
  imageUrl: string,
  artifactId: string,
): Promise<string | null> {
  try {
    new URL(imageUrl);
  } catch {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") || buffer.byteLength < 2000) return null;

    const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
    const key = `${artifactId}/image-0.${ext}`;

    await putObject(env, key, buffer, contentType);
    return publicUrl(env, key);
  } catch (err) {
    console.error(`  ❌ Download error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Backfill hero images for imageless "Web Page" artifacts by re-fetching the
 * page, extracting an image from its meta/social tags, storing it in R2, and
 * updating the artifact (and any linked imageless stories).
 */
export async function backfillArtifactImages(
  env: Env,
  sourceId?: string,
): Promise<BackfillArtifactImagesResult> {
  console.log("🔄 Starting image backfill for imageless Web Page artifacts...");

  // Fetch imageless Web Page artifacts
  const params: unknown[] = [];
  let sql =
    `SELECT id, url, title FROM artifacts ` +
    `WHERE type = 'Web Page' AND hero_image_url IS NULL`;
  if (sourceId) {
    sql += ` AND source_id = ?`;
    params.push(sourceId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${MAX_ARTIFACTS}`;

  const artifacts = await all<Pick<ArtifactRow, "id" | "url" | "title">>(env, sql, ...params);

  if (!artifacts || artifacts.length === 0) {
    return {
      success: true,
      message: "No imageless Web Page artifacts found",
      updated: 0,
    };
  }

  console.log(`📊 Found ${artifacts.length} imageless Web Page artifacts`);

  let updatedArtifacts = 0;
  let updatedStories = 0;
  let failed = 0;

  for (const artifact of artifacts) {
    console.log(`\n🔍 ${artifact.title || artifact.id}`);
    console.log(`   URL: ${artifact.url}`);

    if (!artifact.url) {
      console.warn(`   ⚠️ Artifact has no URL`);
      failed++;
      continue;
    }

    // Re-fetch the page HTML
    const htmlResult = await fetchPageHTML(artifact.url);
    if ("error" in htmlResult) {
      console.warn(`   ⚠️ Failed to fetch: ${htmlResult.error}`);
      failed++;
      continue;
    }

    // Extract images from meta/social tags
    const images = extractImagesFromMeta(htmlResult.html, artifact.url);
    if (images.length === 0) {
      console.log(`   ❌ No images found in page HTML`);
      failed++;
      continue;
    }

    console.log(`   🖼️ Found ${images.length} image(s), downloading first...`);

    // Download and store the first image
    const storedUrl = await downloadAndStoreImage(env, images[0].url, artifact.id);
    if (!storedUrl) {
      console.warn(`   ⚠️ Image download/upload failed`);
      failed++;
      continue;
    }

    // Update artifact hero_image_url
    try {
      await run(
        env,
        `UPDATE artifacts SET hero_image_url = ? WHERE id = ?`,
        storedUrl,
        artifact.id,
      );
    } catch (err) {
      console.error(
        `   ❌ Artifact update error:`,
        err instanceof Error ? err.message : err,
      );
      failed++;
      continue;
    }

    console.log(`   ✅ Artifact updated: ${storedUrl}`);
    updatedArtifacts++;

    // Also update any linked stories that lack images
    try {
      const linkedStories = await all<Pick<StoryArtifactRow, "story_id">>(
        env,
        `SELECT story_id FROM story_artifacts WHERE artifact_id = ?`,
        artifact.id,
      );

      if (linkedStories.length > 0) {
        const storyIds = linkedStories.map((sa) => sa.story_id);
        const placeholders = storyIds.map(() => "?").join(", ");
        const updateResult = await run(
          env,
          `UPDATE stories SET hero_image_url = ? ` +
            `WHERE id IN (${placeholders}) AND hero_image_url IS NULL`,
          storedUrl,
          ...storyIds,
        );
        const changed = updateResult.meta?.changes ?? 0;
        if (changed > 0) {
          updatedStories += changed;
          console.log(`   ✅ Updated ${changed} linked story image(s)`);
        }
      }
    } catch (err) {
      console.warn(
        `   ⚠️ Story update error:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const result: BackfillArtifactImagesResult = {
    success: true,
    totalProcessed: artifacts.length,
    updatedArtifacts,
    updatedStories,
    failed,
    message: `Backfill complete: ${updatedArtifacts} artifacts + ${updatedStories} stories updated, ${failed} failed`,
  };

  console.log("\n📊 Backfill complete:", result);

  return result;
}
