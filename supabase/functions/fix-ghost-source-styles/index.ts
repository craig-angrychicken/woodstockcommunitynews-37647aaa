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

/** Build the kg-card HTML block from a raw source line (same logic as publish-to-ghost) */
function buildSourceCard(sourceLine: string): string {
  const mdLinkMatch = sourceLine.match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (mdLinkMatch) {
    const displayName = mdLinkMatch[1];
    const url = mdLinkMatch[2];
    return `<!--kg-card-begin: html-->\n<hr>\n<p><em>Source: <a href="${url}">${displayName}</a></em></p>\n<!--kg-card-end: html-->`;
  }
  return `<!--kg-card-begin: html-->\n<hr>\n<p><em>Source: ${sourceLine}</em></p>\n<!--kg-card-end: html-->`;
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

    // Fetch all published stories with a ghost_url and a SOURCE line in content
    const { data: stories, error } = await supabase
      .from('stories')
      .select('id, title, content, ghost_url')
      .not('ghost_url', 'is', null)
      .ilike('content', '%SOURCE:%')
      .order('created_at', { ascending: false });

    if (error) throw error;

    console.log(`Found ${stories.length} stories to process`);

    const results = { patched: 0, skipped: 0, errors: [] as string[] };

    for (const story of stories) {
      try {
        // Extract SOURCE line from Supabase content (authoritative source)
        const sourceMatch = story.content?.match(/^SOURCE:\s*(.+)$/im);
        if (!sourceMatch) {
          console.log(`⏭️ No SOURCE line in content: ${story.title}`);
          results.skipped++;
          continue;
        }
        const sourceLine = sourceMatch[1].trim();
        const newSourceCard = buildSourceCard(sourceLine);

        // Extract slug from ghost_url
        const urlParts = story.ghost_url.split('/').filter((p: string) => p);
        const slug = urlParts[urlParts.length - 1].split('?')[0].split('#')[0];

        const token = await generateGhostToken(ghostApiKey);

        // Fetch current post HTML from Ghost
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

        // Skip if already using kg-card format
        if (html.includes('<!--kg-card-begin: html-->')) {
          console.log(`⏭️ Already has kg-card: ${story.title}`);
          results.skipped++;
          continue;
        }

        // Skip if no source attribution at all in the rendered HTML
        if (!html.toLowerCase().includes('source:')) {
          console.log(`⏭️ No source in rendered HTML: ${story.title}`);
          results.skipped++;
          continue;
        }

        // Replace any existing source attribution (with or without inline styles) with kg-card version.
        // Pattern covers both the old inline-style variant and any plain <p><em>Source: variant,
        // each preceded by an optional <hr>.
        let patchedHtml = html.replace(
          /(<hr\s*\/?>\s*)?<p(?:\s[^>]*)?>(<em>)?Source:.*?(<\/em>)?<\/p>/gi,
          newSourceCard
        );

        // If nothing was replaced (pattern didn't match), append the card
        if (patchedHtml === html) {
          patchedHtml = html + '\n' + newSourceCard;
        }

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
