import type { Env } from "../env";
import { all, first, run, fromJson } from "../_shared/db";
import type { StoryRow } from "../_shared/types";

const GRAPH = "https://graph.facebook.com/v21.0";

interface BulkRepostOptions {
  batchSize?: number;
  sinceDate?: string;
  throttleMs?: number;
  orphansToDelete?: string[];
}

interface BulkRepostResult {
  success: boolean;
  error?: string;
  processed?: number;
  successful?: number;
  failed?: number;
  remaining?: number;
  orphansDeleted?: Array<{ id: string; ok: boolean; body?: string }>;
  results?: Array<Record<string, unknown>>;
}

async function deleteFbPost(postId: string, token: string): Promise<{ ok: boolean; body?: string }> {
  try {
    const res = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    if (res.ok) return { ok: true };
    return { ok: false, body: await res.text() };
  } catch (err) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Batch-convert published Facebook link posts into photo posts (backdated to the
 * original publish time), then post a comment containing the story link. Optionally
 * deletes orphan posts first. Throttles between stories to respect rate limits.
 */
export async function bulkRepostFacebook(env: Env, opts: BulkRepostOptions = {}): Promise<BulkRepostResult> {
  const batchSize: number = opts.batchSize ?? 10;
  const sinceDate: string = opts.sinceDate ?? "2026-02-01";
  const throttleMs: number = opts.throttleMs ?? 10000;
  const orphansToDelete: string[] = opts.orphansToDelete ?? [];

  console.log(`🔄 bulk-repost-facebook starting: batchSize=${batchSize}, sinceDate=${sinceDate}, throttleMs=${throttleMs}, orphans=${orphansToDelete.length}`);

  const PAGE_ACCESS_TOKEN = env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const PAGE_ID = env.FACEBOOK_PAGE_ID;
  if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
    return { success: false, error: "Facebook credentials not configured" };
  }

  // Step 1: delete any orphan posts first
  const orphansDeleted: Array<{ id: string; ok: boolean; body?: string }> = [];
  for (const orphanId of orphansToDelete) {
    const r = await deleteFbPost(orphanId, PAGE_ACCESS_TOKEN);
    orphansDeleted.push({ id: orphanId, ...r });
    console.log(`🗑️ Orphan ${orphanId}: ${r.ok ? "deleted" : `failed: ${r.body}`}`);
  }

  // Step 2: fetch batch of stories needing repost
  let rows: StoryRow[];
  try {
    rows = await all<StoryRow>(
      env,
      `select id, title, slug, hero_image_url, structured_metadata, facebook_post_id, published_at
         from stories
        where status = 'published'
          and environment = 'production'
          and is_test = 0
          and published_at >= ?
          and facebook_photo_post_at is null
          and hero_image_url is not null
        order by published_at asc
        limit ?`,
      sinceDate,
      batchSize,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg, orphansDeleted };
  }

  console.log(`📚 Processing ${rows.length} stories`);

  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < rows.length; i++) {
    const story = rows[i];
    const titlePreview = story.title.slice(0, 60);
    console.log(`\n[${i + 1}/${rows.length}] "${titlePreview}" (${story.id})`);

    try {
      // Delete old FB post if we have one
      let deleteResult: { ok: boolean; body?: string } | null = null;
      if (story.facebook_post_id) {
        deleteResult = await deleteFbPost(story.facebook_post_id, PAGE_ACCESS_TOKEN);
        console.log(`  🗑️ Delete old post: ${deleteResult.ok ? "ok" : `warn: ${deleteResult.body}`}`);
      }

      // Build caption
      const metadata = fromJson<{ subhead?: string } | null>(story.structured_metadata, null);
      const subhead = metadata?.subhead;
      const caption = subhead ? `${story.title}\n\n${subhead}` : story.title;
      const storyUrl = new URL(`/${story.slug}`, env.PUBLIC_SITE_URL).toString();
      const backdatedTime = Math.floor(new Date(story.published_at as string).getTime() / 1000);

      // Hero image must be an absolute HTTPS URL for the Facebook Graph fetch.
      const heroImageUrl = new URL(story.hero_image_url as string, env.PUBLIC_SITE_URL).toString();

      // Post photo (backdated to original publish time)
      const photoRes = await fetch(`${GRAPH}/${PAGE_ID}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: heroImageUrl,
          message: caption,
          backdated_time: backdatedTime,
          backdated_time_granularity: "min",
          access_token: PAGE_ACCESS_TOKEN,
        }),
      });

      if (!photoRes.ok) {
        const errBody = await photoRes.text();
        throw new Error(`Photo POST ${photoRes.status}: ${errBody}`);
      }

      const photoJson = (await photoRes.json()) as { post_id: string };
      const newPostId: string = photoJson.post_id;
      const numericPostId = newPostId.includes("_") ? newPostId.split("_")[1] : newPostId;
      const newPostUrl = `https://www.facebook.com/${PAGE_ID}/posts/${numericPostId}`;
      console.log(`  ✅ Photo posted: ${newPostId}`);

      // Post comment with link
      const commentRes = await fetch(`${GRAPH}/${newPostId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Read the full story: ${storyUrl}`,
          access_token: PAGE_ACCESS_TOKEN,
        }),
      });

      const commentOk = commentRes.ok;
      let commentErr: string | undefined;
      if (!commentRes.ok) {
        commentErr = await commentRes.text();
        console.warn(`  ⚠️ Comment failed (non-fatal): ${commentErr}`);
      } else {
        console.log(`  ✅ Link comment posted`);
      }

      // Update DB
      const nowIso = new Date().toISOString();
      try {
        await run(
          env,
          `update stories
              set facebook_post_id = ?,
                  facebook_post_url = ?,
                  facebook_posted_at = ?,
                  facebook_photo_post_at = ?,
                  updated_at = ?
            where id = ?`,
          newPostId,
          newPostUrl,
          nowIso,
          nowIso,
          nowIso,
          story.id,
        );
      } catch (updateErr) {
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        console.warn(`  ⚠️ DB update failed: ${msg}`);
      }

      results.push({
        id: story.id,
        title: titlePreview,
        ok: true,
        newPostId,
        newPostUrl,
        oldPostDeleted: deleteResult?.ok ?? "no_old_post",
        commentOk,
        commentErr,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ Error: ${msg}`);
      results.push({ id: story.id, title: titlePreview, ok: false, error: msg });
    }

    // Throttle between stories (but skip on last)
    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }

  // Count remaining
  const remainingRow = await first<{ count: number }>(
    env,
    `select count(id) as count
       from stories
      where status = 'published'
        and environment = 'production'
        and is_test = 0
        and published_at >= ?
        and facebook_photo_post_at is null
        and hero_image_url is not null`,
    sinceDate,
  );
  const remaining = remainingRow?.count ?? 0;

  const summary = {
    processed: rows.length,
    successful: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining,
    orphansDeleted,
    results,
  };
  console.log(`\n✅ Batch done: ${summary.successful}/${summary.processed} successful, ${summary.remaining} remaining`);

  return { success: true, ...summary };
}
