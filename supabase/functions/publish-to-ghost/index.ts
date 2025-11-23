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

// Helper function to decode HTML entities in URLs
function decodeHtmlEntities(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Helper function to fetch and upload hero image to Ghost
async function fetchAndUploadHeroImageToGhost(
  imageUrl: string,
  ghostAdminUrl: string,
  token: string
): Promise<string | null> {
  try {
    console.log(`📸 Fetching image from: ${imageUrl}`);
    
    // Fetch the image with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    const imageResponse = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GhostPublisher/1.0)'
      }
    });
    clearTimeout(timeoutId);
    
    if (!imageResponse.ok) {
      console.error(`❌ Failed to fetch image: ${imageResponse.status}`);
      return null;
    }
    
    // Get the image data
    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    
    // Determine filename from URL or content type
    let filename = 'hero-image';
    const urlParts = imageUrl.split('/');
    const lastPart = urlParts[urlParts.length - 1];
    if (lastPart && lastPart.includes('.')) {
      filename = lastPart.split('?')[0]; // Remove query params
    } else {
      // Infer extension from content type
      const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
      filename = `hero-image.${ext}`;
    }
    
    // Create FormData for Ghost upload
    const formData = new FormData();
    const blob = new Blob([imageBuffer], { type: contentType });
    formData.append('file', blob, filename);
    
    console.log(`⬆️ Uploading image to Ghost: ${filename}`);
    
    // Upload to Ghost
    const uploadUrl = `${ghostAdminUrl}/ghost/api/admin/images/upload/`;
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Ghost ${token}`,
      },
      body: formData,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error(`❌ Ghost upload failed: ${uploadResponse.status}`, errorText);
      return null;
    }
    
    const uploadResult = await uploadResponse.json();
    const ghostImageUrl = uploadResult.images?.[0]?.url;
    
    if (ghostImageUrl) {
      console.log(`✅ Image uploaded successfully: ${ghostImageUrl}`);
      return ghostImageUrl;
    }
    
    console.error('❌ No image URL in upload response');
    return null;
  } catch (error) {
    console.error('❌ Error uploading image to Ghost:', error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { title, content, status, tags, featured, excerpt, ghostUrl, publishedAt, heroImageUrl, artifactId } = await req.json();

    console.log('📝 Publishing to Ghost:', { title, status: status || 'draft', isUpdate: !!ghostUrl, hasHeroImage: !!heroImageUrl, artifactId });

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
      
      // Handle both plain and markdown-formatted markers
      if (line.startsWith('SUBHEAD:') || line.startsWith('**SUBHEAD:**')) {
        subhead = line.replace(/\*\*SUBHEAD:\*\*|SUBHEAD:/, '').trim();
        console.log('✅ Found subhead:', subhead);
      } else if (line.startsWith('BYLINE:') || line.startsWith('**BYLINE:**')) {
        byline = line.replace(/\*\*BYLINE:\*\*|BYLINE:/, '').trim();
        inMainContent = true;
        console.log('✅ Found byline:', byline);
        continue;
      } else if (line.startsWith('SOURCE:') || line.startsWith('**SOURCE:**')) {
        console.log('🛑 Hit SOURCE marker, stopping content extraction');
        break;
      } else if (inMainContent && line.trim()) {
        mainContent += line + '\n';
      }
    }

    // Fallback: if no main content was extracted using markers, use full content minus marker lines
    if (!mainContent.trim()) {
      console.log('ℹ️ No main content extracted via markers, falling back to full content');
      mainContent = content
        .split('\n')
        .filter((line: string) =>
          !line.startsWith('SUBHEAD:') &&
          !line.startsWith('**SUBHEAD:**') &&
          !line.startsWith('BYLINE:') &&
          !line.startsWith('**BYLINE:**') &&
          !line.startsWith('SOURCE:') &&
          !line.startsWith('**SOURCE:**')
        )
        .join('\n')
        .trim();
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

    // Build the final HTML with byline only (subhead goes to custom_excerpt)
    let htmlContent = '';
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

    // Decode HTML entities in hero image URL before sending to Ghost
    const cleanHeroImageUrl = decodeHtmlEntities(heroImageUrl);
    
    // Upload hero image to Ghost if present
    let featureImageUrl = cleanHeroImageUrl;
    if (cleanHeroImageUrl) {
      const uploadedUrl = await fetchAndUploadHeroImageToGhost(
        cleanHeroImageUrl,
        ghostApiUrl,
        token
      );
      if (uploadedUrl) {
        featureImageUrl = uploadedUrl;
        console.log(`🖼️ Using Ghost-hosted image: ${uploadedUrl}`);
      } else {
        console.log(`⚠️ Falling back to original URL: ${cleanHeroImageUrl}`);
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
        published_at: publishedAt,
        feature_image: featureImageUrl,
        // Include updated_at for PUT requests (required by Ghost API)
        ...(method === 'PUT' && updatedAt ? { updated_at: updatedAt } : {})
      }]
    };

    console.log('🔑 Making request to Ghost API');

    // Log HTML content details
    console.log('📦 HTML Content being sent:', {
      htmlLength: htmlContent.length,
      preview: htmlContent.substring(0, 300),
      paragraphCount: (htmlContent.match(/<p>/g) || []).length,
    });
    console.log('📤 Post data payload (truncated):', JSON.stringify(postData).slice(0, 1000));

    // Always send source=html so Ghost treats the payload as HTML (both POST and PUT)
    const urlWithSource = `${endpoint}?source=html`;

    // Make request to Ghost API (POST for create, PUT for update) with basic retry logic
    const maxRetries = 3;
    let response: Response | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        response = await fetch(urlWithSource, {
          method,
          headers: {
            'Authorization': `Ghost ${token}`,
            'Content-Type': 'application/json',
            'Accept-Version': 'v5.0',
          },
          body: JSON.stringify(postData),
        });

        if (response.ok) {
          break;
        }

        const errorText = await response.text();
        console.error(`❌ Ghost API error (attempt ${attempt}/${maxRetries}):`, errorText);

        // Only retry on 503s; for other errors, fail fast
        if (response.status !== 503 || attempt === maxRetries) {
          throw new Error(`Ghost API error: ${response.status} - ${errorText}`);
        }

        const delayMs = 500 * attempt;
        console.log(`⏳ Retrying Ghost API request in ${delayMs}ms due to 503...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        const delayMs = 500 * attempt;
        console.warn(`⚠️ Ghost API request failed on attempt ${attempt}, retrying in ${delayMs}ms...`, err);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!response) {
      throw new Error('Ghost API error: No response received from Ghost after retries');
    }

    const result = await response.json();
    const post = result.posts[0];

    console.log(method === 'PUT' ? '✅ Post updated successfully:' : '✅ Post published successfully:', post.id);

    // Clean up temporary Storage images after successful publish
    if (artifactId) {
      try {
        console.log(`🧹 Cleaning up Storage images for artifact: ${artifactId}`);
        
        // Initialize Supabase client for Storage operations
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        if (supabaseUrl && supabaseKey) {
          const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
          const supabase = createClient(supabaseUrl, supabaseKey);
          
          // List all files in the artifact's folder
          const { data: fileList, error: listError } = await supabase.storage
            .from('artifact-images')
            .list(artifactId);
          
          if (listError) {
            console.error('❌ Error listing files for cleanup:', listError);
          } else if (fileList && fileList.length > 0) {
            // Delete all files in the folder
            const filePaths = fileList.map(f => `${artifactId}/${f.name}`);
            const { error: deleteError } = await supabase.storage
              .from('artifact-images')
              .remove(filePaths);
            
            if (deleteError) {
              console.error('❌ Error deleting files:', deleteError);
            } else {
              console.log(`✅ Deleted ${fileList.length} image(s) from Storage`);
            }
          } else {
            console.log('ℹ️ No files found to clean up');
          }
        }
      } catch (cleanupError) {
        // Don't fail the whole operation if cleanup fails
        console.error('❌ Storage cleanup error:', cleanupError);
      }
    }

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
