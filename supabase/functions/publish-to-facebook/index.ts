import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FacebookPublishRequest {
  storyId: string;
  title: string;
  summary: string;
  ghostUrl: string;
  heroImageUrl?: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const pageAccessToken = Deno.env.get('FACEBOOK_PAGE_ACCESS_TOKEN');
    const pageId = Deno.env.get('FACEBOOK_PAGE_ID');

    if (!pageAccessToken || !pageId) {
      throw new Error('Facebook credentials not configured. Please set FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID.');
    }

    const { storyId, title, summary, ghostUrl, heroImageUrl }: FacebookPublishRequest = await req.json();
    console.log(`Publishing to Facebook: "${title}" -> ${ghostUrl}`);

    if (!ghostUrl) {
      throw new Error('Ghost URL is required. Please publish to Ghost first.');
    }

    // Construct the message: summary + link
    const message = `${summary}\n\nRead the full story: ${ghostUrl}`;

    // Facebook Graph API endpoint for page posts
    const fbApiUrl = `https://graph.facebook.com/v19.0/${pageId}/feed`;

    const postData: Record<string, string> = {
      message: message,
      link: ghostUrl,
      access_token: pageAccessToken,
    };

    console.log('Sending request to Facebook Graph API...');

    const response = await fetch(fbApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(postData).toString(),
    });

    const responseText = await response.text();
    console.log(`Facebook API response status: ${response.status}`);
    console.log(`Facebook API response: ${responseText}`);

    if (!response.ok) {
      let errorMessage = 'Failed to publish to Facebook';
      try {
        const errorData = JSON.parse(responseText);
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        }
      } catch {
        // Use default error message
      }
      throw new Error(errorMessage);
    }

    const result = JSON.parse(responseText);
    const postId = result.id;
    
    // Construct the Facebook post URL
    const facebookPostUrl = `https://www.facebook.com/${postId.replace('_', '/posts/')}`;

    console.log(`Successfully published to Facebook: ${facebookPostUrl}`);

    // Update the story with the Facebook URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (supabaseUrl && supabaseKey && storyId) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      // Store Facebook URL in the stories table (we'll add this column)
      // For now, just log success
      console.log(`Story ${storyId} published to Facebook`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        postId: postId,
        url: facebookPostUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Error publishing to Facebook:', errorMessage);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
