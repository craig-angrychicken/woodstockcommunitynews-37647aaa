import type { Env } from "../env";
import { run } from "../_shared/db";

export interface PublishToFacebookOptions {
  storyId: string;
  storyUrl: string;
  title: string;
  excerpt?: string;
  heroImageUrl?: string;
}

export interface PublishToFacebookResult {
  success: boolean;
  postId?: string;
  url?: string;
  commentResult?: { ok: boolean; body?: string } | null;
  error?: string;
}

// Map title keywords to a single extra topic hashtag. First match wins.
// Order matters — more specific keywords come first.
function pickTopicHashtag(title: string): string | null {
  const t = title.toLowerCase();
  if (/\bsheriff|police|deputy|deputies|arrest|suspect|fire department|firefighter|wildfire|drought warning\b/.test(t)) {
    return '#PublicSafety';
  }
  if (/\bschool|ccsd|student|classroom|teacher|chorus|elementary|high school|middle school\b/.test(t)) {
    return '#CherokeeSchools';
  }
  if (/\bcity council|mayor|ordinance|zoning|city of woodstock|budget|permit\b/.test(t)) {
    return '#LocalGov';
  }
  if (/\bart|arts|concert|festival|performance|exhibit|gallery|theater|theatre|music\b/.test(t)) {
    return '#WoodstockArts';
  }
  if (/\bchamber|business|grand opening|ribbon cutting|downtown woodstock\b/.test(t)) {
    return '#WoodstockBusiness';
  }
  return null;
}

export async function publishToFacebook(
  env: Env,
  { storyId, storyUrl, title, excerpt, heroImageUrl }: PublishToFacebookOptions,
): Promise<PublishToFacebookResult> {
  try {
    const PAGE_ACCESS_TOKEN = env.FACEBOOK_PAGE_ACCESS_TOKEN;
    const PAGE_ID = env.FACEBOOK_PAGE_ID;
    const PLACE_ID = env.FACEBOOK_PLACE_ID; // Optional: Facebook Place ID for location tagging

    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      throw new Error('Facebook credentials not configured');
    }

    console.log('📘 Publishing to Facebook:', { storyId, storyUrl, title, hasHero: !!heroImageUrl });

    // Derive topic hashtag from title keywords (best-effort)
    const topicTag = pickTopicHashtag(title);
    const hashtags = ['#WoodstockGA', '#CherokeeCounty', ...(topicTag ? [topicTag] : [])].join(' ');

    // Build caption (post message) — same shape for both post types
    const captionBody = excerpt ? `${title}\n\n${excerpt}` : title;
    const caption = `${captionBody}\n\n${hashtags}`;

    let postId: string;
    let postedAsPhoto = false;
    let commentResult: { ok: boolean; body?: string } | null = null;

    if (heroImageUrl) {
      // Photo post — high reach, link goes in first comment
      const photoBody: Record<string, string> = {
        url: heroImageUrl,
        message: caption,
        access_token: PAGE_ACCESS_TOKEN,
      };
      if (PLACE_ID) photoBody.place = PLACE_ID;

      const photoRes = await fetch(
        `https://graph.facebook.com/v21.0/${PAGE_ID}/photos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(photoBody),
        }
      );

      if (!photoRes.ok) {
        const errorBody = await photoRes.text();
        console.error('❌ Facebook photo POST failed:', errorBody);
        throw new Error(`Facebook photo API error: ${photoRes.status} - ${errorBody}`);
      }

      const photoResult = await photoRes.json() as { id?: string; post_id: string };
      // /photos returns { id: photoId, post_id: "{pageId}_{postId}" }
      // post_id wraps the photo; that's what we comment on and link back to.
      postId = photoResult.post_id;
      postedAsPhoto = true;
      console.log('✅ Photo post created:', postId);

      // Follow-up comment with link (non-fatal — photo post already succeeded)
      try {
        const commentRes = await fetch(
          `https://graph.facebook.com/v21.0/${postId}/comments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: `Read the full story: ${storyUrl}`,
              access_token: PAGE_ACCESS_TOKEN,
            }),
          }
        );
        if (!commentRes.ok) {
          const errorBody = await commentRes.text();
          console.warn('⚠️ Link comment failed (non-fatal):', errorBody);
          commentResult = { ok: false, body: errorBody };
        } else {
          console.log('✅ Link comment posted');
          commentResult = { ok: true };
        }
      } catch (commentErr) {
        const msg = commentErr instanceof Error ? commentErr.message : String(commentErr);
        console.warn('⚠️ Link comment threw (non-fatal):', commentErr);
        commentResult = { ok: false, body: `threw: ${msg}` };
      }
    } else {
      // Fallback: link-preview post (no hero image available)
      const feedBody: Record<string, string> = {
        message: caption,
        link: storyUrl,
        access_token: PAGE_ACCESS_TOKEN,
      };
      if (PLACE_ID) feedBody.place = PLACE_ID;

      const feedResponse = await fetch(
        `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedBody),
        }
      );

      if (!feedResponse.ok) {
        const errorBody = await feedResponse.text();
        console.error('❌ Facebook feed POST failed:', errorBody);
        throw new Error(`Facebook API error: ${feedResponse.status} - ${errorBody}`);
      }

      const feedResult = await feedResponse.json() as { id: string };
      postId = feedResult.id; // format: "{pageId}_{postId}"
      console.log('✅ Link post created (no hero image):', postId);
    }

    // Step 2: Update DB (non-fatal)
    const numericPostId = postId.includes('_') ? postId.split('_')[1] : postId;
    const facebookPostUrl = `https://www.facebook.com/${PAGE_ID}/posts/${numericPostId}`;

    try {
      const now = new Date().toISOString();
      if (postedAsPhoto) {
        await run(
          env,
          `update stories set facebook_post_id = ?, facebook_post_url = ?, facebook_posted_at = ?, facebook_photo_post_at = ?, updated_at = ? where id = ?`,
          postId,
          facebookPostUrl,
          now,
          now,
          now,
          storyId,
        );
      } else {
        await run(
          env,
          `update stories set facebook_post_id = ?, facebook_post_url = ?, facebook_posted_at = ?, updated_at = ? where id = ?`,
          postId,
          facebookPostUrl,
          now,
          now,
          storyId,
        );
      }
      console.log('✅ Story updated with Facebook metadata');
    } catch (dbErr) {
      console.warn('⚠️ DB update threw (non-fatal):', dbErr);
    }

    return { success: true, postId, url: facebookPostUrl, commentResult };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error in publish-to-facebook:', error);
    return { success: false, error: errorMessage };
  }
}
