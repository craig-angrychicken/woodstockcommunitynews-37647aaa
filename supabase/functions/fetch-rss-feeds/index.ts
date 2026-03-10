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

    const dateFromTime = new Date(dateFrom).getTime();
    const dateToTime = new Date(dateTo).getTime();
    let totalArtifacts = 0;
    let totalErrors = 0;

    for (const source of sources) {
      try {
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
            
            // Generate deterministic GUID from source + normalized title (content-based fingerprint)
            const normalizedTitle = title.toLowerCase().trim().replace(/\s+/g, ' ');
            const fingerprint = `${source.id}:${normalizedTitle}`;
            const guid = await normalizeToUUID(fingerprint);
            
            const dateStr = item[dateField] || item.pubDate || item.published;
            const pubDate = parseDate(dateStr) || new Date();

            // Extract ALL images using configured fields
            const allImages = extractAllImages(item, parserConfig);
            
            // Generate artifact GUID for storage path
            const artifactGuid = crypto.randomUUID();
            
            // Download and upload images to Supabase Storage with robust error handling
            const storageImages: { original_url: string; stored_url: string; download_failed?: true }[] = [];
            const problematicDomains = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com'];
            
            for (let i = 0; i < allImages.length; i++) {
              const imageUrl = allImages[i];
              
              // Validate URL format
              try {
                new URL(imageUrl);
              } catch {
                console.warn(`⚠️ Invalid image URL format, skipping: ${imageUrl}`);
                continue;
              }
              
              // Check for known problematic domains
              const isProblematic = problematicDomains.some(domain => imageUrl.includes(domain));
              if (isProblematic) {
                console.warn(`⚠️ Protected social media URL detected, may fail: ${imageUrl}`);
              }
              
              try {
                console.log(`📥 Downloading image ${i + 1}/${allImages.length}: ${imageUrl}`);
                
                // Retry logic with exponential backoff (max 3 attempts)
                let imgResponse: Response | null = null;
                let lastError: Error | null = null;
                
                for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                    const imgController = new AbortController();
                    const imgTimeoutId = setTimeout(() => imgController.abort(), 30000); // 30s timeout
                    
                    imgResponse = await fetch(imageUrl, {
                      signal: imgController.signal,
                      headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                        'Referer': 'https://www.facebook.com/',
                        'Accept-Language': 'en-US,en;q=0.9',
                      }
                    });
                    clearTimeout(imgTimeoutId);
                    
                    if (imgResponse.ok) {
                      break; // Success
                    }
                    
                    // Handle 403 Forbidden (protected URLs) — try weserv.nl proxy first
                    if (imgResponse.status === 403) {
                      console.warn(`🔒 Image returned 403. Attempting weserv.nl proxy for: ${imageUrl}`);

                      let proxied = false;
                      try {
                        const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpg&n=-1`;
                        const proxyController = new AbortController();
                        const proxyTimeoutId = setTimeout(() => proxyController.abort(), 20000);

                        const proxyResponse = await fetch(proxyUrl, { signal: proxyController.signal });
                        clearTimeout(proxyTimeoutId);

                        if (proxyResponse.ok) {
                          const proxyBuffer = await proxyResponse.arrayBuffer();
                          const proxyContentType = proxyResponse.headers.get('content-type') || 'image/jpeg';

                          // Reject weserv.nl error placeholder (~1 KB red PNG)
                          const MIN_VALID_IMAGE_BYTES = 5000;
                          if (!proxyContentType.startsWith('image/') || proxyBuffer.byteLength < MIN_VALID_IMAGE_BYTES) {
                            console.warn(`⚠️ weserv.nl returned suspiciously small response (${proxyBuffer.byteLength} bytes), treating as failure`);
                          } else {
                            const proxyExt = proxyContentType.split('/')[1]?.split(';')[0] || 'jpg';
                            const storagePath = `${artifactGuid}/image-${i}.${proxyExt}`;

                            const { error: proxyUploadError } = await supabase.storage
                              .from('artifact-images')
                              .upload(storagePath, proxyBuffer, { contentType: proxyContentType, upsert: false });

                            if (!proxyUploadError) {
                              const { data: proxyUrlData } = supabase.storage
                                .from('artifact-images')
                                .getPublicUrl(storagePath);

                              if (proxyUrlData?.publicUrl) {
                                storageImages.push({ original_url: imageUrl, stored_url: proxyUrlData.publicUrl });
                                console.log(`✅ Proxied image stored: ${proxyUrlData.publicUrl}`);
                                proxied = true;
                              }
                            } else {
                              console.error(`❌ Proxy image upload failed:`, proxyUploadError);
                            }
                          }
                        } else {
                          console.warn(`⚠️ weserv.nl returned ${proxyResponse.status} for: ${imageUrl}`);
                        }
                      } catch (proxyErr) {
                        console.warn(`⚠️ weserv.nl fetch failed:`, proxyErr instanceof Error ? proxyErr.message : proxyErr);
                      }

                      if (!proxied) {
                        console.warn(`🔒 Proxy also failed, storing as download_failed fallback: ${imageUrl}`);
                        storageImages.push({ original_url: imageUrl, stored_url: imageUrl, download_failed: true });
                      }

                      break; // Don't retry 403s
                    }
                    
                    // Log non-OK responses
                    console.warn(`⚠️ Image fetch returned ${imgResponse.status} on attempt ${attempt}/3`);
                    lastError = new Error(`HTTP ${imgResponse.status}: ${imgResponse.statusText}`);
                    
                  } catch (err) {
                    lastError = err instanceof Error ? err : new Error('Unknown error');
                    console.warn(`⚠️ Image fetch failed on attempt ${attempt}/3:`, lastError.message);
                  }
                  
                  // Exponential backoff before retry (1s, 2s)
                  if (attempt < 3) {
                    const delayMs = 1000 * attempt;
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                  }
                }
                
                // Check if we got a successful response
                if (!imgResponse || !imgResponse.ok) {
                  console.error(`❌ Failed to download image after 3 attempts:`, {
                    url: imageUrl,
                    status: imgResponse?.status,
                    statusText: imgResponse?.statusText,
                    error: lastError?.message
                  });
                  continue;
                }
                
                // Get image data and content type
                const imageBuffer = await imgResponse.arrayBuffer();
                const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
                
                // Validate content type
                if (!contentType.startsWith('image/')) {
                  console.error(`❌ Invalid content type (${contentType}), expected image: ${imageUrl}`);
                  continue;
                }
                
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
                  storageImages.push({ original_url: imageUrl, stored_url: urlData.publicUrl });
                  console.log(`✅ Stored image ${i + 1}: ${urlData.publicUrl}`);
                }
              } catch (error) {
                console.error(`❌ Error processing image ${i + 1}:`, {
                  url: imageUrl,
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
            
            const heroImage = storageImages[0]?.stored_url || null;
            console.log(`📸 Successfully stored ${storageImages.length}/${allImages.length} images`);

            // Get content using configured field
            let content = item[contentField] || item['content:encoded'] || item.content || item.description || item.summary || '';
            
            content = cleanText(content);

            // Upsert into artifacts table with Storage-hosted images (updates if GUID exists)
            const { error: upsertError } = await supabase
              .from('artifacts')
              .upsert({
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
              }, {
                onConflict: 'guid',
                ignoreDuplicates: false
              });

            if (upsertError) {
              console.error('❌ Upsert error:', upsertError);
              totalErrors++;
            } else {
              console.log(`✅ Upserted: ${title}`);
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
              sources_total: sources.length,
              sources_processed: currentProcessed,
              current_source_id: source.id,
              current_source_name: source.name,
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
  // Try to match the tag with CDATA content first (most reliable for RSS)
  const cdataRegex = new RegExp(`<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }
  
  // Fallback to regular tag content
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  if (!match) return '';
  
  let content = match[1].trim();
  
  // Handle case where CDATA might be present but with extra whitespace
  const cdataInnerRegex = /^<!\[CDATA\[([\s\S]*)\]\]>$/;
  const cdataInner = content.match(cdataInnerRegex);
  if (cdataInner) {
    content = cdataInner[1].trim();
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
      console.log(`  🖼️ Found image in ${field}: ${value.substring(0, 80)}...`);
      images.push(value);
    } else if (Array.isArray(value)) {
      images.push(...value.filter(v => typeof v === 'string'));
    }
  }
  
  // Handle media:group special case
  if (item['media:group']?.urls && Array.isArray(item['media:group'].urls)) {
    images.push(...item['media:group'].urls);
  }
  
  // CRITICAL: Extract images from description/content/summary fields
  // FetchRSS and rss.app embed images as markdown or HTML in these fields
  const textFields = [
    item.description,
    item.content,
    item.summary,
    item['content:encoded']
  ].filter(Boolean).join('\n');
  
  if (textFields) {
    console.log(`  📝 Scanning ${textFields.length} chars of text content for images...`);
    
    // Extract markdown images: ![alt](url) or ![](url)
    const markdownImageRegex = /!\[(?:[^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g;
    let match;
    while ((match = markdownImageRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found markdown image: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }
    
    // Extract HTML images: <img src="url" ... > or <img src='url' ...>
    const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    while ((match = htmlImageRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found HTML img tag: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }
    
    // Extract media:content URLs embedded in text (some feeds do this)
    const mediaContentRegex = /<media:content[^>]+url=["']([^"']+)["']/gi;
    while ((match = mediaContentRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found media:content: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }
    
    // Extract enclosure URLs embedded in text
    const enclosureRegex = /<enclosure[^>]+url=["']([^"']+)["']/gi;
    while ((match = enclosureRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found enclosure: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }
  }
  
  // Encode and validate all URLs
  const validImages: string[] = [];
  for (const rawUrl of images) {
    try {
      // Skip tiny/tracking pixels and non-image URLs
      if (rawUrl.includes('pixel') || rawUrl.includes('tracking') || rawUrl.includes('spacer')) {
        console.log(`  ⏭️ Skipping tracking pixel: ${rawUrl.substring(0, 50)}...`);
        continue;
      }
      
      const url = new URL(rawUrl);
      // Ensure the URL looks like an image
      const path = url.pathname.toLowerCase();
      const hasImageExt = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(path);
      const hasImageInUrl = rawUrl.includes('image') || rawUrl.includes('photo') || rawUrl.includes('media') || rawUrl.includes('cdn') || rawUrl.includes('fbcdn');
      
      // Allow URLs that either have image extension or contain image-related keywords
      if (hasImageExt || hasImageInUrl || rawUrl.includes('scontent')) {
        const encodedUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
        validImages.push(encodedUrl);
      } else {
        console.log(`  ⏭️ Skipping non-image URL: ${rawUrl.substring(0, 80)}...`);
      }
    } catch (error) {
      console.error(`  ❌ Invalid image URL: ${rawUrl}`, error);
    }
  }
  
  // Remove duplicates and return
  const uniqueImages = [...new Set(validImages)];
  console.log(`  📸 Total extracted: ${uniqueImages.length} unique image(s)`);
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


