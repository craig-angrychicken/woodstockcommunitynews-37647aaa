import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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
  'media:content'?: { url?: string };
  enclosure?: { url?: string };
  image?: { url?: string };
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
        const filteredItems = items.filter(item => {
          const itemDate = parseDate(item.pubDate || item.published);
          if (!itemDate) return false;
          const itemTime = itemDate.getTime();
          return itemTime >= dateFromTime && itemTime <= dateToTime;
        });

        console.log(`✅ ${filteredItems.length} items in date range`);

        // Insert artifacts
        for (const item of filteredItems) {
          const itemDate = parseDate(item.pubDate || item.published);
          const imageUrl = extractImageUrl(item);

          const { error: insertError } = await supabase
            .from('artifacts')
            .insert({
              source_id: source.id,
              title: cleanText(item.title || 'Untitled'),
              name: cleanText(item.title || 'Untitled'),
              url: item.link || item.id,
              content: cleanText(item.description || item.content || item.summary || ''),
              hero_image_url: imageUrl,
              date: itemDate?.toISOString() || new Date().toISOString(),
              type: 'article',
              is_test: environment === 'test'
            });

          if (insertError) {
            console.error('❌ Insert error:', insertError);
            totalErrors++;
          } else {
            totalArtifacts++;
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
  const regex = new RegExp(`<${tagName}[^>]*>([\s\S]*?)<\/${tagName}>`, 'i');
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

function extractImageUrl(item: RSSItem): string | null {
  return item.enclosure?.url || 
         item['media:content']?.url || 
         item.image?.url || 
         null;
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
