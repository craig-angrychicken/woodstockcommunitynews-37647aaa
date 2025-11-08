import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to parse Cherokee County style news pages
function parseCherokeeCountyNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const articles = doc.querySelectorAll('.newsContainerSide');
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector('.normalStoryTitle a');
    const contentElement = el.querySelector('.normalStory');
    const dateElement = el.querySelector('[style*="font-size:10px"]');
    const imageElement = el.querySelector('.imageBracket img');

    if (titleElement && contentElement) {
      const title = titleElement.textContent?.trim() || '';
      const content = contentElement.textContent?.trim() || '';
      const dateText = dateElement?.textContent?.trim() || '';
      const imageUrl = imageElement?.getAttribute('src') || '';

      results.push({
        title,
        content,
        date: dateText,
        imageUrl,
        sourceUrl
      });
    }
  }

  return results;
}

// Helper function to parse Woodstock style news pages
function parseWoodstockNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const articles = doc.querySelectorAll('.news-list-item');
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector('.news-title');
    const dateElement = el.querySelector('.news-date');
    const linkElement = el.querySelector('a[href*="news_detail"]');

    if (titleElement && dateElement) {
      const title = titleElement.textContent?.trim() || '';
      const dateText = dateElement.textContent?.trim() || '';
      const articleLink = linkElement?.getAttribute('href') || '';

      results.push({
        title,
        content: `Read more at: ${articleLink}`,
        date: dateText,
        sourceUrl,
        articleLink
      });
    }
  }

  return results;
}

// Helper function to parse generic news pages
function parseGenericNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  // Try to find common news article patterns
  const selectors = [
    'article',
    '.news-item',
    '.post',
    '[class*="news"]',
    '[class*="article"]'
  ];

  for (const selector of selectors) {
    const articles = doc.querySelectorAll(selector);
    if (articles.length > 0) {
      const results = [];
      for (const article of articles) {
        const el = article as Element;
        const title = el.querySelector('h1, h2, h3, .title, [class*="title"]')?.textContent?.trim();
        const content = article.textContent?.trim()?.slice(0, 500);
        
        if (title && content) {
          results.push({
            title,
            content,
            date: new Date().toISOString(),
            sourceUrl
          });
        }
      }
      if (results.length > 0) return results;
    }
  }

  return [];
}

// Helper function to parse events from calendar pages
function parseEvents(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  // Look for event patterns in the HTML/text
  const results = [];
  const text = doc.body?.textContent || '';
  
  // Try to extract event data from text patterns
  const eventPattern = /([A-Z][^Date:]+)\s+Date:\s+([^Time:]+)\s+Time:\s+([^\n]+)/g;
  let match;
  
  while ((match = eventPattern.exec(text)) !== null) {
    const [, title, date, time] = match;
    if (title && date) {
      results.push({
        title: title.trim(),
        content: `Event on ${date.trim()} at ${time.trim()}`,
        date: date.trim(),
        sourceUrl
      });
    }
  }

  return results;
}

// Helper to parse various date formats and check if within range
function isDateInRange(dateStr: string, dateFrom: string, dateTo: string): boolean {
  if (!dateStr) return false;
  
  try {
    // Try to parse the date string
    const articleDate = new Date(dateStr);
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    
    // Check if valid date and within range
    if (isNaN(articleDate.getTime())) return false;
    return articleDate >= fromDate && articleDate <= toDate;
  } catch {
    return false; // If parsing fails, exclude the article
  }
}

