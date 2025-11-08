import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay utilities for human-like scraping
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs: number = 2000, maxMs: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`⏱️ Waiting ${delay}ms before next request...`);
  return sleep(delay);
}

// HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  let markdown = html;
  
  // Convert headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  
  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Convert links
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Convert bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  
  // Convert line breaks
  markdown = markdown.replace(/<br[^>]*>/gi, '\n');
  
  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");
  
  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();
  
  return markdown;
}

// Download image and store in Supabase
async function downloadAndStoreImage(
  imageUrl: string, 
  artifactId: string, 
  imageIndex: number,
  supabase: any
): Promise<string | null> {
  try {
    console.log(`📥 Downloading image ${imageIndex}: ${imageUrl}`);
    
    // Handle relative URLs
    let fullImageUrl = imageUrl;
    if (imageUrl.startsWith('//')) {
      fullImageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      console.log('⚠️ Skipping relative URL:', imageUrl);
      return null;
    }
    
    // Download image
    const imageResponse = await fetch(fullImageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to download image: ${imageResponse.status}`);
      return null;
    }
    
    // Get image data
    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Determine file extension
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    
    // Generate storage path
    const fileName = `${artifactId}_${imageIndex}.${extension}`;
    const storagePath = `artifacts/${fileName}`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('artifact-images')
      .upload(storagePath, uint8Array, {
        contentType,
        upsert: true
      });
    
    if (error) {
      console.error('Error uploading image to storage:', error);
      return null;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('artifact-images')
      .getPublicUrl(storagePath);
    
    console.log(`✅ Stored image at: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('Error processing image:', error);
    return null;
  }
}

// Fetch full article content from individual article page
async function fetchFullArticle(articleUrl: string, sourceDomain: string): Promise<{ content: string; images: string[] }> {
  try {
    console.log(`📄 Fetching full article from: ${articleUrl}`);
    
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });
    
    if (!response.ok) {
      console.error(`Failed to fetch article: ${response.status}`);
      return { content: '', images: [] };
    }
    
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return { content: '', images: [] };
    
    // Extract images
    const images: string[] = [];
    const imgElements = doc.querySelectorAll('article img, .article img, .content img, main img');
    for (const img of imgElements) {
      const src = (img as Element).getAttribute('src');
      if (src && !src.includes('logo') && !src.includes('icon')) {
        images.push(src);
      }
    }
    
    // Extract main content based on common patterns
    let contentElement = null;
    const contentSelectors = [
      'article',
      '.article-content',
      '.post-content',
      '.entry-content',
      'main',
      '[class*="content"]'
    ];
    
    for (const selector of contentSelectors) {
      contentElement = doc.querySelector(selector);
      if (contentElement) break;
    }
    
    if (!contentElement) {
      contentElement = doc.querySelector('body');
    }
    
    const htmlContent = (contentElement as Element)?.innerHTML || '';
    const markdownContent = htmlToMarkdown(htmlContent);
    
    console.log(`✅ Extracted ${markdownContent.length} chars and ${images.length} images`);
    
    return { content: markdownContent, images };
  } catch (error) {
    console.error('Error fetching full article:', error);
    return { content: '', images: [] };
  }
}

