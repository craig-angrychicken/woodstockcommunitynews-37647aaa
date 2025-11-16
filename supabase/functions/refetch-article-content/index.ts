import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getContentWithBrowserless } from '../_shared/browserless-service.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { artifactId } = await req.json();

    if (!artifactId) {
      return new Response(
        JSON.stringify({ success: false, error: 'artifactId is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔄 Refetching content for artifact: ${artifactId}`);

    // Get artifact and source info
    const { data: artifact, error: artifactError } = await supabase
      .from('artifacts')
      .select('id, source_id, url, content, hero_image_url, images')
      .eq('id', artifactId)
      .single();

    if (artifactError || !artifact) {
      throw new Error('Artifact not found');
    }

    if (!artifact.url) {
      return new Response(
        JSON.stringify({ success: false, error: 'Artifact has no URL to fetch from' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('parser_config')
      .eq('id', artifact.source_id)
      .single();

    if (sourceError) {
      console.warn('Could not load source config, will use generic extraction');
    }

    const parserConfig = source?.parser_config;
    const selectors = parserConfig?.scrapeConfig?.elements?.map((e: any) => e.selector) || [];

    console.log(`📄 Fetching full article from ${artifact.url}`);
    console.log(`🎯 Using ${selectors.length} configured selectors`);

    let extractedContent = '';
    let newImages: string[] = [];

    try {
      // Try selector-based extraction first if we have selectors
      if (selectors.length > 0) {
        console.log(`   🎯 Attempting selector-based extraction`);
        extractedContent = await extractContentWithSelectors(artifact.url, selectors);
        console.log(`   ✅ Selector extraction: ${extractedContent.length} characters`);
      }

      // Fallback to generic extraction if no selectors or extraction failed
      if (!extractedContent || extractedContent.length < 200) {
        console.log(`   🔄 Falling back to generic extraction`);
        const articleHtml = await fetchArticleHTML(artifact.url);
        if (articleHtml) {
          extractedContent = extractContentFromHTML(articleHtml);
          console.log(`   ✅ Generic extraction: ${extractedContent.length} characters`);
          
          // Try to extract images from HTML
          const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
          const matches = articleHtml.matchAll(imgRegex);
          for (const match of matches) {
            try {
              new URL(match[1]); // Validate URL
              newImages.push(match[1]);
            } catch {
              // Skip invalid URLs
            }
          }
        }
      }
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
      console.error(`   ❌ Fetch failed: ${errorMsg}`);
      throw fetchError;
    }

    // Check if we got better content
    const originalLength = artifact.content?.length || 0;
    const newLength = extractedContent.length;

    if (newLength > originalLength && newLength > 100) {
      console.log(`✅ Updating artifact with ${newLength} characters (was ${originalLength})`);

      const updateData: any = {
        content: extractedContent,
      };

      // Update images if we found new ones
      if (newImages.length > 0) {
        updateData.images = newImages;
        updateData.hero_image_url = newImages[0];
        console.log(`📸 Also updating ${newImages.length} images`);
      }

      const { error: updateError } = await supabase
        .from('artifacts')
        .update(updateData)
        .eq('id', artifactId);

      if (updateError) {
        throw updateError;
      }

      return new Response(
        JSON.stringify({
          success: true,
          replaced: true,
          originalLength,
          newLength,
          newContent: extractedContent,
          imagesUpdated: newImages.length > 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      console.log(`⚠️ Extracted content (${newLength} chars) not better than original (${originalLength} chars)`);
      return new Response(
        JSON.stringify({
          success: true,
          replaced: false,
          originalLength,
          newLength,
          message: 'Extracted content was not longer than existing content',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('❌ Error refetching content:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

/**
 * Extract content using configured selectors
 */
async function extractContentWithSelectors(url: string, selectors: string[]): Promise<string> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY not configured');
  }

  const elements = selectors.map(selector => ({ selector }));

  const response = await fetch(
    `${BROWSERLESS_URL}/scrape?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        elements,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000,
        },
        waitForTimeout: 5000,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless scrape error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  const data = result.data || [];

  // Find the longest text block from all selectors
  let longestText = '';
  for (const selectorResult of data) {
    if (selectorResult.results && Array.isArray(selectorResult.results)) {
      for (const item of selectorResult.results) {
        const text = item.text || '';
        if (text.length > longestText.length) {
          longestText = text;
        }
      }
    }
  }

  // Clean and normalize the text
  let content = longestText
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–');

  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  content = content.trim();

  return content;
}

/**
 * Fetch HTML content from a URL
 */
async function fetchArticleHTML(url: string): Promise<string> {
  try {
    console.log(`   🌐 Fetching with Browserless: ${url}`);
    return await getContentWithBrowserless(url);
  } catch (error) {
    console.log(`   ⚠️ Browserless fetch failed, falling back to basic fetch: ${error}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSBot/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  }
}

/**
 * Extract readable content from HTML
 */
function extractContentFromHTML(html: string): string {
  let content = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  content = content.replace(/<!--[\s\S]*?-->/g, '');

  const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentMatch = content.match(/<div[^>]*class="[^"]*(?:content|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (articleMatch) {
    content = articleMatch[1];
  } else if (mainMatch) {
    content = mainMatch[1];
  } else if (contentMatch) {
    content = contentMatch[1];
  }

  content = content.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
  content = content.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
  content = content.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');

  content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n\n');
  content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n\n');
  content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n\n');

  content = content.replace(/<\/p>/gi, '\n\n');
  content = content.replace(/<p[^>]*>/gi, '');
  content = content.replace(/<br\s*\/?>/gi, '\n');
  content = content.replace(/<li[^>]*>/gi, '\n• ');
  content = content.replace(/<\/li>/gi, '');
  content = content.replace(/<[^>]+>/g, '');

  content = content.replace(/&nbsp;/g, ' ');
  content = content.replace(/&amp;/g, '&');
  content = content.replace(/&lt;/g, '<');
  content = content.replace(/&gt;/g, '>');
  content = content.replace(/&quot;/g, '"');
  content = content.replace(/&#39;/g, "'");
  content = content.replace(/&apos;/g, "'");
  content = content.replace(/&rsquo;/g, "'");
  content = content.replace(/&ldquo;/g, '"');
  content = content.replace(/&rdquo;/g, '"');
  content = content.replace(/&mdash;/g, '—');
  content = content.replace(/&ndash;/g, '–');

  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  content = content.trim();

  if (content.length > 15000) {
    content = content.substring(0, 15000) + '...';
  }

  return content;
}
