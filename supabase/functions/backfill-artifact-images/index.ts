import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { fetchPageHTML, extractImagesFromMeta } from "../_shared/readability.ts";

const MAX_ARTIFACTS = 50;

async function downloadAndStoreImage(
  supabase: ReturnType<typeof createSupabaseClient>,
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
    const storagePath = `${artifactId}/image-0.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("artifact-images")
      .upload(storagePath, buffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`  ❌ Upload error for ${artifactId}:`, uploadError.message);
      return null;
    }

    const { data: urlData } = supabase.storage.from("artifact-images").getPublicUrl(storagePath);
    return urlData?.publicUrl || null;
  } catch (err) {
    console.error(`  ❌ Download error:`, err instanceof Error ? err.message : err);
    return null;
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();

    const body = await req.json().catch(() => ({}));
    const sourceId = body.sourceId as string | undefined;

    console.log("🔄 Starting image backfill for imageless Web Page artifacts...");

    // Fetch imageless Web Page artifacts
    let query = supabase
      .from("artifacts")
      .select("id, url, title")
      .eq("type", "Web Page")
      .is("hero_image_url", null)
      .order("created_at", { ascending: false })
      .limit(MAX_ARTIFACTS);

    if (sourceId) {
      query = query.eq("source_id", sourceId);
    }

    const { data: artifacts, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch artifacts: ${fetchError.message}`);
    }

    if (!artifacts || artifacts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No imageless Web Page artifacts found", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📊 Found ${artifacts.length} imageless Web Page artifacts`);

    let updatedArtifacts = 0;
    let updatedStories = 0;
    let failed = 0;

    for (const artifact of artifacts) {
      console.log(`\n🔍 ${artifact.title || artifact.id}`);
      console.log(`   URL: ${artifact.url}`);

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
      const storedUrl = await downloadAndStoreImage(supabase, images[0].url, artifact.id);
      if (!storedUrl) {
        console.warn(`   ⚠️ Image download/upload failed`);
        failed++;
        continue;
      }

      // Update artifact hero_image_url
      const { error: updateError } = await supabase
        .from("artifacts")
        .update({ hero_image_url: storedUrl })
        .eq("id", artifact.id);

      if (updateError) {
        console.error(`   ❌ Artifact update error:`, updateError.message);
        failed++;
        continue;
      }

      console.log(`   ✅ Artifact updated: ${storedUrl}`);
      updatedArtifacts++;

      // Also update any linked stories that lack images
      const { data: linkedStories } = await supabase
        .from("story_artifacts")
        .select("story_id")
        .eq("artifact_id", artifact.id);

      if (linkedStories && linkedStories.length > 0) {
        const storyIds = linkedStories.map(sa => sa.story_id);
        const { data: updatedRows, error: storyError } = await supabase
          .from("stories")
          .update({ hero_image_url: storedUrl })
          .in("id", storyIds)
          .is("hero_image_url", null)
          .select("id");

        if (storyError) {
          console.warn(`   ⚠️ Story update error:`, storyError.message);
        } else if (updatedRows && updatedRows.length > 0) {
          updatedStories += updatedRows.length;
          console.log(`   ✅ Updated ${updatedRows.length} linked story image(s)`);
        }
      }
    }

    const result = {
      success: true,
      totalProcessed: artifacts.length,
      updatedArtifacts,
      updatedStories,
      failed,
      message: `Backfill complete: ${updatedArtifacts} artifacts + ${updatedStories} stories updated, ${failed} failed`,
    };

    console.log("\n📊 Backfill complete:", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("💥 Error in backfill-artifact-images:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
