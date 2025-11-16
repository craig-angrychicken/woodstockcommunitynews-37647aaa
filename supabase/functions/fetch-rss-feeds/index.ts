import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getContentWithBrowserless } from '../_shared/browserless-service.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RSSItem {
  title: string;
  link: string;
  id?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  content?: string;
  summary?: string;
  'content:encoded'?: string;
  'media:content'?: { url?: string };
  'media:thumbnail'?: { url?: string };
  'media:group'?: { urls?: string[] };
  enclosure?: { url?: string };
  image?: { url?: string };
  guid?: string;
  [key: string]: any;
}

interface RSSFeed {
  items?: RSSItem[];
  entry?: RSSItem[]; // Atom feeds use 'entry' instead of 'items'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { dateFrom, dateTo, sourceIds, environment, queryHistoryId } = await req.json();

    console.log('\n🚀 Starting RSS feed fetch');
    console.log('📊 Sources:', sourceIds.length);
    console.log('📅 Date range:', dateFrom, 'to', dateTo);
    console.log('🎯 Environment:', environment);

    // Fetch RSS sources
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', sourceIds)
      .eq('type', 'RSS Feed');

    if (sourcesError) throw sourcesError;
    if (!sources || sources.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No RSS feed sources found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`✅ Loaded ${sources.length} RSS feed sources`);

    // Update query history with total sources
    if (queryHistoryId) {
      await supabase
        .from('query_history')
        .update({
          sources_total: sources.length,
        })
        .eq('id', queryHistoryId);
    }

    const dateFromTime = new Date(dateFrom).getTime();
    const dateToTime = new Date(dateTo).getTime();
    let totalArtifacts = 0;
    let totalErrors = 0;