// Main function to fetch and parse content from a source
async function fetchAndParseSource(source: any, dateFrom: string, dateTo: string) {
  try {
    console.log(`Fetching content from: ${source.url}`);
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${source.url}: ${response.status}`);
      return [];
    }

    const html = await response.text();
    let articles = [];

    // Determine parser based on source URL patterns
    if (source.url.includes('cherokeecountyga.gov')) {
      articles = parseCherokeeCountyNews(html, source.url);
    } else if (source.url.includes('woodstockga.gov/newslist')) {
      articles = parseWoodstockNews(html, source.url);
    } else if (source.url.includes('/events')) {
      articles = parseEvents(html, source.url);
    } else if (source.url.includes('cherokeecountyfire.org') || 
               source.url.includes('cherokeek12.net') || 
               source.url.includes('cherokeega.org')) {
      articles = parseGenericNews(html, source.url);
    } else {
      // Try generic parser as fallback
      articles = parseGenericNews(html, source.url);
    }

    console.log(`Parsed ${articles.length} items from ${source.name}`);
    return articles;
  } catch (error) {
    console.error(`Error fetching/parsing ${source.url}:`, error);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages,
      historyId
    } = await req.json();

    console.log('Starting manual query run:', {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const isTest = environment === 'test';
    let artifactsCount = 0;
    let storiesCount = 0;

    // Stage 1: Fetch sources and create artifacts
    console.log('Stage 1: Fetching sources and creating artifacts...');
    
    // Get source details
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', sourceIds);

    if (sourcesError) throw sourcesError;

    // Fetch and parse real content from sources
    for (const source of sources) {
      const articles = await fetchAndParseSource(source, dateFrom, dateTo);
      
      console.log(`Total articles found: ${articles.length} from ${source.name}`);
      
      // Filter articles by date range
      const filteredArticles = articles.filter(article => 
        isDateInRange(article.date, dateFrom, dateTo)
      );
      
      console.log(`After date filter: ${filteredArticles.length} articles from ${source.name}`);
      
      if (filteredArticles.length === 0) {
        console.log(`No articles in date range for ${source.name}`);
        continue;
      }

      // Create artifacts from filtered articles
      const artifactsToInsert = filteredArticles.map(article => ({
        name: `${source.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title: article.title,
        type: source.type,
        content: article.content,
        size_mb: new Blob([article.content]).size / (1024 * 1024),
        source_id: source.id,
        date: article.date ? new Date(article.date).toISOString() : new Date().toISOString()
      }));

      const { error: insertError } = await supabase
        .from('artifacts')
        .insert(artifactsToInsert);

      if (insertError) {
        console.error('Error inserting artifacts:', insertError);
      } else {
        artifactsCount += artifactsToInsert.length;
        console.log(`Created ${artifactsToInsert.length} artifacts from ${source.name}`);
      }

      // Update source's last_fetch_at
      await supabase
        .from('sources')
        .update({
          last_fetch_at: new Date().toISOString(),
          items_fetched: articles.length
        })
        .eq('id', source.id);
    }

    console.log(`Stage 1 complete: Created ${artifactsCount} artifacts`);

    // Stage 2: Generate stories using AI (if requested)
    if (runStages === 'both') {
      console.log('Stage 2: Generating stories with AI...');

      // Get prompt version
      const { data: promptVersion, error: promptError } = await supabase
        .from('prompt_versions')
        .select('*')
        .eq('id', promptVersionId)
        .single();

      if (promptError) throw promptError;

      // Get recent artifacts to generate stories from
      const { data: recentArtifacts, error: artifactsError } = await supabase
        .from('artifacts')
        .select('*')
        .in('source_id', sourceIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (artifactsError) throw artifactsError;

      // Generate stories from artifacts using AI
      for (const artifact of recentArtifacts) {
        const aiPrompt = `${promptVersion.content}\n\nSource material:\nTitle: ${artifact.title}\nContent: ${artifact.content}\n\nGenerate a news article based on this source material.`;

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a professional news article writer.' },
                { role: 'user', content: aiPrompt }
              ],
            }),
          });

          if (!aiResponse.ok) {
            if (aiResponse.status === 429) {
              console.error('Rate limit exceeded');
              continue;
            }
            if (aiResponse.status === 402) {
              console.error('Payment required - out of credits');
              break;
            }
            throw new Error(`AI API error: ${aiResponse.status}`);
          }

          const aiData = await aiResponse.json();
          const generatedContent = aiData.choices[0].message.content;

          // Create story
          const { data: newStory, error: storyError } = await supabase
            .from('stories')
            .insert({
              title: artifact.title,
              content: generatedContent,
              status: 'pending',
              is_test: isTest,
              environment,
              article_type: 'full',
              prompt_version_id: promptVersion.version_name,
              source_id: artifact.source_id
            })
            .select()
            .single();

          if (storyError) {
            console.error('Error creating story:', storyError);
            continue;
          }

          // Link artifact to story
          await supabase
            .from('story_artifacts')
            .insert({
              story_id: newStory.id,
              artifact_id: artifact.id
            });

          storiesCount++;
          console.log(`Created story: ${newStory.title}`);
        } catch (aiError) {
          console.error('Error generating story with AI:', aiError);
        }
      }

      console.log(`Stage 2 complete: Generated ${storiesCount} stories`);
    }

    // Update query history
    const { error: historyError } = await supabase
      .from('query_history')
      .update({
        status: 'completed',
        artifacts_count: artifactsCount,
        stories_count: storiesCount,
        completed_at: new Date().toISOString()
      })
      .eq('id', historyId);

    if (historyError) {
      console.error('Error updating history:', historyError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCount,
        storiesCount,
        message: `Successfully completed. Created ${artifactsCount} artifacts${runStages === 'both' ? ` and ${storiesCount} stories` : ''}.`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in run-manual-query:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
