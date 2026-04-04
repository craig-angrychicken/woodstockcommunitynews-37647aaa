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
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "broken";

    // 1. Get stories
    const { data: allStories, error: storyErr } = await supabase
      .from("stories")
      .select("id, title, ghost_url, slug, hero_image_url")
      .eq("status", "published")
      .eq("environment", "production");

    if (storyErr) throw new Error(`DB error: ${storyErr.message}`);

    // Filter based on mode
    let stories = allStories || [];
    if (mode === "broken") {
      stories = stories.filter(s =>
        !s.hero_image_url ||
        !s.hero_image_url.includes("supabase.co/storage") ||
        s.hero_image_url.includes("hero-default.svg")
      );
    } else if (mode === "missing") {
      stories = stories.filter(s => !s.hero_image_url);
    }

    if (stories.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No stories need images", updated: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${stories.length} stories to process (mode=${mode})`);

    // 2. Fetch ALL Ghost posts with HTML content to extract images
    const ghostRes = await fetch(
      `${ghostApiUrl}/ghost/api/admin/posts/?filter=status:published&fields=slug,title,feature_image,html&limit=all&formats=html`,
      { headers: { Authorization: `Ghost ${token}`, "Accept-Version": "v5.0" } }
    );
    if (!ghostRes.ok) throw new Error(`Ghost API error: ${ghostRes.status}`);
    const ghostData = await ghostRes.json();

    // Extract first meaningful image from HTML content
    function extractFirstImage(html: string): string | null {
      if (!html) return null;
      const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        // Skip logos, icons, tracking pixels
        if (src.includes("wcnlogov1") || src.includes("logo") || src.includes("icon") || src.includes("pixel") || src.includes("spacer")) continue;
        // Skip tiny images (likely decorative)
        if (src.includes("width=1") || src.includes("height=1")) continue;
        return src;
      }
      return null;
    }

    // Build multiple lookup maps
    const ghostBySlug = new Map<string, { title: string; image: string | null; htmlImage: string | null }>();
    const ghostByTitle = new Map<string, { slug: string; image: string | null; htmlImage: string | null }>();
    for (const post of ghostData.posts) {
      const htmlImage = extractFirstImage(post.html);
      ghostBySlug.set(post.slug, { title: post.title, image: post.feature_image, htmlImage });
      ghostByTitle.set(post.title.toLowerCase().trim(), { slug: post.slug, image: post.feature_image, htmlImage });
    }

    console.log(`Ghost has ${ghostData.posts.length} posts, ${[...ghostBySlug.values()].filter(v => v.image).length} with feature_image, ${[...ghostBySlug.values()].filter(v => v.htmlImage).length} with HTML images`);

    // 3. Download logo once as fallback for stories with no image source
    let logoPublicUrl: string | null = null;
    try {
      const logoUrl = `${ghostApiUrl}/content/images/2025/11/wcnlogov1-1.png`;
      const logoRes = await fetch(logoUrl, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow" });
      if (logoRes.ok) {
        const logoBuffer = await logoRes.arrayBuffer();
        const logoContentType = logoRes.headers.get("content-type") || "image/png";
        if (logoBuffer.byteLength > 1000) {
          const { error: logoUpErr } = await supabase.storage
            .from("artifact-images")
            .upload("defaults/hero-default.png", logoBuffer, { contentType: logoContentType, upsert: true });
          if (!logoUpErr) {
            const { data: logoUrlData } = supabase.storage.from("artifact-images").getPublicUrl("defaults/hero-default.png");
            logoPublicUrl = logoUrlData?.publicUrl || null;
            console.log(`Logo fallback ready: ${logoPublicUrl}`);
          }
        }
      }
    } catch (err) {
      console.log(`Logo fallback download failed: ${err}`);
    }

    // 4. Process each story
    let updated = 0;
    let noImage = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const story of stories) {
      // Extract slug from ghost_url
      let ghostUrlSlug = "";
      if (story.ghost_url) {
        const parts = story.ghost_url.replace(/\/$/, "").split("/");
        ghostUrlSlug = parts[parts.length - 1];
      }

      // Try multiple matching strategies to find a Ghost post
      let ghostImage: string | null = null;
      let matchMethod = "";

      // Helper to get best image from a ghost post entry (feature_image first, then HTML image)
      const getBestImage = (entry: { image: string | null; htmlImage: string | null }): string | null => {
        return entry.image || entry.htmlImage;
      };

      // Strategy 1: exact ghost_url slug match
      const byGhostUrl = ghostBySlug.get(ghostUrlSlug);
      if (byGhostUrl) {
        const img = getBestImage(byGhostUrl);
        if (img) {
          ghostImage = img;
          matchMethod = byGhostUrl.image ? "ghost_url_slug" : "ghost_url_slug_html";
        }
      }

      // Strategy 2: exact db slug match
      if (!ghostImage && story.slug) {
        const byDbSlug = ghostBySlug.get(story.slug);
        if (byDbSlug) {
          const img = getBestImage(byDbSlug);
          if (img) {
            ghostImage = img;
            matchMethod = byDbSlug.image ? "db_slug" : "db_slug_html";
          }
        }
      }

      // Strategy 3: fuzzy slug match (handle apostrophe differences)
      if (!ghostImage) {
        const normalizeSlug = (s: string) => s.replace(/-s-/g, "s-").replace(/--+/g, "-").replace(/-$/, "");
        const normGhostUrl = normalizeSlug(ghostUrlSlug);
        const normDbSlug = normalizeSlug(story.slug || "");
        for (const [gSlug, gData] of ghostBySlug) {
          const img = getBestImage(gData);
          if (!img) continue;
          const normGSlug = normalizeSlug(gSlug);
          if (normGSlug === normGhostUrl || normGSlug === normDbSlug) {
            ghostImage = img;
            matchMethod = "fuzzy_slug";
            break;
          }
          if (normGhostUrl.length > 20 && (normGSlug.startsWith(normGhostUrl) || normGhostUrl.startsWith(normGSlug))) {
            ghostImage = img;
            matchMethod = "prefix_slug";
            break;
          }
          if (normDbSlug.length > 20 && (normGSlug.startsWith(normDbSlug) || normDbSlug.startsWith(normGSlug))) {
            ghostImage = img;
            matchMethod = "prefix_slug";
            break;
          }
        }
      }

      // Strategy 4: exact title match (case-insensitive)
      if (!ghostImage) {
        const byTitle = ghostByTitle.get(story.title.toLowerCase().trim());
        if (byTitle) {
          const img = getBestImage(byTitle);
          if (img) {
            ghostImage = img;
            matchMethod = byTitle.image ? "exact_title" : "exact_title_html";
          }
        }
      }

      // Strategy 5: title word overlap (Jaccard > 0.4)
      if (!ghostImage) {
        const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 2));
        const storyWords = wordsOf(story.title);
        let bestScore = 0;
        for (const [gTitle, gData] of ghostByTitle) {
          const img = getBestImage(gData);
          if (!img) continue;
          const gWords = wordsOf(gTitle);
          const inter = [...storyWords].filter(w => gWords.has(w)).length;
          const union = new Set([...storyWords, ...gWords]).size;
          const score = union > 0 ? inter / union : 0;
          if (score > bestScore && score > 0.4) {
            bestScore = score;
            ghostImage = img;
            matchMethod = `title_sim(${score.toFixed(2)})`;
          }
        }
      }

      // Strategy 6: scrape Ghost page directly for og:image or content images
      if (!ghostImage) {
        const slugsToTry = [ghostUrlSlug, story.slug].filter(Boolean);
        for (const slug of slugsToTry) {
          if (ghostImage) break;
          try {
            const pageUrl = `${ghostApiUrl}/${slug}/`;
            console.log(`Scraping Ghost page: ${pageUrl}`);
            const pageRes = await fetch(pageUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageBackfill/1.0)" },
              redirect: "follow",
            });
            if (!pageRes.ok) continue;
            const html = await pageRes.text();

            // Try og:image first
            const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
              || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);
            if (ogMatch?.[1] && !ogMatch[1].includes("wcnlogov1")) {
              let ogUrl = ogMatch[1];
              if (ogUrl.startsWith("/")) ogUrl = `${ghostApiUrl}${ogUrl}`;
              ghostImage = ogUrl;
              matchMethod = "page_scrape_og";
              break;
            }

            // Try first content image (skip sidebar thumbnails)
            const contentImg = extractFirstImage(html);
            if (contentImg && !contentImg.includes("image-0-")) {
              let fullUrl = contentImg;
              if (fullUrl.startsWith("/")) fullUrl = `${ghostApiUrl}${fullUrl}`;
              ghostImage = fullUrl;
              matchMethod = "page_scrape_content";
              break;
            }
          } catch (err) {
            console.log(`Page scrape failed for ${slug}: ${err}`);
          }
        }
      }

      // Strategy 7: use artifact images already stored in Supabase
      if (!ghostImage) {
        try {
          const { data: artLinks } = await supabase
            .from("story_artifacts")
            .select("artifact_id")
            .eq("story_id", story.id);
          if (artLinks && artLinks.length > 0) {
            const artIds = artLinks.map(a => a.artifact_id);
            const { data: arts } = await supabase
              .from("artifacts")
              .select("images, hero_image_url")
              .in("id", artIds);
            if (arts) {
              for (const art of arts) {
                if (ghostImage) break;
                // Check for Supabase-stored artifact images
                if (art.images && Array.isArray(art.images)) {
                  for (const img of art.images) {
                    if (img.stored_url && img.stored_url.includes("supabase.co/storage")) {
                      ghostImage = img.stored_url;
                      matchMethod = "artifact_stored";
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.log(`Artifact lookup failed for ${story.title}: ${err}`);
        }
      }

      if (!ghostImage) {
        // Use logo fallback for stories with no image source
        if (logoPublicUrl) {
          const { error: updateErr } = await supabase
            .from("stories")
            .update({ hero_image_url: logoPublicUrl })
            .eq("id", story.id);
          if (!updateErr) {
            results.push({ title: story.title, status: "updated", matchMethod: "logo_fallback", image: logoPublicUrl });
            updated++;
          } else {
            results.push({ title: story.title, status: "update_failed", error: updateErr.message });
            noImage++;
          }
        } else {
          console.log(`No image: ${story.title} | ghost_slug=${ghostUrlSlug}`);
          results.push({ title: story.title, status: "no_image", ghostUrlSlug });
          noImage++;
        }
        continue;
      }

      // Normalize image URL — ensure it points to ghost.io (not the custom domain)
      let actualImageUrl = ghostImage;
      // If it's already a Supabase URL (from artifact_stored), skip normalization
      if (actualImageUrl.includes("supabase.co/storage")) {
        // Already a valid public URL — just update the story directly
        const { error: updateErr } = await supabase
          .from("stories")
          .update({ hero_image_url: actualImageUrl })
          .eq("id", story.id);
        if (updateErr) {
          results.push({ title: story.title, status: "update_failed", error: updateErr.message });
          noImage++;
        } else {
          results.push({ title: story.title, status: "updated", matchMethod, image: actualImageUrl });
          updated++;
        }
        continue;
      }
      if (actualImageUrl.startsWith("//")) actualImageUrl = `https:${actualImageUrl}`;
      actualImageUrl = actualImageUrl.replace("https://woodstockcommunity.news", ghostApiUrl);
      // Strip Ghost image size parameters to get full-size image
      actualImageUrl = actualImageUrl.replace(/\/size\/w\d+\//, "/");

      // Download and upload
      try {
        const imgRes = await fetch(actualImageUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageBackfill/1.0)" },
          redirect: "follow",
        });
        if (!imgRes.ok) {
          results.push({ title: story.title, status: "download_failed", http: imgRes.status, url: actualImageUrl, matchMethod });
          noImage++;
          continue;
        }

        const buffer = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get("content-type") || "image/jpeg";
        if (buffer.byteLength < 1000) {
          results.push({ title: story.title, status: "too_small", bytes: buffer.byteLength, matchMethod });
          noImage++;
          continue;
        }

        const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";
        const storagePath = `story-images/${story.id}/hero.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("artifact-images")
          .upload(storagePath, buffer, { contentType, upsert: true });

        if (uploadErr) {
          results.push({ title: story.title, status: "upload_failed", error: uploadErr.message });
          noImage++;
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("artifact-images")
          .getPublicUrl(storagePath);

        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
          results.push({ title: story.title, status: "no_public_url" });
          noImage++;
          continue;
        }

        const { error: updateErr } = await supabase
          .from("stories")
          .update({ hero_image_url: publicUrl })
          .eq("id", story.id);

        if (updateErr) {
          results.push({ title: story.title, status: "update_failed", error: updateErr.message });
          noImage++;
          continue;
        }

        results.push({ title: story.title, status: "updated", matchMethod, image: publicUrl });
        updated++;
      } catch (err) {
        results.push({ title: story.title, status: "error", error: String(err) });
        noImage++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, total: stories.length, updated, noImage, results }),
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
