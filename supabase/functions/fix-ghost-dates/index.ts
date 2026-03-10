import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Try to extract the OG image URL from an article page
async function fetchOgImage(articleUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(articleUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WoodstockWire/1.0)' },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    // og:image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) return ogMatch[1];
    // twitter:image fallback
    const twMatch = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    if (twMatch?.[1]) return twMatch[1];
    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch all published stories with ghost_url, joining to get artifact source URL
    const { data: stories, error } = await supabase
      .from('stories')
      .select(`
        id, title, content, ghost_url, published_at, hero_image_url, featured,
        story_artifacts(artifact_id, artifacts(url))
      `)
      .eq('status', 'published')
      .not('ghost_url', 'is', null)
      .not('published_at', 'is', null);

    if (error) throw error;

    console.log(`📋 Found ${stories?.length ?? 0} published stories to fix`);

    const results = { updated: 0, failed: 0, imageRestored: 0, imageCleared: 0, errors: [] as string[] };
    const brokenPrefix = `${supabaseUrl}/storage/v1/object/public/artifact-images/`;

    for (const story of stories ?? []) {
      try {
        let resolvedImageUrl: string | null = story.hero_image_url;

        // Check if hero_image_url is a broken Supabase Storage URL
        const isBrokenStorageUrl = story.hero_image_url?.startsWith(brokenPrefix);
        if (isBrokenStorageUrl) {
          console.log(`🔍 Broken storage image for "${story.title}" — trying to recover...`);

          // Try to get the original article URL from the linked artifact
          const artifactUrl = (story.story_artifacts as any[])?.[0]?.artifacts?.url || null;

          if (artifactUrl && !artifactUrl.includes('facebook.com') && !artifactUrl.includes('instagram.com')) {
            const ogImageUrl = await fetchOgImage(artifactUrl);
            if (ogImageUrl) {
              console.log(`✅ Recovered OG image for "${story.title}": ${ogImageUrl}`);
              resolvedImageUrl = ogImageUrl;
              results.imageRestored++;
            } else {
              console.log(`⚠️ No OG image found for "${story.title}", clearing image`);
              resolvedImageUrl = null;
              results.imageCleared++;
            }
          } else {
            console.log(`⚠️ Cannot scrape source (${artifactUrl?.substring(0, 40)}), clearing image`);
            resolvedImageUrl = null;
            results.imageCleared++;
          }
        }

        const { data: publishData, error: publishError } = await supabase.functions.invoke(
          'publish-to-ghost',
          {
            body: {
              title: story.title,
              content: story.content,
              status: 'published',
              ghostUrl: story.ghost_url,
              publishedAt: story.published_at,
              heroImageUrl: resolvedImageUrl,
              featured: story.featured || false,
              artifactId: null, // Don't trigger storage cleanup on repair run
            },
          }
        );

        if (publishError || !publishData?.success) {
          const err = publishError?.message || publishData?.error || 'Unknown error';
          console.error(`❌ Failed to update "${story.title}": ${err}`);
          results.failed++;
          results.errors.push(`${story.title}: ${err}`);
        } else {
          // Update hero_image_url in our DB to reflect new resolved value
          await supabase
            .from('stories')
            .update({ hero_image_url: resolvedImageUrl })
            .eq('id', story.id);

          console.log(`✅ Fixed "${story.title}"`);
          results.updated++;
        }

        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Exception for "${story.title}": ${msg}`);
        results.failed++;
        results.errors.push(`${story.title}: ${msg}`);
      }
    }

    console.log(`🎉 Done. Updated: ${results.updated}, Images restored: ${results.imageRestored}, Cleared: ${results.imageCleared}, Failed: ${results.failed}`);

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ fix-ghost-dates error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
