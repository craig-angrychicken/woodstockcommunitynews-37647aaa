import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";

interface StoryRow {
  id: string;
  title: string;
  slug: string;
  hero_image_url: string;
  structured_metadata: Record<string, unknown> | null;
  facebook_post_id: string | null;
  published_at: string;
}

const GRAPH = "https://graph.facebook.com/v21.0";

async function deleteFbPost(postId: string, token: string): Promise<{ ok: boolean; body?: string }> {
  try {
    const res = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    if (res.ok) return { ok: true };
    return { ok: false, body: await res.text() };
  } catch (err) {
    return { ok: false, body: err instanceof Error ? err.message : String(err) };
  }
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const body = await req.json().catch(() => ({}));
  const batchSize: number = body.batchSize ?? 10;
  const sinceDate: string = body.sinceDate ?? "2026-02-01";
  const throttleMs: number = body.throttleMs ?? 10000;
  const orphansToDelete: string[] = body.orphansToDelete ?? [];

  console.log(`🔄 bulk-repost-facebook starting: batchSize=${batchSize}, sinceDate=${sinceDate}, throttleMs=${throttleMs}, orphans=${orphansToDelete.length}`);

  const PAGE_ACCESS_TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN");
  const PAGE_ID = Deno.env.get("FACEBOOK_PAGE_ID");
  if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
    return new Response(JSON.stringify({ success: false, error: "Facebook credentials not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createSupabaseClient();

  // Step 1: delete any orphan posts first
  const orphansDeleted: Array<{ id: string; ok: boolean; body?: string }> = [];
  for (const orphanId of orphansToDelete) {
    const r = await deleteFbPost(orphanId, PAGE_ACCESS_TOKEN);
    orphansDeleted.push({ id: orphanId, ...r });
    console.log(`🗑️ Orphan ${orphanId}: ${r.ok ? "deleted" : `failed: ${r.body}`}`);
  }

  // Step 2: fetch batch of stories needing repost
  const { data: stories, error: storiesError } = await supabase
    .from("stories")
    .select("id, title, slug, hero_image_url, structured_metadata, facebook_post_id, published_at")
    .eq("status", "published")
    .eq("environment", "production")
    .eq("is_test", false)
    .gte("published_at", sinceDate)
    .is("facebook_photo_post_at", null)
    .not("hero_image_url", "is", null)
    .order("published_at", { ascending: true })
    .limit(batchSize);

  if (storiesError) {
    return new Response(JSON.stringify({ success: false, error: storiesError.message, orphansDeleted }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const rows = (stories as StoryRow[] | null) ?? [];
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
      const subhead = (story.structured_metadata as Record<string, string> | null)?.subhead;
      const caption = subhead ? `${story.title}\n\n${subhead}` : story.title;
      const storyUrl = `https://woodstockcommunity.news/${story.slug}`;
      const backdatedTime = Math.floor(new Date(story.published_at).getTime() / 1000);

      // Post photo (backdated to original publish time)
      const photoRes = await fetch(`${GRAPH}/${PAGE_ID}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: story.hero_image_url,
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

      const photoJson = await photoRes.json();
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

      let commentOk = commentRes.ok;
      let commentErr: string | undefined;
      if (!commentRes.ok) {
        commentErr = await commentRes.text();
        console.warn(`  ⚠️ Comment failed (non-fatal): ${commentErr}`);
      } else {
        console.log(`  ✅ Link comment posted`);
      }

      // Update DB
      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("stories")
        .update({
          facebook_post_id: newPostId,
          facebook_post_url: newPostUrl,
          facebook_posted_at: nowIso,
          facebook_photo_post_at: nowIso,
        })
        .eq("id", story.id);

      if (updateError) {
        console.warn(`  ⚠️ DB update failed: ${updateError.message}`);
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
  const { count: remaining } = await supabase
    .from("stories")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .eq("environment", "production")
    .eq("is_test", false)
    .gte("published_at", sinceDate)
    .is("facebook_photo_post_at", null)
    .not("hero_image_url", "is", null);

  const summary = {
    processed: rows.length,
    successful: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    remaining,
    orphansDeleted,
    results,
  };
  console.log(`\n✅ Batch done: ${summary.successful}/${summary.processed} successful, ${summary.remaining} remaining`);

  return new Response(JSON.stringify({ success: true, ...summary }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
