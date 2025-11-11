import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { scrapeWithBrowserless, normalizeUrl } from "../_shared/browserless-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  let markdown = html;
  
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  markdown = markdown.replace(/<br[^>]*>/gi, '\n');
  markdown = markdown.replace(/<[^>]+>/g, '');
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();
  
  return markdown;
}

// Phase 1: URL Pattern Filtering
function isValidImageUrl(url: string): boolean {
  const urlLower = url.toLowerCase();
  const invalidPatterns = [
    '/icon', '/logo', '/avatar', '/thumbnail',
    'tracking', 'pixel', 'beacon', 'analytics',
    'social-share', 'facebook', 'twitter', 'linkedin',
    'badge', 'button', 'banner-ad',
    '.gif', '1x1', '2x2', 'spacer'
  ];
  return !invalidPatterns.some(pattern => urlLower.includes(pattern));
}

// Phase 2: Metadata Validation
async function validateImageMetadata(url: string): Promise<{ valid: boolean; score: number; reason?: string }> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    
    if (!response.ok) {
      return { valid: false, score: 0, reason: 'Image not accessible' };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return { valid: false, score: 0, reason: 'Not an image' };
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength < 50000) {
      return { valid: false, score: 0, reason: 'Image too small (< 50KB)' };
    }
    if (contentLength > 5000000) {
      return { valid: false, score: 0.3, reason: 'Image very large (> 5MB)' };
    }

    let score = 0.5;
    if (contentLength >= 200000 && contentLength <= 2000000) {
      score = 1.0;
    } else if (contentLength >= 100000 && contentLength < 200000) {
      score = 0.8;
    } else if (contentLength > 2000000 && contentLength <= 5000000) {
      score = 0.6;
    }

    return { valid: true, score };
  } catch (error) {
    console.error('Error validating image metadata:', error);
    return { valid: false, score: 0, reason: 'Metadata validation failed' };
  }
}

