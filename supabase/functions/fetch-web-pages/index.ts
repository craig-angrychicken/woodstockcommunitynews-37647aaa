import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import {
  fetchPageHTML,
  extractWithReadability,
  extractImages,
  extractVideos,
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

        // 3. Extract images from Readability HTML
        const imageUrls = extractImages(readResult.content, source.url);
        console.log(`   Images found: ${imageUrls.length}`);

        // 4. Extract videos
        const videoUrls = extractVideos(readResult.content);
        console.log(`   Videos found: ${videoUrls.length}`);

        // 5. Generate deterministic GUID from source_id + URL
        const fingerprint = `${source.id}:${source.url}`;
        const guid = await normalizeToUUID(fingerprint);

        // 6. Download and store images
        const storageFolderGuid = crypto.randomUUID();
        const storageImages: { original_url: string; stored_url: string; download_failed?: true; type?: string; embed_type?: string }[] = [];

        for (let i = 0; i < imageUrls.length; i++) {
          const result = await downloadAndStoreImage(supabase, imageUrls[i].url, storageFolderGuid, i);
          if (result) storageImages.push(result);
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

        const heroImage = storageImages.find((img) => !("type" in img) || img.type !== "video")?.stored_url || null;

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

        // 10. Update query history
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
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
