import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { generateGhostToken } from "../_shared/ghost-token.ts";

interface GhostPost {
  slug: string;
  title: string;
  feature_image: string | null;
  html: string;
  published_at: string;
  excerpt: string;
  custom_excerpt: string | null;
}

async function fetchAllGhostPosts(ghostApiUrl: string, token: string): Promise<GhostPost[]> {
  const allPosts: GhostPost[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `${ghostApiUrl}/ghost/api/admin/posts/?filter=status:published&fields=slug,title,feature_image,html,published_at,excerpt,custom_excerpt&limit=${perPage}&page=${page}&formats=html`;
    console.log(`Fetching Ghost page ${page}...`);
    const res = await fetch(url, {
      headers: { Authorization: `Ghost ${token}`, "Accept-Version": "v5.0" },
    });
    if (!res.ok) throw new Error(`Ghost API error: ${res.status}`);
    const data = await res.json();
    const posts = data.posts || [];
    allPosts.push(...posts);
    console.log(`  Got ${posts.length} posts (total: ${allPosts.length})`);

    // Check pagination
    const meta = data.meta?.pagination;
    if (!meta || page >= meta.pages) break;
    page++;
  }

  return allPosts;
}

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
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    // 1. Fetch ALL Ghost posts with pagination
    const ghostPosts = await fetchAllGhostPosts(ghostApiUrl, token);
    console.log(`Fetched ${ghostPosts.length} total Ghost posts`);

    // 2. Get all existing stories' slugs and ghost_urls
    const { data: existingStories, error: storyErr } = await supabase
      .from("stories")
      .select("id, slug, ghost_url, title")
      .eq("environment", "production");

    if (storyErr) throw new Error(`DB error: ${storyErr.message}`);

    const existingSlugs = new Set<string>();
    const existingGhostUrls = new Set<string>();
    const existingTitles = new Set<string>();
    for (const s of existingStories || []) {
      if (s.slug) existingSlugs.add(s.slug);
      if (s.ghost_url) {
        const parts = s.ghost_url.replace(/\/$/, "").split("/");
        existingGhostUrls.add(parts[parts.length - 1]);
      }
      existingTitles.add(s.title.toLowerCase().trim());
    }

    console.log(`Existing stories: ${existingStories?.length || 0}`);

    // 3. Find Ghost posts not yet in Supabase
    const newPosts = ghostPosts.filter((p) => {
      if (existingSlugs.has(p.slug)) return false;
      if (existingGhostUrls.has(p.slug)) return false;
      if (existingTitles.has(p.title.toLowerCase().trim())) return false;
      return true;
    });

    console.log(`New posts to migrate: ${newPosts.length}`);

    if (dryRun) {
      return new Response(JSON.stringify({
        success: true,
        dry_run: true,
        ghost_total: ghostPosts.length,
        existing: existingStories?.length || 0,
        new_to_migrate: newPosts.length,
        posts: newPosts.map((p) => ({
          slug: p.slug,
          title: p.title,
          has_image: !!p.feature_image,
          published_at: p.published_at,
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Migrate each new post
    let created = 0;
    let failed = 0;
    const results: Array<Record<string, unknown>> = [];

    // Get logo fallback URL
    const { data: logoUrlData } = supabase.storage.from("artifact-images").getPublicUrl("defaults/hero-default.png");
    const logoPublicUrl = logoUrlData?.publicUrl || null;

    for (const post of newPosts) {
      try {
        const htmlContent = post.html || "";
        const excerpt = post.custom_excerpt || post.excerpt || "";
        const textContent = htmlContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const wordCount = textContent.split(/\s+/).filter((w: string) => w.length > 0).length;

        const structuredMetadata: Record<string, string> = {
          byline: "Woodstock Community News",
        };
        if (excerpt) structuredMetadata.subhead = excerpt.substring(0, 200);

        const storyId = crypto.randomUUID();
        let heroImageUrl = logoPublicUrl;

        // Download and upload feature image
        if (post.feature_image) {
          try {
            let imgUrl = post.feature_image;
            imgUrl = imgUrl.replace("https://woodstockcommunity.news", ghostApiUrl);
            imgUrl = imgUrl.replace(/\/size\/w\d+\//, "/");

            const imgRes = await fetch(imgUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; GhostMigration/1.0)" },
              redirect: "follow",
            });

            if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              const contentType = imgRes.headers.get("content-type") || "image/jpeg";

              if (buffer.byteLength > 1000) {
                const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
                const storagePath = `story-images/${storyId}/hero.${ext}`;

                const { error: uploadErr } = await supabase.storage
                  .from("artifact-images")
                  .upload(storagePath, buffer, { contentType, upsert: true });

                if (!uploadErr) {
                  const { data: urlData } = supabase.storage
                    .from("artifact-images")
                    .getPublicUrl(storagePath);
                  if (urlData?.publicUrl) heroImageUrl = urlData.publicUrl;
                }
              }
            }
          } catch (imgErr) {
            console.log(`Image download failed for ${post.slug}: ${imgErr}`);
          }
        }

        // Insert story
        const { error: insertErr } = await supabase.from("stories").insert({
          id: storyId,
          title: post.title,
          content: htmlContent,
          status: "published",
          published_at: post.published_at,
          environment: "production",
          slug: post.slug,
          ghost_url: `https://woodstockcommunity.news/${post.slug}/`,
          hero_image_url: heroImageUrl,
          structured_metadata: structuredMetadata,
          word_count: wordCount,
          source_count: 1,
          generation_metadata: { source: "ghost_migration", migrated_at: new Date().toISOString() },
        });

        if (insertErr) {
          results.push({ title: post.title, status: "insert_failed", error: insertErr.message });
          failed++;
        } else {
          results.push({ title: post.title, status: "created", slug: post.slug, hasImage: heroImageUrl !== logoPublicUrl });
          created++;
        }
      } catch (err) {
        results.push({ title: post.title, status: "error", error: String(err) });
        failed++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        ghost_total: ghostPosts.length,
        existing: existingStories?.length || 0,
        new_migrated: created,
        failed,
        results,
      }),
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
