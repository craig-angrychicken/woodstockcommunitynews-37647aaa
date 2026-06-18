import type { Env } from "../env";
import type { StoryRow } from "../_shared/types";
import { first, run, fromJson } from "../_shared/db";
import { publishToFacebook } from "./publish-to-facebook";

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
        "id" | "title" | "ghost_url" | "structured_metadata" | "hero_image_url" | "council_meeting_id"
      >
    >(
      env,
      `select id, title, ghost_url, structured_metadata, hero_image_url, council_meeting_id
         from stories where id = ?`,
      storyId,
    );

    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const isFirstPublish = !story.ghost_url;

    // Generate slug
    const baseSlug = slugify(story.title);
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
             ghost_url = ?,
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

    // Trigger on-demand revalidation (non-fatal)
    const revalidationSecret = env.REVALIDATION_SECRET;
    if (revalidationSecret) {
      try {
        const revalidateBase = new URL("/api/revalidate", env.PUBLIC_SITE_URL).toString();
        const paths = ["/", `/${finalSlug}`];
        if (story.council_meeting_id) paths.push("/council");
        await Promise.all(
          paths.map((p) =>
            fetch(
              `${revalidateBase}?secret=${encodeURIComponent(revalidationSecret)}&path=${encodeURIComponent(p)}`,
              { method: "POST" },
            ),
          ),
        );
        console.log("🔄 Revalidation triggered for " + paths.join(", "));
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
          ghostUrl: publicUrl,
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
