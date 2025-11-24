import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// UUID v5 namespace for generating deterministic UUIDs
const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Normalizes any GUID format to a valid UUID string
 * - If already UUID format: returns as-is
 * - If 32-char hex string: formats as UUID (8-4-4-4-12)
 * - Otherwise (URLs, etc.): generates deterministic UUID v5
 */
async function normalizeToUUID(guid: string): Promise<string> {
  // Check if already valid UUID format (8-4-4-4-12 with hyphens)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(guid)) {
    return guid.toLowerCase();
  }

  // Check if 32-character hex string (no hyphens)
  const hexRegex = /^[0-9a-f]{32}$/i;
  if (hexRegex.test(guid)) {
    // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    return `${guid.slice(0, 8)}-${guid.slice(8, 12)}-${guid.slice(12, 16)}-${guid.slice(16, 20)}-${guid.slice(20)}`.toLowerCase();
  }

  // For anything else (URLs, etc.), generate deterministic UUID v5
  const encoder = new TextEncoder();
  const data = encoder.encode(NAMESPACE_UUID + guid);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Format as UUID v5: set version (5) and variant bits
  const uuid = [
    hashHex.slice(0, 8),
    hashHex.slice(8, 12),
    '5' + hashHex.slice(13, 16), // Version 5
    ((parseInt(hashHex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hashHex.slice(18, 20), // Variant bits
    hashHex.slice(20, 32)
  ].join('-');
  
  return uuid;
}

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

        // Fetch the RSS feed with retry logic
        let response;
        let lastError;
        const maxRetries = 3;
        const retryDelays = [2000, 4000, 8000]; // Exponential backoff
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            console.log(`   Attempt ${attempt + 1}/${maxRetries}...`);
            response = await fetch(source.url);
            
            if (response.ok) {
              break; // Success!
            }
            
            // Log HTTP error details
            const statusText = response.statusText;
            const responseBody = await response.text().catch(() => 'Unable to read response body');
            lastError = new Error(`HTTP ${response.status}: ${statusText}\nResponse: ${responseBody.substring(0, 500)}`);
            console.error(`   ❌ Attempt ${attempt + 1} failed:`, lastError.message);
            
            // Don't retry on client errors (400-499), only server errors (500+) and network issues
            if (response.status < 500) {
              console.log(`   🚫 Not retrying client error ${response.status}`);
              throw lastError;
            }
            
            if (attempt < maxRetries - 1) {
              const delay = retryDelays[attempt];
              console.log(`   ⏳ Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } catch (fetchError: any) {
            lastError = fetchError;
            console.error(`   ❌ Attempt ${attempt + 1} failed:`, fetchError.message);
            
            if (attempt < maxRetries - 1) {
              const delay = retryDelays[attempt];
              console.log(`   ⏳ Waiting ${delay}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }
        
        if (!response || !response.ok) {
          throw lastError || new Error('Failed to fetch RSS feed after retries');
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
            const rawGuid = item.id || item.guid || link;
            const guid = await normalizeToUUID(rawGuid);
            const dateStr = item[dateField] || item.pubDate || item.published;
            const pubDate = parseDate(dateStr) || new Date();

            // Extract ALL images using configured fields
            const allImages = extractAllImages(item, parserConfig);
            
            // Generate artifact GUID for storage path
            const artifactGuid = crypto.randomUUID();
            
            // Download and upload images to Supabase Storage
            const storageImages: string[] = [];
            for (let i = 0; i < allImages.length; i++) {
              const imageUrl = allImages[i];
              try {
                console.log(`📥 Downloading image ${i + 1}/${allImages.length}: ${imageUrl}`);
                
                // Fetch the image
                const imgController = new AbortController();
                const imgTimeoutId = setTimeout(() => imgController.abort(), 10000);
                const imgResponse = await fetch(imageUrl, {
                  signal: imgController.signal,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; ArtifactFetcher/1.0)'
                  }
                });
                clearTimeout(imgTimeoutId);
                
                if (!imgResponse.ok) {
                  console.error(`❌ Failed to fetch image (${imgResponse.status}): ${imageUrl}`);
                  continue;
                }
                
                // Get image data and content type
                const imageBuffer = await imgResponse.arrayBuffer();
                const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
                const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
                
                // Upload to Storage
                const storagePath = `${artifactGuid}/image-${i}.${ext}`;
                console.log(`⬆️ Uploading to Storage: ${storagePath}`);
                
                const { error: uploadError } = await supabase.storage
                  .from('artifact-images')
                  .upload(storagePath, imageBuffer, {
                    contentType,
                    upsert: false
                  });
                
                if (uploadError) {
                  console.error(`❌ Storage upload error:`, uploadError);
                  continue;
                }
                
                // Get public URL
                const { data: urlData } = supabase.storage
                  .from('artifact-images')
                  .getPublicUrl(storagePath);
                
                if (urlData?.publicUrl) {
                  storageImages.push(urlData.publicUrl);
                  console.log(`✅ Stored image ${i + 1}: ${urlData.publicUrl}`);
                }
              } catch (error) {
                console.error(`❌ Error processing image ${i + 1}:`, error);
              }
            }
            
            const heroImage = storageImages[0] || null;
            console.log(`📸 Successfully stored ${storageImages.length}/${allImages.length} images`);

            // Get content using configured field
            let content = item[contentField] || item['content:encoded'] || item.content || item.description || item.summary || '';
            
            // Extract selectors from parser config if available
            const selectors = parserConfig?.scrapeConfig?.elements?.map((e: any) => e.selector) || [];
            const shouldFetch = link && (selectors.length > 0 || content.length < 1000);
            
            // If we have selectors or content is short, try to fetch full article
            if (shouldFetch) {
              try {
                console.log(`   📄 Fetching full article from ${link}`);
                
                const articleHtml = await fetchArticleHTML(link);
                if (articleHtml) {
                  const extractedContent = extractContentFromHTML(articleHtml);
                  console.log(`   ✅ Extraction: ${extractedContent.length} characters`);
                  
                  // Replace content if extracted version is better
                  if (extractedContent && extractedContent.length > content.length) {
                    console.log(`   ✅ Replaced ${content.length} chars with ${extractedContent.length} chars`);
                    content = extractedContent;
                  }
                }
              } catch (fetchError) {
                const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown error';
                console.log(`   ⚠️ Could not fetch article: ${errorMsg}`);
              }
            }

            content = cleanText(content);

            // Insert into artifacts table with Storage-hosted images
            const { error: insertError } = await supabase
              .from('artifacts')
              .insert({
                id: artifactGuid,
                name: title,
                title: title,
                url: link,
                guid: guid,
                content: content,
                hero_image_url: heroImage,
                images: storageImages,
                date: pubDate.toISOString(),
                type: 'RSS Article',
                source_id: source.id,
                is_test: environment === 'test',
              });

            if (insertError) {
              // Check if it's a duplicate GUID error
              if (insertError.code === '23505' && insertError.message.includes('artifacts_guid_key')) {
                console.log(`   ⚠️ Skipping duplicate artifact (GUID already exists): ${title}`);
              } else {
                console.error('❌ Insert error:', insertError);
                totalErrors++;
              }
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

        // Log summary for this source
        if (itemsProcessed === 0 && filteredItems.length > 0) {
          console.log(`   ⚠️ No new artifacts created - all ${filteredItems.length} items already exist (duplicate GUIDs)`);
        } else {
          console.log(`   ✅ Created ${itemsProcessed} new artifacts from ${filteredItems.length} items in range`);
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
 * Fetch HTML content from a URL with retry logic
 */
async function fetchArticleHTML(url: string, retries = 2): Promise<string> {
  console.log(`📄 Fetching content: ${url}`);
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      console.log(`✅ Fetched ${html.length} characters`);
      return html;
    } catch (error) {
      if (attempt < retries) {
        console.log(`   ⚠️ Attempt ${attempt + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
      } else {
        throw error;
      }
    }
  }
  
  throw new Error('Max retries reached');
}

/**
 * Extract readable content from HTML using multiple strategies
 */
function extractContentFromHTML(html: string): string {
  console.log(`   🔍 Attempting content extraction...`);
  
  // Remove scripts, styles, comments
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  
  // Strategy 1: Try semantic HTML5 tags and common content selectors
  const strategies = [
    { name: 'article tag', regex: /<article[^>]*>([\s\S]*?)<\/article>/i },
    { name: 'main tag', regex: /<main[^>]*>([\s\S]*?)<\/main>/i },
    { name: 'role=main', regex: /<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/i },
    { name: 'id=content', regex: /<div[^>]*id=["'][^"']*(?:content|article|main|post-content|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i },
    { name: 'class=content', regex: /<div[^>]*class=["'][^"']*(?:post-content|article-body|entry-content|content-body|article-content|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i },
  ];
  
  for (const strategy of strategies) {
    const match = cleaned.match(strategy.regex);
    if (match && match[1]) {
      const extracted = processContent(match[1]);
      if (extracted.length > 200) {
        console.log(`   ✅ Strategy "${strategy.name}": ${extracted.length} chars`);
        return extracted;
      }
    }
  }
  
  // Strategy 2: Extract all paragraphs as fallback
  console.log(`   🔄 Using paragraph extraction fallback`);
  const paragraphs = cleaned.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const allText = paragraphs
    .map(p => p.replace(/<[^>]+>/g, '').trim())
    .filter(text => text.length > 20)
    .join('\n\n');
  
  if (allText.length > 200) {
    console.log(`   ✅ Paragraph extraction: ${allText.length} chars`);
    return cleanText(allText);
  }
  
  console.log(`   ⚠️ All extraction strategies failed`);
  return '';
}

/**
 * Process HTML content into readable text
 */
function processContent(html: string): string {
  // Remove navigation, headers, footers, asides
  let content = html
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');
  
  // Convert to markdown-style text
  content = content
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '');
  
  // Remove all remaining HTML tags
  content = content.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  content = content
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
  
  // Clean up excessive whitespace but preserve paragraph breaks
  content = content.replace(/[ \t]+/g, ' ');
  content = content.replace(/\n\s*\n\s*\n/g, '\n\n');
  content = content.trim();
  
  // Limit to reasonable length
  if (content.length > 15000) {
    content = content.substring(0, 15000) + '...';
  }
  
  return content;
}

