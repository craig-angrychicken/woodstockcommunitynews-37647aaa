import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";

function slugify(title: string): string {
  let slug = title.toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, "-");
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^-|-$/g, "");
  // Truncate at ~80 chars on a hyphen boundary
  if (slug.length > 80) {
    slug = slug.substring(0, 80);
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen > 0) {
      slug = slug.substring(0, lastHyphen);
    }
  }
  return slug;
}

serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { storyId, featured } = await req.json();

    if (!storyId) {
      throw new Error("storyId is required");
    }

    const supabase = createSupabaseClient();

    // Read story from DB
    const { data: story, error: fetchError } = await supabase
      .from("stories")
      .select("id, title, ghost_url, structured_metadata, hero_image_url")
      .eq("id", storyId)
      .single();

    if (fetchError || !story) {
      throw new Error(`Story not found: ${fetchError?.message || storyId}`);
    }

    const isFirstPublish = !story.ghost_url;

    // Generate slug
    const baseSlug = slugify(story.title);
    let finalSlug = baseSlug;
    let suffix = 2;

    // Check for slug collisions
    while (true) {
      const { data: existing } = await supabase
        .from("stories")
        .select("id")
        .eq("slug", finalSlug)
        .neq("id", storyId)
        .limit(1);

      if (!existing || existing.length === 0) break;
      finalSlug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const publicUrl = `https://woodstockcommunity.news/${finalSlug}`;

    // Update story
    const { error: updateError } = await supabase
      .from("stories")
      .update({
        status: "published",
        slug: finalSlug,
        published_at: new Date().toISOString(),
        featured: featured ?? false,
        ghost_url: publicUrl,
      })
      .eq("id", storyId);

    if (updateError) {
      throw new Error(`Failed to update story: ${updateError.message}`);
    }

    console.log(`✅ Published: "${story.title}" → ${publicUrl}`);

    // Trigger Vercel on-demand revalidation (non-fatal)
    const revalidationSecret = Deno.env.get("VERCEL_REVALIDATION_SECRET");
    if (revalidationSecret) {
      try {
        const revalidateBase = "https://woodstockcommunity.news/api/revalidate";
        await Promise.all([
          fetch(`${revalidateBase}?secret=${revalidationSecret}&path=/`, { method: "POST" }),
          fetch(`${revalidateBase}?secret=${revalidationSecret}&path=/${finalSlug}`, { method: "POST" }),
        ]);
        console.log("🔄 Revalidation triggered for / and /" + finalSlug);
      } catch (revalErr) {
        console.warn("⚠️ Revalidation failed (non-fatal):", revalErr);
      }
    }

    // Facebook: post link on first publish only (non-fatal)
    if (isFirstPublish) {
      try {
        const metadata = story.structured_metadata as Record<string, string> | null;
        const excerpt = metadata?.subhead || undefined;
        const { data: fbData, error: fbError } = await supabase.functions.invoke(
          "publish-to-facebook",
          { body: { storyId, ghostUrl: publicUrl, title: story.title, excerpt, heroImageUrl: story.hero_image_url } }
        );
        if (fbError || !fbData?.success) {
          console.warn(`⚠️ Facebook failed: ${fbError?.message || fbData?.error}`);
        } else {
          console.log("📘 Facebook post created");
        }
      } catch (fbErr) {
        console.warn("⚠️ Facebook error (non-fatal):", fbErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, url: publicUrl, slug: finalSlug }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ publish-story error:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
