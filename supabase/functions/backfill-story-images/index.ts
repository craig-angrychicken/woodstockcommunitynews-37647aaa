import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { generateGhostToken } from "../_shared/ghost-token.ts";

serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();
    const ghostApiKey = Deno.env.get("GHOST_ADMIN_API_KEY");
    let ghostApiUrl = Deno.env.get("GHOST_API_URL");

    if (!ghostApiKey || !ghostApiUrl) throw new Error("Ghost credentials not configured");

    ghostApiUrl = ghostApiUrl.trim().replace(/\/$/, "");
    if (!ghostApiUrl.startsWith("http")) ghostApiUrl = `https://${ghostApiUrl}`;

    const token = await generateGhostToken(ghostApiKey);

    // mode: "broken" (default) fixes expired external URLs, "missing" only NULL, "all" reprocesses everything
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "broken";
    const supabaseStoragePrefix = "supabase.co/storage";

    // 1. Get stories to update
    let query = supabase
      .from("stories")
      .select("id, title, ghost_url, slug, hero_image_url")
      .eq("status", "published")
      .eq("environment", "production");

    if (mode === "missing") {
      query = query.is("hero_image_url", null);
    } else if (mode === "all") {
      // Reprocess everything
    } else {
      // "broken" mode: get stories where image URL is NOT in Supabase storage (expired external URLs)
      // PostgREST doesn't support NOT LIKE easily, so we fetch all and filter client-side
    }

    const { data: allStories, error: storyErr } = await query;
    if (storyErr) throw new Error(`DB error: ${storyErr.message}`);

    // Filter client-side for "broken" mode: exclude stories already in Supabase storage
    let stories = allStories || [];
    if (mode === "broken") {
      stories = stories.filter(s =>
        !s.hero_image_url || !s.hero_image_url.includes(supabaseStoragePrefix)
      );
    }

    if (stories.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No stories need images", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${stories.length} stories to process (mode=${mode})`);

    // 2. Fetch all Ghost posts with feature images
    const ghostRes = await fetch(
      `${ghostApiUrl}/ghost/api/admin/posts/?filter=status:published&fields=slug,title,feature_image&limit=all`,
      { headers: { Authorization: `Ghost ${token}`, "Accept-Version": "v5.0" } }
    );
    if (!ghostRes.ok) throw new Error(`Ghost API error: ${ghostRes.status}`);
    const ghostData = await ghostRes.json();

    // Build slug→image and title→image maps
    const ghostSlugMap = new Map<string, string>();
    const ghostTitleMap = new Map<string, { slug: string; image: string }>();
    for (const post of ghostData.posts) {
      if (post.feature_image) {
        ghostSlugMap.set(post.slug, post.feature_image);
        ghostTitleMap.set(post.title.toLowerCase().trim(), { slug: post.slug, image: post.feature_image });
      }
    }

    console.log(`Ghost has ${ghostSlugMap.size} posts with images`);

    // Title similarity via word overlap (Jaccard)
    function titleSimilarity(a: string, b: string): number {
      const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
      const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
      const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
      const union = new Set([...wordsA, ...wordsB]).size;
      return union === 0 ? 0 : intersection / union;
    }

    // 3. Match and download
    let updated = 0;
    let noMatch = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const story of stories) {
      // Extract Ghost slug from ghost_url
      let ghostSlug = "";
      if (story.ghost_url) {
        const parts = story.ghost_url.replace(/\/$/, "").split("/");
        ghostSlug = parts[parts.length - 1];
      }

      // Match by slug first
      let ghostImage = ghostSlugMap.get(ghostSlug) || ghostSlugMap.get(story.slug || "");
      let matchMethod = ghostImage ? "slug" : "";

      // Fallback: title similarity > 0.5
      if (!ghostImage) {
        let bestScore = 0;
        for (const [ghostTitle, info] of ghostTitleMap.entries()) {
          const score = titleSimilarity(story.title, ghostTitle);
          if (score > bestScore && score > 0.5) {
            bestScore = score;
            ghostImage = info.image;
            matchMethod = `title(${score.toFixed(2)})`;
          }
        }
      }

      if (!ghostImage) {
        results.push({ title: story.title, status: "no_ghost_match" });
        noMatch++;
        continue;
      }

      // Rewrite image URL to use Ghost's actual domain
      const actualImageUrl = ghostImage.replace(
        "https://woodstockcommunity.news",
        ghostApiUrl
      );

      console.log(`Matched "${story.title}" [${matchMethod}]: ${actualImageUrl}`);

      try {
        const imgRes = await fetch(actualImageUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageBackfill/1.0)" },
          redirect: "follow",
        });
        if (!imgRes.ok) {
          results.push({ title: story.title, status: "download_failed", http: imgRes.status, matchMethod });
          noMatch++;
          continue;
        }

        const buffer = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        if (buffer.byteLength < 1000) {
          results.push({ title: story.title, status: "image_too_small", bytes: buffer.byteLength, matchMethod });
          noMatch++;
          continue;
        }

        const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
        const storagePath = `story-images/${story.id}/hero.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("artifact-images")
          .upload(storagePath, buffer, { contentType, upsert: true });

        if (uploadErr) {
          results.push({ title: story.title, status: "upload_failed", error: uploadErr.message, matchMethod });
          noMatch++;
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("artifact-images")
          .getPublicUrl(storagePath);

        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
          results.push({ title: story.title, status: "no_public_url", matchMethod });
          noMatch++;
          continue;
        }

        const { error: updateErr } = await supabase
          .from("stories")
          .update({ hero_image_url: publicUrl })
          .eq("id", story.id);

        if (updateErr) {
          results.push({ title: story.title, status: "update_failed", error: updateErr.message, matchMethod });
          noMatch++;
          continue;
        }

        console.log(`Updated: ${story.title} -> ${publicUrl}`);
        results.push({ title: story.title, status: "updated", image: publicUrl, matchMethod });
        updated++;
      } catch (err) {
        results.push({ title: story.title, status: "error", error: String(err), matchMethod });
        noMatch++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, total: stories.length, updated, noMatch, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
