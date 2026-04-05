import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import {
  fetchPageHTML,
  extractWithReadability,
  extractImages,
  extractImagesFromMeta,
  extractVideos,
  extractLinks,
  isReadabilityLoaded,
  getImportError,
} from "../_shared/readability.ts";

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

async function downloadAndStoreImage(
  supabase: ReturnType<typeof createSupabaseClient>,
  imageUrl: string,
  storageFolderGuid: string,
  imageIndex: number
): Promise<{ original_url: string; stored_url: string; download_failed?: true } | null> {
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
              const { error: uploadError } = await supabase.storage
                .from("artifact-images")
                .upload(storagePath, proxyBuffer, { contentType: proxyContentType, upsert: false });
              if (!uploadError) {
                const { data: urlData } = supabase.storage.from("artifact-images").getPublicUrl(storagePath);
                if (urlData?.publicUrl) {
                  console.log(`✅ Proxied image stored: ${urlData.publicUrl}`);
                  return { original_url: imageUrl, stored_url: urlData.publicUrl };
                }
              }
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

  const { error: uploadError } = await supabase.storage
    .from("artifact-images")
    .upload(storagePath, imageBuffer, { contentType, upsert: false });

  if (uploadError) {
    console.error(`❌ Upload error:`, uploadError);
    return null;
  }

  const { data: urlData } = supabase.storage.from("artifact-images").getPublicUrl(storagePath);
  if (urlData?.publicUrl) {
    console.log(`✅ Stored image ${imageIndex}: ${urlData.publicUrl}`);
    return { original_url: imageUrl, stored_url: urlData.publicUrl };
  }

  return null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🌐 fetch-web-pages started");
  console.log(`   Readability loaded: ${isReadabilityLoaded()}`);
  if (getImportError()) console.log(`   Import error: ${getImportError()}`);

  try {
    const body = await req.json();
    const { sourceIds, environment = "production", queryHistoryId } = body;

    if (!isReadabilityLoaded()) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Readability not loaded: ${getImportError()}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createSupabaseClient();

    // Fetch Web Page sources
    let query = supabase
      .from("sources")
      .select("*")
      .eq("type", "Web Page");

    if (sourceIds && sourceIds.length > 0) {
      query = query.in("id", sourceIds);
    } else {
      query = query.eq("status", "active");
    }

    const { data: sources, error: sourcesError } = await query;
    if (sourcesError) throw sourcesError;

    if (!sources || sources.length === 0) {
      console.log("No Web Page sources to process");
      return new Response(
        JSON.stringify({ success: true, artifactsCreated: 0, message: "No Web Page sources found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${sources.length} Web Page source(s)`);

    let totalArtifacts = 0;
    let totalErrors = 0;

    for (const source of sources) {
      try {
        console.log(`\n━━━ ${source.name} ━━━`);
        console.log(`   URL: ${source.url}`);

        if (!source.url) {
          console.warn(`⚠️ Source ${source.name} has no URL, skipping`);
          totalErrors++;
          continue;
        }

        const parserConfig = source.parser_config as Record<string, unknown> | null;

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
          const { data: existingArtifacts } = await supabase
            .from("artifacts")
            .select("guid")
            .in("guid", guidsToCheck);

          const existingGuids = new Set((existingArtifacts || []).map((a: { guid: string }) => a.guid));
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
                const matched = excludePatterns.find(p => titleLower.includes(p.toLowerCase()));
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
              const storageImages: { original_url: string; stored_url: string; download_failed?: true; type?: string; embed_type?: string }[] = [];

              const imagesToDownload = imageUrls.slice(0, MAX_IMAGES_PER_ARTICLE);
              for (let i = 0; i < imagesToDownload.length; i++) {
                const result = await downloadAndStoreImage(supabase, imagesToDownload[i].url, storageFolderGuid, i);
                if (result) storageImages.push(result);
              }

              // Secondary fallback: if all Readability images failed to download,
              // try meta/social extraction (catches Finalsite CDN URLs that Readability
              // resolves to incorrect relative paths)
              const hasRealImage = storageImages.some(img => !("type" in img) || img.type !== "video");
              if (!hasRealImage && imageUrls.length > 0) {
                const metaImages = extractImagesFromMeta(articleHtml.html, link.url);
                if (metaImages.length > 0) {
                  console.log(`   🔍 Readability images failed, found ${metaImages.length} from meta/social tags`);
                  for (let i = 0; i < Math.min(metaImages.length, MAX_IMAGES_PER_ARTICLE); i++) {
                    const result = await downloadAndStoreImage(supabase, metaImages[i].url, storageFolderGuid, i);
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
                } as { original_url: string; stored_url: string; type: string; embed_type: string });
              }

              // Pick first non-video image that downloaded successfully.
              // download_failed entries retain the original external URL as
              // their stored_url — never use those as the hero (they may be
              // ephemeral, e.g. Facebook/Instagram CDN links).
              const heroImage = storageImages.find(
                (img) =>
                  (!("type" in img) || img.type !== "video") &&
                  !("download_failed" in img && img.download_failed)
              )?.stored_url || null;

              const { error: upsertError } = await supabase
                .from("artifacts")
                .upsert(
                  {
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
                  },
                  { onConflict: "guid", ignoreDuplicates: false }
                );

              if (upsertError) {
                console.error(`   ❌ Upsert error for ${title}:`, upsertError);
                totalErrors++;
              } else {
                console.log(`   ✅ Upserted: ${title}`);
                articlesCreated++;
                totalArtifacts++;
              }
            } catch (articleError) {
              console.error(`   ❌ Error processing ${link.url}:`, articleError);
            }
          }

          // Update source
          await supabase
            .from("sources")
            .update({
              last_fetch_at: new Date().toISOString(),
              items_fetched: (source.items_fetched || 0) + articlesCreated,
            })
            .eq("id", source.id);

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
          const storageImages: { original_url: string; stored_url: string; download_failed?: true; type?: string; embed_type?: string }[] = [];

          const imagesToDownload = imageUrls.slice(0, MAX_IMAGES);
          if (imageUrls.length > MAX_IMAGES) {
            console.log(`   ⚠️ Capping image downloads: ${imageUrls.length} found, downloading first ${MAX_IMAGES}`);
          }

          for (let i = 0; i < imagesToDownload.length; i++) {
            const result = await downloadAndStoreImage(supabase, imagesToDownload[i].url, storageFolderGuid, i);
            if (result) storageImages.push(result);
          }

          // Secondary fallback: if all Readability images failed to download,
          // try meta/social extraction (Finalsite CDN URLs)
          const hasRealImage = storageImages.some(img => !("type" in img) || img.type !== "video");
          if (!hasRealImage && imageUrls.length > 0) {
            const metaImages = extractImagesFromMeta(htmlResult.html, source.url);
            if (metaImages.length > 0) {
              console.log(`   🔍 Readability images failed, found ${metaImages.length} from meta/social tags`);
              for (let i = 0; i < Math.min(metaImages.length, MAX_IMAGES); i++) {
                const result = await downloadAndStoreImage(supabase, metaImages[i].url, storageFolderGuid, i);
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
            } as { original_url: string; stored_url: string; type: string; embed_type: string });
          }

          // Pick first non-video image that downloaded successfully.
          // download_failed entries retain the original external URL as
          // their stored_url — never use those as the hero (they may be
          // ephemeral, e.g. Facebook/Instagram CDN links).
          const heroImage = storageImages.find(
            (img) =>
              (!("type" in img) || img.type !== "video") &&
              !("download_failed" in img && img.download_failed)
          )?.stored_url || null;

          console.log(`   📸 Stored ${storageImages.filter((i) => !("type" in i) || i.type !== "video").length} images, ${videoUrls.length} videos`);

          // 8. Upsert artifact
          const { error: upsertError } = await supabase
            .from("artifacts")
            .upsert(
              {
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
              },
              {
                onConflict: "guid",
                ignoreDuplicates: false,
              }
            );

          if (upsertError) {
            console.error("❌ Upsert error:", upsertError);
            totalErrors++;
          } else {
            console.log(`✅ Upserted artifact: ${title}`);
            totalArtifacts++;
          }

          // 9. Update source
          await supabase
            .from("sources")
            .update({
              last_fetch_at: new Date().toISOString(),
              items_fetched: (source.items_fetched || 0) + 1,
            })
            .eq("id", source.id);
        }

        // Update query history (for both modes)
        if (queryHistoryId) {
          const currentProcessed = sources.indexOf(source) + 1;
          await supabase
            .from("query_history")
            .update({
              sources_total: sources.length,
              sources_processed: currentProcessed,
              current_source_id: source.id,
              current_source_name: source.name,
              artifacts_count: totalArtifacts,
            })
            .eq("id", queryHistoryId);
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
      await supabase
        .from("query_history")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          artifacts_count: totalArtifacts,
          sources_processed: sources.length,
          current_source_id: null,
          current_source_name: null,
        })
        .eq("id", queryHistoryId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCreated: totalArtifacts,
        errors: totalErrors,
        sourcesProcessed: sources.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Fatal error:", error);

    // Try to update query history with error status
    try {
      const reqBody = await req.clone().json().catch(() => ({}));
      if (reqBody.queryHistoryId) {
        const sb = createSupabaseClient();
        await sb
          .from("query_history")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : String(error),
            completed_at: new Date().toISOString(),
          })
          .eq("id", reqBody.queryHistoryId);
      }
    } catch (updateErr) {
      console.error("Failed to update query history:", updateErr);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