// Phase 3: AI Visual Analysis
async function analyzeImageWithAI(imageUrl: string, title: string, lovableApiKey: string): Promise<{ score: number; reasoning: string }> {
  try {
    console.log(`  🤖 Analyzing image with AI: ${imageUrl.substring(0, 80)}...`);
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert image curator for a news website. Analyze this image and determine if it would make a good hero image for an article titled "${title}".

Score the image on a scale of 0-10 based on:
- Visual quality and resolution
- Relevance to the story title
- Professional appearance (not a logo, icon, or generic stock photo)
- Composition (is it a proper photo/illustration vs a UI element)
- Newsworthiness (does it look like editorial content)

Respond with ONLY a JSON object in this exact format:
{"score": <number 0-10>, "reasoning": "<brief explanation>"}`
              },
              {
                type: "image_url",
                image_url: { url: imageUrl }
              }
            ]
          }
        ],
        max_tokens: 200
      })
    });

    if (!response.ok) {
      console.error('  ❌ AI analysis failed:', response.status);
      return { score: 0.5, reasoning: 'AI analysis unavailable, using neutral score' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{"score": 5, "reasoning": "No response"}';
    const result = JSON.parse(content);
    console.log(`  ✅ AI score: ${result.score}/10 - ${result.reasoning}`);
    
    return { score: result.score / 10, reasoning: result.reasoning };
  } catch (error) {
    console.error('  ❌ Error in AI image analysis:', error);
    return { score: 0.5, reasoning: 'AI analysis error, using neutral score' };
  }
}

// Select best hero image
async function selectBestHeroImage(images: string[], title: string, lovableApiKey: string): Promise<string | null> {
  if (!images || images.length === 0) {
    console.log('  ℹ️ No images available');
    return null;
  }

  console.log(`\n🖼️ Evaluating ${images.length} images for: "${title}"`);

  const imageScores: Array<{ url: string; totalScore: number; details: any }> = [];

  for (const imageUrl of images) {
    console.log(`\n  --- Evaluating: ${imageUrl.substring(0, 80)}... ---`);
    
    if (!isValidImageUrl(imageUrl)) {
      console.log('  ❌ Phase 1 FAILED: Invalid URL pattern');
      continue;
    }
    console.log('  ✅ Phase 1 PASSED: Valid URL pattern');

    const metadataResult = await validateImageMetadata(imageUrl);
    if (!metadataResult.valid) {
      console.log(`  ❌ Phase 2 FAILED: ${metadataResult.reason}`);
      continue;
    }
    console.log(`  ✅ Phase 2 PASSED: Metadata score ${metadataResult.score.toFixed(2)}`);

    const aiResult = await analyzeImageWithAI(imageUrl, title, lovableApiKey);
    console.log(`  ✅ Phase 3 COMPLETE: AI score ${aiResult.score.toFixed(2)}`);

    const totalScore = (metadataResult.score * 0.3) + (aiResult.score * 0.7);
    
    imageScores.push({
      url: imageUrl,
      totalScore,
      details: {
        metadataScore: metadataResult.score,
        aiScore: aiResult.score,
        aiReasoning: aiResult.reasoning
      }
    });

    console.log(`  📊 Total score: ${totalScore.toFixed(2)}`);
  }

  if (imageScores.length === 0) {
    console.log('  ❌ No images passed validation');
    return null;
  }

  imageScores.sort((a, b) => b.totalScore - a.totalScore);
  const winner = imageScores[0];
  
  console.log(`\n🏆 Selected hero image: ${winner.url.substring(0, 80)}...`);
  console.log(`   Final score: ${winner.totalScore.toFixed(2)}`);

  return winner.url;
}

// Parse date from text
function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  try {
    // Try common date formats
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date;
    }
    
    // Try MM/DD/YYYY format
    const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
      const [, month, day, year] = slashMatch;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return new Date(`${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    
    return null;
  } catch {
    return null;
  }
}

// Check if date is in range
function isDateInRange(date: Date | null, dateFrom: Date, dateTo: Date): boolean {
  if (!date) return true; // Include articles without dates
  return date >= dateFrom && date <= dateTo;
}

// Fetch articles using Browserless
async function fetchArticlesWithBrowserless(
  source: any,
  dateFrom: Date,
  dateTo: Date
): Promise<any[]> {
  console.log(`\n🌐 Fetching articles from: ${source.name}`);

  // Validate source has Browserless config
  if (!source.parser_config?.scrapeConfig) {
    throw new Error(`Source ${source.name} does not have a Browserless configuration. Please run analysis first.`);
  }

  const scrapeConfig = source.parser_config.scrapeConfig;
  
  // Scrape the source URL
  const scrapeResult = await scrapeWithBrowserless(source.url, scrapeConfig);
  
  console.log(`✅ Scraped ${scrapeResult.data.length} element groups`);

  // Transform Browserless results into article objects
  // Elements are ordered: [0]=container, [1]=title, [2]=date, [3]=link, [4]=content
  const articles: any[] = [];
  
  if (!scrapeResult.data || scrapeResult.data.length === 0) {
    console.log('⚠️ No scrape results found');
    return [];
  }

  const containerData = scrapeResult.data[0]; // First element is container
  const titleData = scrapeResult.data[1];     // Second element is title
  const dateData = scrapeResult.data[2];      // Third element is date
  const linkData = scrapeResult.data[3];      // Fourth element is link
  const contentData = scrapeResult.data[4];   // Fifth element is content

  if (!containerData || !containerData.results || containerData.results.length === 0) {
    console.log('⚠️ No container results found');
    return [];
  }

  console.log(`📦 Found ${containerData.results.length} containers`);

  // Process each container
  for (let i = 0; i < containerData.results.length; i++) {
    const container = containerData.results[i];
    
    // Extract title
    const title = titleData?.results[i]?.text?.trim() || '';
    
    if (!title || title.length < 10) {
      console.log(`⏭️ Skipping container ${i}: no valid title`);
      continue;
    }

    // Extract date
    const dateText = dateData?.results[i]?.text?.trim() || 
                     dateData?.results[i]?.attributes?.find((a: any) => a.name === 'datetime')?.value || '';
    const articleDate = parseDate(dateText);

    // Filter by date range
    if (!isDateInRange(articleDate, dateFrom, dateTo)) {
      console.log(`⏭️ Skipping "${title}": outside date range`);
      continue;
    }

    // Extract link
    const href = linkData?.results[i]?.attributes?.find((a: any) => a.name === 'href')?.value || '';
    const articleUrl = href ? normalizeUrl(href, source.url) : '';

    // Extract content
    const content = contentData?.results[i]?.html || container.html || '';
    const contentMarkdown = htmlToMarkdown(content);

    // Extract images from content
    const images: string[] = [];
    const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    for (const match of imgMatches) {
      const imgUrl = normalizeUrl(match[1], source.url);
      if (isValidImageUrl(imgUrl)) {
        images.push(imgUrl);
      }
    }

    articles.push({
      title,
      date: articleDate ? articleDate.toISOString() : null,
      articleUrl,
      content: contentMarkdown,
      images,
      sourceId: source.id,
      sourceName: source.name
    });

    console.log(`✅ Article ${i + 1}: "${title}"`);
  }

  console.log(`\n✅ Extracted ${articles.length} articles from ${source.name}`);
  return articles;
}

// Main handler
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      dateFrom, 
      dateTo, 
      sourceIds, 
      environment = 'production',
      queryHistoryId 
    } = await req.json();

    console.log(`\n🚀 Starting manual query`);
    console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);
    console.log(`🎯 Environment: ${environment}`);
    console.log(`📊 Sources: ${sourceIds.length}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const dateFromObj = new Date(dateFrom);
    const dateToObj = new Date(dateTo);
    const isTest = environment === 'test';

    // Fetch sources
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', sourceIds);

    if (sourcesError) throw sourcesError;

    console.log(`✅ Loaded ${sources.length} sources`);

    let totalArtifacts = 0;

    // Process each source
    for (const source of sources) {
      try {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Processing: ${source.name}`);
        console.log(`${'='.repeat(60)}`);

        // Update query history
        if (queryHistoryId) {
          await supabase
            .from('query_history')
            .update({
              current_source_name: source.name,
              current_source_id: source.id
            })
            .eq('id', queryHistoryId);
        }

        // Fetch articles using Browserless
        const articles = await fetchArticlesWithBrowserless(source, dateFromObj, dateToObj);

        console.log(`\n📝 Processing ${articles.length} articles...`);

        // Process each article
        for (const article of articles) {
          // Select best hero image if available
          let heroImageUrl = null;
          if (article.images && article.images.length > 0) {
            heroImageUrl = await selectBestHeroImage(article.images, article.title, lovableApiKey);
          }

          // Create artifact
          const { error: artifactError } = await supabase
            .from('artifacts')
            .insert({
              name: article.title,
              title: article.title,
              content: article.content,
              type: 'news',
              date: article.date,
              source_id: source.id,
              hero_image_url: heroImageUrl,
              images: article.images || [],
              is_test: isTest,
              size_mb: 0
            });

          if (artifactError) {
            console.error(`❌ Error creating artifact: ${artifactError.message}`);
          } else {
            totalArtifacts++;
            console.log(`  ✅ Created artifact: "${article.title}"`);
          }
        }

        // Update source stats
        await supabase
          .from('sources')
          .update({
            items_fetched: (source.items_fetched || 0) + articles.length,
            last_fetch_at: new Date().toISOString()
          })
          .eq('id', source.id);

      } catch (error) {
        console.error(`❌ Error processing source ${source.name}:`, error);
      }
    }

    // Update query history
    if (queryHistoryId) {
      await supabase
        .from('query_history')
        .update({
          status: 'completed',
          artifacts_count: totalArtifacts,
          sources_processed: sources.length,
          completed_at: new Date().toISOString()
        })
        .eq('id', queryHistoryId);
    }

    console.log(`\n✅ Query complete! Created ${totalArtifacts} artifacts`);

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCreated: totalArtifacts,
        sourcesProcessed: sources.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in run-manual-query:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
