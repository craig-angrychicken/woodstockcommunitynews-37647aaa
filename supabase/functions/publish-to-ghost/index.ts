import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to convert string to base64url
function base64UrlEncode(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary)
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

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
  
  // Properly encode header and payload to base64url
  const base64Header = base64UrlEncode(JSON.stringify(header));
  const base64Payload = base64UrlEncode(JSON.stringify(payload));
  
  const message = `${base64Header}.${base64Payload}`;
  
  // Convert hex secret to bytes
  const encoder = new TextEncoder();
  const secretBytes = new Uint8Array(secret.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
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
  
  // Convert signature to base64url
  let binary = '';
  for (let i = 0; i < signatureArray.length; i++) {
    binary += String.fromCharCode(signatureArray[i]);
  }
  const base64Signature = btoa(binary)
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
    const { title, content, status, tags, featured, excerpt, ghostUrl } = await req.json();

    console.log('📝 Publishing to Ghost:', { title, status: status || 'draft', isUpdate: !!ghostUrl });

    const ghostApiKey = Deno.env.get('GHOST_ADMIN_API_KEY');
    const ghostApiUrl = Deno.env.get('GHOST_API_URL');

    if (!ghostApiKey || !ghostApiUrl) {
      throw new Error('Ghost credentials not configured');
    }

    // Parse story content to extract subhead and main content
    console.log('📄 Raw content received:', content);
    
    const lines = content.split('\n');
    let subhead = '';
    let byline = '';
    let mainContent = '';
    let inMainContent = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('SUBHEAD:')) {
        subhead = line.replace('SUBHEAD:', '').trim();
        console.log('✅ Found subhead:', subhead);
      } else if (line.startsWith('BYLINE:')) {
        byline = line.replace('BYLINE:', '').trim();
        inMainContent = true;
        console.log('✅ Found byline:', byline);
        continue;
      } else if (line.startsWith('SOURCE:')) {
        console.log('🛑 Hit SOURCE marker, stopping content extraction');
        break;
      } else if (inMainContent && line.trim()) {
        mainContent += line + '\n';
      }
    }

    console.log('📝 Extracted content:', { 
      subheadLength: subhead.length, 
      bylineLength: byline.length, 
      mainContentLength: mainContent.length,
      mainContentPreview: mainContent.substring(0, 200)
    });

    // Format content as HTML with proper paragraph tags
    const paragraphs = mainContent
      .split('\n')
      .filter(p => p.trim())
      .map(p => `<p>${p}</p>`)
      .join('\n');

    // Build the final HTML with subhead and byline
    let htmlContent = '';
    if (subhead) {
      htmlContent += `<p><strong>${subhead}</strong></p>\n`;
    }
    if (byline) {
      htmlContent += `<p><em>${byline}</em></p>\n`;
    }
    htmlContent += paragraphs;

    // Generate JWT token
    const token = await generateGhostToken(ghostApiKey);

    // Extract post ID from ghostUrl if updating
    let postId = null;
    let updatedAt = null;
    let method = 'POST';
    let endpoint = `${ghostApiUrl}/ghost/api/admin/posts/`;
    
    if (ghostUrl) {
      // Extract slug from URL (last part of path before query/hash)
      const urlParts = ghostUrl.split('/').filter((p: string) => p);
      const slug = urlParts[urlParts.length - 1].split('?')[0].split('#')[0];
      
      // Get the post by slug to find its ID and updated_at timestamp
      const getResponse = await fetch(`${ghostApiUrl}/ghost/api/admin/posts/slug/${slug}/`, {
        method: 'GET',
        headers: {
          'Authorization': `Ghost ${token}`,
          'Content-Type': 'application/json',
          'Accept-Version': 'v5.0',
        },
      });
      
      if (getResponse.ok) {
        const getResult = await getResponse.json();
        const existingPost = getResult.posts[0];
        postId = existingPost?.id;
        updatedAt = existingPost?.updated_at;
        if (postId && updatedAt) {
          method = 'PUT';
          endpoint = `${ghostApiUrl}/ghost/api/admin/posts/${postId}/`;
          console.log('🔄 Updating existing post:', postId, 'updated_at:', updatedAt);
        }
      } else {
        console.warn('⚠️ Could not find existing post, will create new one');
      }
    }

    // Prepare post data
    const postData = {
      posts: [{
        title,
        html: htmlContent,
        status: status || 'draft',
        tags: tags || [],
        featured: featured || false,
        custom_excerpt: excerpt || subhead || null,
        // Include updated_at for PUT requests (required by Ghost API)
        ...(method === 'PUT' && updatedAt ? { updated_at: updatedAt } : {})
      }]
    };

    console.log('🔑 Making request to Ghost API');

    // Add source=html parameter for POST requests to tell Ghost we're sending HTML
    const urlWithSource = method === 'POST' ? `${endpoint}?source=html` : endpoint;

    // Make request to Ghost API (POST for create, PUT for update)
    const response = await fetch(urlWithSource, {
      method,
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

    console.log(method === 'PUT' ? '✅ Post updated successfully:' : '✅ Post published successfully:', post.id);

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
