import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";

serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { storyId, ghostUrl, title, excerpt } = await req.json();

    const PAGE_ACCESS_TOKEN = Deno.env.get('FACEBOOK_PAGE_ACCESS_TOKEN');
    const PAGE_ID = Deno.env.get('FACEBOOK_PAGE_ID');

    if (!PAGE_ACCESS_TOKEN || !PAGE_ID) {
      throw new Error('Facebook credentials not configured');
    }

    console.log('📘 Publishing to Facebook:', { storyId, ghostUrl, title });

    // Build post message
    const message = excerpt ? `${title}\n\n${excerpt}` : title;

    // Step 1: Create the Facebook post (comments disabled at creation time)
    const feedResponse = await fetch(
      `https://graph.facebook.com/v21.0/${PAGE_ID}/feed`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          link: ghostUrl,
          comment_control: 'BLOCKED',
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
    const postId: string = feedResult.id; // format: "{pageId}_{postId}"
    console.log('✅ Facebook post created (comments blocked):', postId);

    // Step 2: Update DB (non-fatal)
    const numericPostId = postId.includes('_') ? postId.split('_')[1] : postId;
    const facebookPostUrl = `https://www.facebook.com/${PAGE_ID}/posts/${numericPostId}`;

    try {
      const supabase = createSupabaseClient();
      const { error: dbError } = await supabase
        .from('stories')
        .update({
          facebook_post_id: postId,
          facebook_post_url: facebookPostUrl,
          facebook_posted_at: new Date().toISOString(),
        })
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
      JSON.stringify({ success: true, postId, url: facebookPostUrl }),
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