// Helper function to parse Cherokee County style news pages
function parseCherokeeCountyNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const articles = doc.querySelectorAll('.newsContainerSide');
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector('.normalStoryTitle a');
    const dateElement = el.querySelector('[style*="font-size:10px"]');
    
    if (titleElement) {
      const title = titleElement.textContent?.trim() || '';
      const dateText = dateElement?.textContent?.trim() || '';
      const articleLink = titleElement.getAttribute('href') || '';
      
      // Make absolute URL
      const fullUrl = articleLink.startsWith('http') 
        ? articleLink 
        : new URL(articleLink, sourceUrl).href;

      results.push({
        title,
        date: dateText,
        articleUrl: fullUrl,
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

    if (titleElement && linkElement) {
      const title = titleElement.textContent?.trim() || '';
      const dateText = dateElement?.textContent?.trim() || '';
      const articleLink = linkElement.getAttribute('href') || '';
      
      // Make absolute URL
      const fullUrl = articleLink.startsWith('http') 
        ? articleLink 
        : new URL(articleLink, sourceUrl).href;

      results.push({
        title,
        date: dateText,
        articleUrl: fullUrl,
        sourceUrl
      });
    }
  }

  return results;
}

// Helper function to parse generic news pages
function parseGenericNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  // Try multiple generic selectors
  const articleSelectors = [
    'article',
    '.article',
    '.news-item',
    '.post',
    '[class*="news"]',
    '[class*="article"]'
  ];

  let articles: any = [];
  for (const selector of articleSelectors) {
    articles = doc.querySelectorAll(selector);
    if (articles.length > 0) break;
  }

  const results = [];

  for (const article of articles) {
    const el = article as Element;
    
    // Try to find title and link
    const titleElement = el.querySelector('h1, h2, h3, .title, [class*="title"]');
    const linkElement = el.querySelector('a[href]');
    
    if (titleElement && linkElement) {
      const title = titleElement.textContent?.trim() || '';
      const articleLink = linkElement.getAttribute('href') || '';
      
      // Make absolute URL
      const fullUrl = articleLink.startsWith('http') 
        ? articleLink 
        : new URL(articleLink, sourceUrl).href;
      
      // Try to find date
      const dateElement = el.querySelector('time, .date, [class*="date"]');
      const dateText = dateElement?.textContent?.trim() || '';

      results.push({
        title,
        date: dateText,
        articleUrl: fullUrl,
        sourceUrl
      });
    }
  }

  return results;
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
        date: date.trim(),
        content: `Event on ${date.trim()} at ${time.trim()}`,
        articleUrl: sourceUrl, // Events don't have separate pages, use source URL
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
async function fetchAndParseSource(source: any, dateFrom: string, dateTo: string, supabase: any) {
  try {
    console.log(`\n🔍 Fetching content from: ${source.url}`);
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch ${source.url}: ${response.status}`);
      return [];
    }

    const html = await response.text();
    let articleLinks = [];

    // Parse listing page to get article links
    if (source.url.includes('cherokeecountyga.gov')) {
      articleLinks = parseCherokeeCountyNews(html, source.url);
    } else if (source.url.includes('woodstockga.gov/newslist')) {
      articleLinks = parseWoodstockNews(html, source.url);
    } else if (source.url.includes('/events')) {
      articleLinks = parseEvents(html, source.url);
    } else if (source.url.includes('cherokeecountyfire.org') || 
               source.url.includes('cherokeek12.net') || 
               source.url.includes('cherokeega.org')) {
      articleLinks = parseGenericNews(html, source.url);
    } else {
      articleLinks = parseGenericNews(html, source.url);
    }

    console.log(`📋 Found ${articleLinks.length} article links from ${source.name}`);
    
    // Fetch full content for each article
    const fullArticles = [];
    for (let i = 0; i < articleLinks.length; i++) {
      const link = articleLinks[i];
      
      // Apply human delay between requests
      if (i > 0) {
        await randomDelay(2000, 3000);
      }
      
      console.log(`\n📰 Processing article ${i + 1}/${articleLinks.length}: ${link.title}`);
      
      const { content, images } = await fetchFullArticle(link.articleUrl, source.url);
      
      if (content) {
        // Generate unique artifact ID for this article
        const artifactId = `${source.name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Download and store images, replace URLs in content
        let finalContent = content;
        const imageMap = new Map();
        
        for (let imgIndex = 0; imgIndex < images.length && imgIndex < 10; imgIndex++) {
          await randomDelay(1000, 2000); // Small delay between image downloads
          const supabaseUrl = await downloadAndStoreImage(images[imgIndex], artifactId, imgIndex, supabase);
          if (supabaseUrl) {
            imageMap.set(images[imgIndex], supabaseUrl);
          }
        }
        
        // Replace image URLs in markdown content
        for (const [originalUrl, supabaseUrl] of imageMap.entries()) {
          finalContent = finalContent.replace(new RegExp(originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), supabaseUrl);
        }
        
        fullArticles.push({
          artifactId,
          title: link.title,
          content: finalContent,
          date: link.date,
          imageCount: imageMap.size,
          sourceUrl: link.articleUrl
        });
      }
    }

    console.log(`\n✅ Successfully processed ${fullArticles.length} full articles from ${source.name}`);
    return fullArticles;
  } catch (error) {
    console.error(`❌ Error fetching/parsing ${source.url}:`, error);
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
      const articles = await fetchAndParseSource(source, dateFrom, dateTo, supabase);
      
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
        name: article.artifactId,
        title: article.title,
        type: source.type,
        content: article.content,
        size_mb: new Blob([article.content]).size / (1024 * 1024),
        source_id: source.id,
        date: article.date ? new Date(article.date).toISOString() : new Date().toISOString(),
        is_test: isTest
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
