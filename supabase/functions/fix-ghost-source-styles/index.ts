import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function base64UrlEncode(str: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function generateGhostToken(apiKey: string): Promise<string> {
  const [id, secret] = apiKey.split(':');
  const header = { alg: 'HS256', typ: 'JWT', kid: id };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, exp: now + 5 * 60, aud: '/admin/' };
  const base64Header = base64UrlEncode(JSON.stringify(header));
  const base64Payload = base64UrlEncode(JSON.stringify(payload));
  const message = `${base64Header}.${base64Payload}`;
  const encoder = new TextEncoder();
  const secretBytes = new Uint8Array(secret.match(/.{1,2}/g)?.map((b: string) => parseInt(b, 16)) || []);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const sigArray = new Uint8Array(signature);
  let binary = '';
  for (let i = 0; i < sigArray.length; i++) binary += String.fromCharCode(sigArray[i]);
  const base64Sig = btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${message}.${base64Sig}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ghostApiKey = Deno.env.get('GHOST_ADMIN_API_KEY')!;
    let ghostApiUrl = Deno.env.get('GHOST_API_URL')!.trim().replace(/\/$/, '');
    if (!ghostApiUrl.startsWith('http')) ghostApiUrl = `https://${ghostApiUrl}`;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Fetch all published stories with a ghost_url and SOURCE line
    const { data: stories, error } = await supabase
      .from('stories')
      .select('id, title, ghost_url')
      .not('ghost_url', 'is', null)
      .ilike('content', '%SOURCE:%')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`Found ${stories.length} stories to patch`);

    const results = { patched: 0, skipped: 0, errors: [] as string[], debugHtml: '' };

    for (const story of stories) {
      try {
        const token = await generateGhostToken(ghostApiKey);

        // Extract slug from ghost_url
        const urlParts = story.ghost_url.split('/').filter((p: string) => p);
        const slug = urlParts[urlParts.length - 1].split('?')[0].split('#')[0];

        // Fetch current post with rendered HTML
        const getRes = await fetch(`${ghostApiUrl}/ghost/api/admin/posts/slug/${slug}/?formats=html,lexical`, {
          headers: {
            'Authorization': `Ghost ${token}`,
            'Content-Type': 'application/json',
            'Accept-Version': 'v5.0',
          },
        });

        if (!getRes.ok) {
          console.error(`❌ Failed to fetch post ${slug}: ${getRes.status}`);
          results.errors.push(`${story.title}: fetch failed ${getRes.status}`);
          continue;
        }

        const postData = await getRes.json();
        const post = postData.posts[0];
        const html: string = post.html || '';

        // Debug: always capture the FIRST story processed
        if (!results.debugHtml) {
          results.debugHtml = JSON.stringify({
            title: story.title,
            htmlLen: html.length,
            htmlTail: html.slice(-800),
            hasSourceTag: html.includes('<p><em>Source:'),
            hasHr: html.includes('<hr>'),
            hasSource: html.toLowerCase().includes('source:'),
          });
        }

        // Check if already fixed
        if (html.includes('style="color: #555')) {
          console.log(`⏭️ Already fixed: ${story.title}`);
          results.skipped++;
          continue;
        }

        // Check if source attribution exists (without the style)
        if (!html.includes('<p><em>Source:')) {
          console.log(`⏭️ No source attribution found: ${story.title}`);
          results.skipped++;
          continue;
        }

        // Patch: replace <p><em>Source: with styled version
        const patchedHtml = html.replace(
          /<p><em>Source:/g,
          '<p style="color: #555; font-size: 0.9em;"><em>Source:'
        );

        // Refresh token for the PUT
        const putToken = await generateGhostToken(ghostApiKey);

        const putRes = await fetch(`${ghostApiUrl}/ghost/api/admin/posts/${post.id}/?source=html`, {
          method: 'PUT',
          headers: {
            'Authorization': `Ghost ${putToken}`,
            'Content-Type': 'application/json',
            'Accept-Version': 'v5.0',
          },
          body: JSON.stringify({
            posts: [{
              html: patchedHtml,
              updated_at: post.updated_at,
            }]
          }),
        });

        if (!putRes.ok) {
          const err = await putRes.text();
          console.error(`❌ Failed to update post ${slug}: ${err}`);
          results.errors.push(`${story.title}: update failed ${putRes.status}`);
          continue;
        }

        console.log(`✅ Patched: ${story.title}`);
        results.patched++;

        // Small delay to avoid hammering Ghost API
        await new Promise(r => setTimeout(r, 200));

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`❌ Error on "${story.title}":`, msg);
        results.errors.push(`${story.title}: ${msg}`);
      }
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Fatal error:', error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
