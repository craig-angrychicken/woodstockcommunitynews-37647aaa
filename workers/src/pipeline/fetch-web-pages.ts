import type { Env } from "../env";
import type { SourceRow, StoredImage } from "../_shared/types";
import { all, first, run, toJson, fromJson } from "../_shared/db";
import { putObject } from "../_shared/r2";
import {
  fetchPageHTML,
  extractWithReadability,
  extractImages,
  extractImagesFromMeta,
  extractVideos,
  extractLinks,
} from "../_shared/readability";

// UUID v5 namespace (same as fetch-rss-feeds)
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

async function normalizeToUUID(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(NAMESPACE_UUID + input);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return [
    hashHex.slice(0, 8),
    hashHex.slice(8, 12),
    "5" + hashHex.slice(13, 16),
    ((parseInt(hashHex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0") + hashHex.slice(18, 20),
    hashHex.slice(20, 32),
  ].join("-");
}

interface StoredImageResult {
  original_url: string;
  stored_url: string;
  download_failed?: true;
}

async function downloadAndStoreImage(
  env: Env,
  imageUrl: string,
  storageFolderGuid: string,
  imageIndex: number,
): Promise<StoredImageResult | null> {
  // Validate URL
  try {
    new URL(imageUrl);
  } catch {
    console.warn(`⚠️ Invalid image URL, skipping: ${imageUrl}`);
    return null;
  }

  const problematicDomains = ["facebook.com", "instagram.com", "twitter.com", "x.com"];
  const isProblematic = problematicDomains.some((d) => imageUrl.includes(d));
  if (isProblematic) {
    console.warn(`⚠️ Protected social media URL: ${imageUrl}`);
  }

  // Retry with exponential backoff (max 3 attempts)
  let imgResponse: Response | null = null;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      imgResponse = await fetch(imageUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timeoutId);

      if (imgResponse.ok) break;

      // Handle 403 — try weserv.nl proxy
      if (imgResponse.status === 403) {
        console.warn(`🔒 Image 403, trying weserv.nl proxy: ${imageUrl}`);
        try {
          const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpg&n=-1`;
          const proxyController = new AbortController();
          const proxyTimeoutId = setTimeout(() => proxyController.abort(), 20000);
          const proxyResponse = await fetch(proxyUrl, { signal: proxyController.signal });
          clearTimeout(proxyTimeoutId);

          if (proxyResponse.ok) {
            const proxyBuffer = await proxyResponse.arrayBuffer();
            const proxyContentType = proxyResponse.headers.get("content-type") || "image/jpeg";
            if (proxyContentType.startsWith("image/") && proxyBuffer.byteLength >= 5000) {
              const proxyExt = proxyContentType.split("/")[1]?.split(";")[0] || "jpg";
              const storagePath = `${storageFolderGuid}/image-${imageIndex}.${proxyExt}`;
              const storedUrl = await putObject(env, storagePath, proxyBuffer, proxyContentType);
              console.log(`✅ Proxied image stored: ${storedUrl}`);
              return { original_url: imageUrl, stored_url: storedUrl };
            }
          }
        } catch (proxyErr) {
          console.warn(`⚠️ weserv.nl failed:`, proxyErr instanceof Error ? proxyErr.message : proxyErr);
        }
        // Proxy failed — record as download_failed
        return { original_url: imageUrl, stored_url: imageUrl, download_failed: true };
      }

      lastError = new Error(`HTTP ${imgResponse.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error("Unknown error");
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  if (!imgResponse || !imgResponse.ok) {
    console.error(`❌ Failed to download image after 3 attempts: ${imageUrl}`, lastError?.message);
    return null;
  }

  const imageBuffer = await imgResponse.arrayBuffer();
  const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    console.warn(`❌ Non-image content-type (${contentType}): ${imageUrl}`);
    return null;
  }

  const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
  const storagePath = `${storageFolderGuid}/image-${imageIndex}.${ext}`;

  try {
    const storedUrl = await putObject(env, storagePath, imageBuffer, contentType);
    console.log(`✅ Stored image ${imageIndex}: ${storedUrl}`);
    return { original_url: imageUrl, stored_url: storedUrl };
  } catch (uploadError) {
    console.error(`❌ Upload error:`, uploadError);
    return null;
  }
}

/** Upsert an artifact on its deterministic `guid` (SQLite ON CONFLICT). */
async function upsertArtifact(
  env: Env,
  row: {
    id: string;
    name: string;
    title: string;
    url: string;
    guid: string;
    content: string;
    hero_image_url: string | null;
    images: StoredImage[];
    date: string;
    type: string;
    source_id: string;
    is_test: boolean;
  },
): Promise<void> {
  await run(
    env,
    `INSERT INTO artifacts (id, name, title, url, guid, content, hero_image_url, images, date, type, source_id, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guid) DO UPDATE SET
       name = excluded.name,
       title = excluded.title,
       url = excluded.url,
       content = excluded.content,
       hero_image_url = excluded.hero_image_url,
       images = excluded.images,
       date = excluded.date,
       type = excluded.type,
       source_id = excluded.source_id,
       is_test = excluded.is_test`,
    row.id,
    row.name,
    row.title,
    row.url,
    row.guid,
    row.content,
    row.hero_image_url,
    toJson(row.images),
    row.date,
    row.type,
    row.source_id,
    row.is_test ? 1 : 0,
  );
}

export interface FetchWebPagesResult {
  success: boolean;
  artifactsCreated?: number;
  errors?: number;
  sourcesProcessed?: number;
  message?: string;
  error?: string;
}

export async function fetchWebPages(
  env: Env,
  opts: {
    sourceIds?: string[];
    environment?: "production" | "test";
    queryHistoryId?: string;
  },
): Promise<FetchWebPagesResult> {
  const { sourceIds, environment = "production", queryHistoryId } = opts;

  console.log("🌐 fetch-web-pages started");

  try {
    // Fetch Web Page sources
    let sources: SourceRow[];
    if (sourceIds && sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => "?").join(", ");
      sources = await all<SourceRow>(
        env,
        `SELECT * FROM sources WHERE type = ? AND id IN (${placeholders})`,
        "Web Page",
        ...sourceIds,
      );
    } else {
      sources = await all<SourceRow>(
        env,
        `SELECT * FROM sources WHERE type = ? AND status = ?`,
        "Web Page",
        "active",
      );
    }

    if (!sources || sources.length === 0) {
      console.log("No Web Page sources to process");
      return { success: true, artifactsCreated: 0, message: "No Web Page sources found" };
    }

    console.log(`Processing ${sources.length} Web Page source(s)`);

    let totalArtifacts = 0;
    let totalErrors = 0;

    for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
      const source = sources[sourceIndex];
      try {
        console.log(`\n━━━ ${source.name} ━━━`);
        console.log(`   URL: ${source.url}`);

        if (!source.url) {
          console.warn(`⚠️ Source ${source.name} has no URL, skipping`);
          totalErrors++;
          continue;
        }

        const parserConfig = fromJson<Record<string, unknown> | null>(source.parser_config, null);

        if (parserConfig?.page_mode === "index") {
          // ── INDEX PAGE FLOW: follow article links ──

          // 1. Fetch listing page HTML
          const listingHtml = await fetchPageHTML(source.url);
          if ("error" in listingHtml) {
            console.error(`❌ Failed to fetch listing page ${source.url}: ${listingHtml.error}`);
            totalErrors++;
            continue;
          }

          console.log(`   Listing HTML: ${listingHtml.html.length} chars`);

          // 2. Extract article links using CSS selector
          const linkSelector = (parserConfig.link_selector as string) || "a";
          const links = extractLinks(listingHtml.html, source.url, linkSelector);
          console.log(`   Found ${links.length} links matching "${linkSelector}"`);

          if (links.length === 0) {
            console.warn(`   ⚠️ No links found for selector "${linkSelector}" — skipping source`);
            totalErrors++;
            continue;
          }

          // 3. Cap at max_pages to avoid function timeout
          const maxPages = (parserConfig.max_pages as number) || 20;
          const linksToProcess = links.slice(0, maxPages);
          if (links.length > maxPages) {
            console.log(`   ⚠️ Capping at ${maxPages} of ${links.length} links`);
          }

          // 4. Batch-check which GUIDs already exist
          const guidMap = new Map<string, string>();
          for (const link of linksToProcess) {
            const fingerprint = `${source.id}:${link.url}`;
            const guid = await normalizeToUUID(fingerprint);
            guidMap.set(guid, link.url);
          }

          const guidsToCheck = Array.from(guidMap.keys());
          const checkPlaceholders = guidsToCheck.map(() => "?").join(", ");
          const existingArtifacts = guidsToCheck.length > 0
            ? await all<{ guid: string }>(
                env,
                `SELECT guid FROM artifacts WHERE guid IN (${checkPlaceholders})`,
                ...guidsToCheck,
              )
            : [];

          const existingGuids = new Set(
            existingArtifacts.map((a) => a.guid).filter((g): g is string => g != null),
          );
          console.log(`   ${existingGuids.size} already exist, ${guidsToCheck.length - existingGuids.size} new`);

          // 5. Process each new article
          let articlesCreated = 0;
          const MAX_IMAGES_PER_ARTICLE = 3;

          for (const link of linksToProcess) {
            const fingerprint = `${source.id}:${link.url}`;
            const guid = await normalizeToUUID(fingerprint);

            if (existingGuids.has(guid)) {
              continue;
            }

            try {
              const articleHtml = await fetchPageHTML(link.url);
              if ("error" in articleHtml) {
                console.warn(`   ⚠️ Failed to fetch ${link.url}: ${articleHtml.error}`);
                continue;
              }

              const readResult = extractWithReadability(articleHtml.html);
              if (!readResult.success) {
                console.warn(`   ⚠️ Readability failed for ${link.url}: ${readResult.error}`);
                continue;
              }

              const title = readResult.title || link.text || "Untitled";

              // Check content filter — skip low-impact press-release content
              const excludePatterns = (parserConfig?.exclude_title_patterns as string[]) || [];
              if (excludePatterns.length > 0) {
                const titleLower = title.toLowerCase();
                const matched = excludePatterns.find((p) => titleLower.includes(p.toLowerCase()));
                if (matched) {
                  console.log(`   ⏭️ Skipped (filter: "${matched}"): ${title}`);
                  continue;
                }
              }

              console.log(`   📄 ${title}`);

              let imageUrls = extractImages(readResult.content, link.url);
              if (imageUrls.length === 0) {
                imageUrls = extractImagesFromMeta(articleHtml.html, link.url);
                if (imageUrls.length > 0) {
                  console.log(`   🔍 Found ${imageUrls.length} image(s) from meta/social tags`);
                }
              }
              const videoUrls = extractVideos(readResult.content);

              const storageFolderGuid = crypto.randomUUID();
              const storageImages: StoredImage[] = [];

              const imagesToDownload = imageUrls.slice(0, MAX_IMAGES_PER_ARTICLE);
              for (let i = 0; i < imagesToDownload.length; i++) {
                const result = await downloadAndStoreImage(env, imagesToDownload[i].url, storageFolderGuid, i);
                if (result) storageImages.push(result);
              }

              // Secondary fallback: if all Readability images failed to download,
              // try meta/social extraction (catches Finalsite CDN URLs that Readability
              // resolves to incorrect relative paths)
              const hasRealImage = storageImages.some(
                (img) => img.type !== "video" && !img.download_failed,
              );
              if (!hasRealImage && imageUrls.length > 0) {
                const metaImages = extractImagesFromMeta(articleHtml.html, link.url);
                if (metaImages.length > 0) {
                  console.log(`   🔍 Readability images failed, found ${metaImages.length} from meta/social tags`);
                  for (let i = 0; i < Math.min(metaImages.length, MAX_IMAGES_PER_ARTICLE); i++) {
                    const result = await downloadAndStoreImage(env, metaImages[i].url, storageFolderGuid, i);
                    if (result) storageImages.push(result);
                  }
                }
              }

              for (const video of videoUrls) {
                storageImages.push({
                  original_url: video.url,
                  stored_url: video.url,
                  type: "video",
                  embed_type: video.type,
                });
              }

              // Pick first non-video image that downloaded successfully.
              // download_failed entries retain the original external URL as
              // their stored_url — never use those as the hero (they may be
              // ephemeral, e.g. Facebook/Instagram CDN links).
              const heroImage = storageImages.find(
                (img) => img.type !== "video" && !img.download_failed,
              )?.stored_url || null;

              try {
                await upsertArtifact(env, {
                  id: storageFolderGuid,
                  name: title,
                  title: title,
                  url: link.url,
                  guid: guid,
                  content: readResult.textContent,
                  hero_image_url: heroImage,
                  images: storageImages,
                  date: new Date().toISOString(),
                  type: "Web Page",
                  source_id: source.id,
                  is_test: environment === "test",
                });
                console.log(`   ✅ Upserted: ${title}`);
                articlesCreated++;
                totalArtifacts++;
              } catch (upsertError) {
                console.error(`   ❌ Upsert error for ${title}:`, upsertError);
                totalErrors++;
              }
            } catch (articleError) {
              console.error(`   ❌ Error processing ${link.url}:`, articleError);
            }
          }

          // Update source
          await run(
            env,
            `UPDATE sources SET last_fetch_at = ?, items_fetched = ?, updated_at = ? WHERE id = ?`,
            new Date().toISOString(),
            (source.items_fetched || 0) + articlesCreated,
            new Date().toISOString(),
            source.id,
          );

          console.log(`   Index done: ${articlesCreated} articles created`);
        } else {
          // ── SINGLE PAGE FLOW (existing behavior) ──

          // 1. Fetch HTML
          const htmlResult = await fetchPageHTML(source.url);
          if ("error" in htmlResult) {
            console.error(`❌ Failed to fetch ${source.url}: ${htmlResult.error}`);
            totalErrors++;
            continue;
          }

          console.log(`   HTML: ${htmlResult.html.length} chars`);

          // 2. Extract content with Readability
          const readResult = extractWithReadability(htmlResult.html);
          if (!readResult.success) {
            console.warn(`⚠️ Readability extraction failed for ${source.name}: ${readResult.error}`);
            totalErrors++;
            continue;
          }

          const title = readResult.title || source.name;
          console.log(`   Title: ${title}`);
          console.log(`   Content: ${readResult.charCount} chars`);

          // 3. Extract images from Readability HTML (fall back to meta/social tags)
          let imageUrls = extractImages(readResult.content, source.url);
          if (imageUrls.length === 0) {
            imageUrls = extractImagesFromMeta(htmlResult.html, source.url);
            if (imageUrls.length > 0) {
              console.log(`   🔍 Found ${imageUrls.length} image(s) from meta/social tags`);
            }
          }
          console.log(`   Images found: ${imageUrls.length}`);

          // 4. Extract videos
          const videoUrls = extractVideos(readResult.content);
          console.log(`   Videos found: ${videoUrls.length}`);

          // 5. Generate deterministic GUID from source_id + URL
          const fingerprint = `${source.id}:${source.url}`;
          const guid = await normalizeToUUID(fingerprint);

          // 6. Download and store images (cap at 10 to avoid function timeout)
          const MAX_IMAGES = 10;
          const storageFolderGuid = crypto.randomUUID();
          const storageImages: StoredImage[] = [];

          const imagesToDownload = imageUrls.slice(0, MAX_IMAGES);
          if (imageUrls.length > MAX_IMAGES) {
            console.log(`   ⚠️ Capping image downloads: ${imageUrls.length} found, downloading first ${MAX_IMAGES}`);
          }

          for (let i = 0; i < imagesToDownload.length; i++) {
            const result = await downloadAndStoreImage(env, imagesToDownload[i].url, storageFolderGuid, i);
            if (result) storageImages.push(result);
          }

          // Secondary fallback: if all Readability images failed to download,
          // try meta/social extraction (Finalsite CDN URLs)
          const hasRealImage = storageImages.some(
            (img) => img.type !== "video" && !img.download_failed,
          );
          if (!hasRealImage && imageUrls.length > 0) {
            const metaImages = extractImagesFromMeta(htmlResult.html, source.url);
            if (metaImages.length > 0) {
              console.log(`   🔍 Readability images failed, found ${metaImages.length} from meta/social tags`);
              for (let i = 0; i < Math.min(metaImages.length, MAX_IMAGES); i++) {
                const result = await downloadAndStoreImage(env, metaImages[i].url, storageFolderGuid, i);
                if (result) storageImages.push(result);
              }
            }
          }

          // 7. Store video embed URLs in the images array with type discriminator
          for (const video of videoUrls) {
            storageImages.push({
              original_url: video.url,
              stored_url: video.url,
              type: "video",
              embed_type: video.type,
            });
          }

          // Pick first non-video image that downloaded successfully.
          // download_failed entries retain the original external URL as
          // their stored_url — never use those as the hero (they may be
          // ephemeral, e.g. Facebook/Instagram CDN links).
          const heroImage = storageImages.find(
            (img) => img.type !== "video" && !img.download_failed,
          )?.stored_url || null;

          console.log(
            `   📸 Stored ${storageImages.filter((i) => i.type !== "video").length} images, ${videoUrls.length} videos`,
          );

          // 8. Upsert artifact
          try {
            await upsertArtifact(env, {
              id: storageFolderGuid,
              name: title,
              title: title,
              url: source.url,
              guid: guid,
              content: readResult.textContent,
              hero_image_url: heroImage,
              images: storageImages,
              date: new Date().toISOString(),
              type: "Web Page",
              source_id: source.id,
              is_test: environment === "test",
            });
            console.log(`✅ Upserted artifact: ${title}`);
            totalArtifacts++;
          } catch (upsertError) {
            console.error("❌ Upsert error:", upsertError);
            totalErrors++;
          }

          // 9. Update source
          await run(
            env,
            `UPDATE sources SET last_fetch_at = ?, items_fetched = ?, updated_at = ? WHERE id = ?`,
            new Date().toISOString(),
            (source.items_fetched || 0) + 1,
            new Date().toISOString(),
            source.id,
          );
        }

        // Update query history (for both modes)
        if (queryHistoryId) {
          const currentProcessed = sourceIndex + 1;
          await run(
            env,
            `UPDATE query_history SET
               sources_total = ?,
               sources_processed = ?,
               current_source_id = ?,
               current_source_name = ?,
               artifacts_count = ?
             WHERE id = ?`,
            sources.length,
            currentProcessed,
            source.id,
            source.name,
            totalArtifacts,
            queryHistoryId,
          );
        }
      } catch (error) {
        console.error(`❌ Error processing ${source.name}:`, error);
        totalErrors++;
      }
    }

    console.log(`\n━━━ DONE ━━━`);
    console.log(`   Artifacts: ${totalArtifacts}, Errors: ${totalErrors}`);

    // Finalize query history
    if (queryHistoryId) {
      await run(
        env,
        `UPDATE query_history SET
           status = ?,
           completed_at = ?,
           artifacts_count = ?,
           sources_processed = ?,
           current_source_id = ?,
           current_source_name = ?
         WHERE id = ?`,
        "completed",
        new Date().toISOString(),
        totalArtifacts,
        sources.length,
        null,
        null,
        queryHistoryId,
      );
    }

    return {
      success: true,
      artifactsCreated: totalArtifacts,
      errors: totalErrors,
      sourcesProcessed: sources.length,
    };
  } catch (error) {
    console.error("Fatal error:", error);

    // Try to update query history with error status
    try {
      if (queryHistoryId) {
        // Verify the row still exists before updating (best-effort, matches original intent)
        const existing = await first<{ id: string }>(
          env,
          `SELECT id FROM query_history WHERE id = ?`,
          queryHistoryId,
        );
        if (existing) {
          await run(
            env,
            `UPDATE query_history SET status = ?, error_message = ?, completed_at = ? WHERE id = ?`,
            "failed",
            error instanceof Error ? error.message : String(error),
            new Date().toISOString(),
            queryHistoryId,
          );
        }
      }
    } catch (updateErr) {
      console.error("Failed to update query history:", updateErr);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