    for (const source of sources) {
      try {
        // Update query history with current source
        if (queryHistoryId) {
          await supabase
            .from('query_history')
            .update({
              current_source_id: source.id,
              current_source_name: source.name,
            })
            .eq('id', queryHistoryId);
        }

        console.log(`\n📡 Fetching RSS feed: ${source.name}`);
        console.log(`   URL: ${source.url}`);
        
        // Get parser config for dynamic field mapping
        const parserConfig = source.parser_config;
        console.log(`🔧 Using parser config:`, parserConfig ? 'Custom' : 'Default');

        // Fetch the RSS feed
        const response = await fetch(source.url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const xmlText = await response.text();
        console.log(`✅ Retrieved ${xmlText.length} characters`);

        // Parse RSS/Atom feed (simple XML parsing)
        const feed = parseRSSFeed(xmlText);
        const items = feed.items || feed.entry || [];

        console.log(`📦 Found ${items.length} items in feed`);

        // Filter by date range
        console.log(`📅 Filtering items by date range...`);
        console.log(`   From: ${new Date(dateFromTime).toISOString()}`);
        console.log(`   To: ${new Date(dateToTime).toISOString()}`);
        
        const filteredItems = items.filter((item, idx) => {
          const dateStr = item.pubDate || item.published;
          console.log(`   Item ${idx + 1}: pubDate="${dateStr}"`);
          
          const itemDate = parseDate(dateStr);
          if (!itemDate) {
            console.log(`     ❌ Date parse failed`);
            return false;
          }
          
          console.log(`     ✓ Parsed as: ${itemDate.toISOString()}`);
          const itemTime = itemDate.getTime();
          const inRange = itemTime >= dateFromTime && itemTime <= dateToTime;
          console.log(`     ${inRange ? '✅' : '❌'} In range: ${inRange}`);
          return inRange;
        });

        console.log(`✅ ${filteredItems.length} items in date range`);

        // Process each item
        let itemsProcessed = 0;
        for (const item of filteredItems) {
          try {
            // Extract data using dynamic field mappings
            const titleField = parserConfig?.fieldMappings?.titleField || 'title';
            const linkField = parserConfig?.fieldMappings?.linkField || 'link';
            const dateField = parserConfig?.fieldMappings?.dateField || 'pubDate';
            const contentField = parserConfig?.fieldMappings?.contentField || 'description';
            
            const title = item[titleField] || 'Untitled';
            const link = item[linkField] || '';
            const guid = item.id || item.guid || link;
            const dateStr = item[dateField] || item.pubDate || item.published;
            const pubDate = parseDate(dateStr) || new Date();

            // Extract ALL images using configured fields
            const allImages = extractAllImages(item, parserConfig);
            const heroImage = allImages[0] || null;

            // Get content using configured field
            let content = item[contentField] || item['content:encoded'] || item.content || item.description || item.summary || '';
            
            // If content is short and we have a link, try to fetch full article
            if (content.length < 500 && link) {
              try {
                console.log(`   📄 Fetching full article from ${link}`);
                const articleHtml = await fetchArticleHTML(link);
                if (articleHtml) {
                  const extractedContent = extractContentFromHTML(articleHtml);
                  if (extractedContent && extractedContent.length > content.length) {
                    content = extractedContent;
                    console.log(`   ✅ Extracted ${content.length} characters from article`);
                  }
                }
              } catch (fetchError) {
                const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
                console.log(`   ⚠️ Could not fetch article: ${errorMsg}`);
              }
            }

            content = cleanText(content);

            // Insert into artifacts table with ALL images
            const { error: insertError } = await supabase
              .from('artifacts')
              .insert({
                name: title,
                title: title,
                url: link,
                content: content,
                hero_image_url: heroImage,
                images: allImages,
                date: pubDate.toISOString(),
                type: 'RSS Article',
                source_id: source.id,
                is_test: environment === 'test',
              });

            if (insertError) {
              console.error('❌ Insert error:', insertError);
              totalErrors++;
            } else {
              console.log(`✅ Inserted: ${title}`);
              totalArtifacts++;
              itemsProcessed++;
            }
          } catch (itemError) {
            console.error(`❌ Error processing item:`, itemError);
            totalErrors++;
          }
        }

        // Update source last_fetch_at
        await supabase
          .from('sources')
          .update({
            last_fetch_at: new Date().toISOString(),
            items_fetched: (source.items_fetched || 0) + filteredItems.length
          })
          .eq('id', source.id);

        // Update query history with progress
        if (queryHistoryId) {
          const currentProcessed = sources.indexOf(source) + 1;
          await supabase
            .from('query_history')
            .update({
              sources_processed: currentProcessed,
              artifacts_count: totalArtifacts,
            })
            .eq('id', queryHistoryId);
        }

      } catch (error) {
        console.error(`❌ Error processing ${source.name}:`, error);
        totalErrors++;
        
        // Update query history with failed count
        if (queryHistoryId) {
          const { data: currentHistory } = await supabase
            .from('query_history')
            .select('sources_failed')
            .eq('id', queryHistoryId)
            .single();
          
          await supabase
            .from('query_history')
            .update({
              sources_failed: (currentHistory?.sources_failed || 0) + 1,
            })
            .eq('id', queryHistoryId);
        }
      }
    }

    console.log('\n✅ RSS fetch complete!');
    console.log(`  Artifacts created: ${totalArtifacts}`);
    console.log(`  Errors: ${totalErrors}`);

    // Update query history with final status
    if (queryHistoryId) {
      await supabase
        .from('query_history')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          artifacts_count: totalArtifacts,
          sources_processed: sources.length,
          current_source_id: null,
          current_source_name: null,
        })
        .eq('id', queryHistoryId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCreated: totalArtifacts,
        errors: totalErrors,
        sourcesProcessed: sources.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Fatal error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Try to update query history with error status
    try {
      const body = await req.clone().json().catch(() => ({}));
      const queryHistoryId = body.queryHistoryId;
      
      if (queryHistoryId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        await supabase
          .from('query_history')
          .update({
            status: 'failed',
            error_message: message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', queryHistoryId);
      }
    } catch (updateError) {
      console.error('Failed to update query history:', updateError);
    }
    
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Simple RSS/Atom parser
function parseRSSFeed(xmlText: string): RSSFeed {
  const items: RSSItem[] = [];
  
  // Match both RSS <item> and Atom <entry> tags
  const itemRegex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  const matches = xmlText.matchAll(itemRegex);

  for (const match of matches) {
    const itemXml = match[1];
    
    items.push({
      title: extractTag(itemXml, 'title'),
      link: extractTag(itemXml, 'link') || extractAttr(itemXml, 'link', 'href'),
      id: extractTag(itemXml, 'id'),
      pubDate: extractTag(itemXml, 'pubDate'),
      published: extractTag(itemXml, 'published'),
      updated: extractTag(itemXml, 'updated'),
      description: extractTag(itemXml, 'description'),
      content: extractTag(itemXml, 'content'),
      summary: extractTag(itemXml, 'summary'),
      enclosure: { url: extractAttr(itemXml, 'enclosure', 'url') },
      'media:content': { url: extractAttr(itemXml, 'media:content', 'url') }
    });
  }

  return { items };
}

function extractTag(xml: string, tagName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  if (!match) return '';
  
  let content = match[1].trim();
  
  // Remove CDATA wrapper if present
  if (content.startsWith('<![CDATA[') && content.endsWith(']]>')) {
    content = content.slice(9, -3); // Remove <![CDATA[ and ]]>
  }
  
  return content;
}

function extractAttr(xml: string, tagName: string, attrName: string): string {
  const regex = new RegExp(`<${tagName}[^>]*${attrName}=["']([^"']+)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  try {
    return new Date(dateStr);
  } catch {
    return null;
  }
}

function extractAllImages(item: RSSItem, config?: any): string[] {
  const images: string[] = [];
  
  // Get image fields from config or use defaults
  const imageFields = config?.fieldMappings?.imageFields || [
    'enclosure.url',
    'media:content.url',
    'media:thumbnail.url',
    'image.url'
  ];
  
  // Extract images from configured fields
  for (const field of imageFields) {
    const parts = field.split('.');
    let value: any = item;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    if (typeof value === 'string' && value) {
      images.push(value);
    } else if (Array.isArray(value)) {
      images.push(...value.filter(v => typeof v === 'string'));
    }
  }
  
  // Handle media:group special case
  if (item['media:group']?.urls && Array.isArray(item['media:group'].urls)) {
    images.push(...item['media:group'].urls);
  }
  
  // Encode and validate all URLs
  const validImages: string[] = [];
  for (const rawUrl of images) {
    try {
      const url = new URL(rawUrl);
      const encodedUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
      validImages.push(encodedUrl);
    } catch (error) {
      console.error(`❌ Invalid image URL: ${rawUrl}`, error);
    }
  }
  
  // Remove duplicates and return
  const uniqueImages = [...new Set(validImages)];
  console.log(`📸 Extracted ${uniqueImages.length} image(s)`);
  return uniqueImages;
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Fetch HTML content from a URL using Browserless for better rendering
 */
async function fetchArticleHTML(url: string): Promise<string> {
  try {
    // Use Browserless to properly render JavaScript-heavy sites
    console.log(`   🌐 Fetching with Browserless: ${url}`);
    return await getContentWithBrowserless(url);
  } catch (error) {
    console.log(`   ⚠️ Browserless fetch failed, falling back to basic fetch: ${error}`);
    
    // Fallback to basic fetch if Browserless fails
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
 * Extract readable content from HTML, focusing on main article content
 */
function extractContentFromHTML(html: string): string {
  // Remove script and style tags with their content
  let content = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove HTML comments
  content = content.replace(/<!--[\s\S]*?-->/g, '');
  
  // Try to extract main content area (article, main, or common content containers)
  const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const contentMatch = content.match(/<div[^>]*class="[^"]*(?:content|article|post|entry)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  
  // Use the first match found, or fall back to full HTML
  if (articleMatch) {
    content = articleMatch[1];
  } else if (mainMatch) {
    content = mainMatch[1];
  } else if (contentMatch) {
    content = contentMatch[1];
  }
  
  // Remove common non-content sections
  content = content.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '');
  content = content.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '');
  content = content.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');
  content = content.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
  
  // Convert headers to markdown-style
  content = content.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n\n');
  content = content.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n\n');
  content = content.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n\n');
  
  // Convert paragraphs to double newlines
  content = content.replace(/<\/p>/gi, '\n\n');
  content = content.replace(/<p[^>]*>/gi, '');
  
  // Convert line breaks
  content = content.replace(/<br\s*\/?>/gi, '\n');
  
  // Convert lists
  content = content.replace(/<li[^>]*>/gi, '\n• ');
  content = content.replace(/<\/li>/gi, '');
  
  // Remove all remaining HTML tags
  content = content.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
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
  
  // Clean up excessive whitespace but preserve paragraph breaks
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  content = content.trim();
  
  // Limit to reasonable length (5000 characters)
  if (content.length > 5000) {
    content = content.substring(0, 5000) + '...';
  }
  
  return content;
}
