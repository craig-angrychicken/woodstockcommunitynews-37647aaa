import type { Env } from "../env";
import type { StoryRow } from "../_shared/types";
import { first, run, fromJson } from "../_shared/db";
import { publishToFacebook } from "./publish-to-facebook";
import { triggerRevalidate } from "./trigger-revalidate";

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

export interface PublishStoryResult {
  success: boolean;
  url?: string;
  slug?: string;
  error?: string;
}

export async function publishStory(
  env: Env,
  storyId: string,
  featured?: boolean,
): Promise<PublishStoryResult> {
  try {
    if (!storyId) {
      throw new Error("storyId is required");
    }

    // Read story from DB
    const story = await first<
      Pick<
        StoryRow,
        "id" | "title" | "content" | "published_url" | "structured_metadata" | "hero_image_url" | "council_meeting_id"
      >
    >(
      env,
      `select id, title, content, published_url, structured_metadata, hero_image_url, council_meeting_id
         from stories where id = ?`,
      storyId,
    );

    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Quality gate — this is the single chokepoint for everything that reaches
    // the public site + Facebook, so refuse to publish a degenerate story here.
    // A blank/symbol-only title slugs to "" (which would publish at the homepage
    // URL and post a homepage link to Facebook); an empty/near-empty body is a
    // broken LLM result. Block both rather than publishing garbage unattended.
    const MIN_CONTENT_CHARS = 200;
    const cleanTitle = (story.title || "").trim();
    const cleanContent = (story.content || "").trim();
    const baseSlug = slugify(cleanTitle);
    if (!cleanTitle || !baseSlug || cleanContent.length < MIN_CONTENT_CHARS) {
      const reason = `Quality gate failed (title="${cleanTitle.slice(0, 40)}", slug="${baseSlug}", content=${cleanContent.length} chars, min ${MIN_CONTENT_CHARS})`;
      console.error(`🚫 Refusing to publish ${storyId}: ${reason}`);
      return { success: false, error: reason };
    }

    const isFirstPublish = !story.published_url;

    let finalSlug = baseSlug;
    let suffix = 2;

    // Check for slug collisions
    while (true) {
      const existing = await first<{ id: string }>(
        env,
        `select id from stories where slug = ? and id != ? limit 1`,
        finalSlug,
        storyId,
      );

      if (!existing) break;
      finalSlug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    const publicUrl = new URL(`/${finalSlug}`, env.PUBLIC_SITE_URL).toString();
    const nowIso = new Date().toISOString();

    // Update story
    await run(
      env,
      `update stories
         set status = 'published',
             slug = ?,
             published_at = ?,
             featured = ?,
             published_url = ?,
             updated_at = ?
       where id = ?`,
      finalSlug,
      nowIso,
      featured ? 1 : 0,
      publicUrl,
      nowIso,
      storyId,
    );

    console.log(`✅ Published: "${story.title}" → ${publicUrl}`);

    // Trigger on-demand revalidation (non-fatal). Reuse the shared helper, which
    // checks res.ok so a secret mismatch surfaces in logs instead of silently
    // leaving pages stale.
    if (env.REVALIDATION_SECRET) {
      try {
        const paths = ["/", `/${finalSlug}`];
        if (story.council_meeting_id) paths.push("/council");
        const { results } = await triggerRevalidate(env, paths);
        const failed = results.filter((r) => !r.ok);
        if (failed.length) {
          console.warn(
            "⚠️ Revalidation non-OK for: " +
              failed.map((f) => `${f.path}(${f.status ?? "err"})`).join(", "),
          );
        } else {
          console.log("🔄 Revalidation triggered for " + paths.join(", "));
        }
      } catch (revalErr) {
        console.warn("⚠️ Revalidation failed (non-fatal):", revalErr);
      }
    }

    // Facebook: post link on first publish only (non-fatal)
    if (isFirstPublish) {
      try {
        const metadata = fromJson<Record<string, string> | null>(story.structured_metadata, null);
        const excerpt = metadata?.subhead || undefined;
        const fbData = await publishToFacebook(env, {
          storyId,
          storyUrl: publicUrl,
          title: story.title,
          excerpt,
          heroImageUrl: story.hero_image_url ?? undefined,
        });
        if (!fbData?.success) {
          console.warn(`⚠️ Facebook failed: ${fbData?.error}`);
        } else {
          console.log("📘 Facebook post created");
        }
      } catch (fbErr) {
        console.warn("⚠️ Facebook error (non-fatal):", fbErr);
      }
    }

    return { success: true, url: publicUrl, slug: finalSlug };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ publish-story error:", error);
    return { success: false, error: errorMessage };
  }
}
