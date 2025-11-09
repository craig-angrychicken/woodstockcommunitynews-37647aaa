import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate JWT token for Ghost Admin API
async function generateGhostToken(apiKey: string): Promise<string> {
  const [id, secret] = apiKey.split(':');
  
  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: id
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + 5 * 60, // 5 minutes
    aud: '/admin/'
  };
  
  const encoder = new TextEncoder();
  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const base64Payload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const message = `${base64Header}.${base64Payload}`;
  const secretBytes = encoder.encode(secret);
  const messageBytes = encoder.encode(message);
  
  // Create HMAC signature
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageBytes);
  const signatureArray = new Uint8Array(signature);
  const base64Signature = btoa(String.fromCharCode(...signatureArray))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  
  return `${message}.${base64Signature}`;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, content, status, tags, featured, excerpt } = await req.json();

    console.log('📝 Publishing to Ghost:', { title, status: status || 'draft' });

    const ghostApiKey = Deno.env.get('GHOST_ADMIN_API_KEY');
    const ghostApiUrl = Deno.env.get('GHOST_API_URL');

    if (!ghostApiKey || !ghostApiUrl) {
      throw new Error('Ghost credentials not configured');
    }

    // Generate JWT token
    const token = await generateGhostToken(ghostApiKey);

    // Prepare post data
    const postData = {
      posts: [{
        title,
        html: content,
        status: status || 'draft',
        tags: tags || [],
        featured: featured || false,
        custom_excerpt: excerpt || null
      }]
    };

    console.log('🔑 Making request to Ghost API');

    // Make request to Ghost API
    const response = await fetch(`${ghostApiUrl}/ghost/api/admin/posts/`, {
      method: 'POST',
      headers: {
        'Authorization': `Ghost ${token}`,
        'Content-Type': 'application/json',
        'Accept-Version': 'v5.0',
      },
      body: JSON.stringify(postData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ghost API error:', errorText);
      throw new Error(`Ghost API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    const post = result.posts[0];

    console.log('✅ Post published successfully:', post.id);

    return new Response(
      JSON.stringify({
        success: true,
        postId: post.id,
        url: post.url,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Error in publish-to-ghost function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
