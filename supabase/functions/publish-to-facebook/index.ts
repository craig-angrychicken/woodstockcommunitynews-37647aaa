import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";

serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { storyId, ghostUrl, title, excerpt, heroImageUrl } = await req.json();

    const PAGE_ACCESS_TOKEN = Deno.env.get('FACEBOOK_PAGE_ACCESS_TOKEN');
    const PAGE_ID = Deno.env.get('FACEBOOK_PAGE_ID');

    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      throw new Error('Facebook credentials not configured');
    }

    console.log('📘 Publishing to Facebook:', { storyId, ghostUrl, title, hasHero: !!heroImageUrl });

    // Build caption (post message) — same shape for both post types
    const caption = excerpt ? `${title}\n\n${excerpt}` : title;

    let postId: string;
    let postedAsPhoto = false;
    let commentResult: { ok: boolean; body?: string } | null = null;

    if (heroImageUrl) {
      // Photo post — high reach, link goes in first comment
      const photoRes = await fetch(
        `https://graph.facebook.com/v21.0/${PAGE_ID}/photos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: heroImageUrl,
            message: caption,
            access_token: PAGE_ACCESS_TOKEN,
          }),
        }
      );

      if (!photoRes.ok) {
        const errorBody = await photoRes.text();
        console.error('❌ Facebook photo POST failed:', errorBody);
        throw new Error(`Facebook photo API error: ${photoRes.status} - ${errorBody}`);
      }

      const photoResult = await photoRes.json();
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
              message: `Read the full story: ${ghostUrl}`,
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
      const feedResponse = await fetch(
        `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: caption,
            link: ghostUrl,
            access_token: PAGE_ACCESS_TOKEN,
          }),
        }
      );

      if (!feedResponse.ok) {
        const errorBody = await feedResponse.text();
        console.error('❌ Facebook feed POST failed:', errorBody);
        throw new Error(`Facebook API error: ${feedResponse.status} - ${errorBody}`);
      }

      const feedResult = await feedResponse.json();
      postId = feedResult.id; // format: "{pageId}_{postId}"
      console.log('✅ Link post created (no hero image):', postId);
    }

    // Step 2: Update DB (non-fatal)
    const numericPostId = postId.includes('_') ? postId.split('_')[1] : postId;
    const facebookPostUrl = `https://www.facebook.com/${PAGE_ID}/posts/${numericPostId}`;

    try {
      const supabase = createSupabaseClient();
      const updatePayload: Record<string, string> = {
        facebook_post_id: postId,
        facebook_post_url: facebookPostUrl,
        facebook_posted_at: new Date().toISOString(),
      };
      if (postedAsPhoto) {
        updatePayload.facebook_photo_post_at = new Date().toISOString();
      }

      const { error: dbError } = await supabase
        .from('stories')
        .update(updatePayload)
        .eq('id', storyId);

      if (dbError) {
        console.warn('⚠️ DB update failed (non-fatal):', dbError);
      } else {
        console.log('✅ Story updated with Facebook metadata');
      }
    } catch (dbErr) {
      console.warn('⚠️ DB update threw (non-fatal):', dbErr);
    }

    return new Response(
      JSON.stringify({ success: true, postId, url: facebookPostUrl, commentResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error in publish-to-facebook:', error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
