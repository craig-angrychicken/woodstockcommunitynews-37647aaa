import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { scrapeArticlesSimple } from "../_shared/simple-scraper.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log(`\n🚀 Starting article scrape`);
    console.log(`📅 Date range: ${dateFrom} to ${dateTo}`);
    console.log(`🎯 Environment: ${environment}`);
    console.log(`📊 Sources: ${sourceIds?.length || 0}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    
    // Backward compatible token retrieval
    const browserlessToken = Deno.env.get('BROWSERLESS_API_KEY') || Deno.env.get('BROWSERLESS_TOKEN');
    if (!browserlessToken) {
      throw new Error('Missing Browserless API key. Please set BROWSERLESS_API_KEY.');
    }
    console.log(`🔐 Browserless token detected (length: ${browserlessToken.length})`);
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
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
      let totalErrors = 0;

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

          // Validate source has configuration
          if (!source.parser_config?.scrapeConfig) {
            console.log('⚠️ No scrape configuration found, skipping');
            totalErrors++;
            continue;
          }

          const config = source.parser_config.scrapeConfig;

          // Scrape articles using simple scraper
          const articles = await scrapeArticlesSimple(source.url, config, browserlessToken);

          console.log(`\n📝 Processing ${articles.length} articles...`);

          // Filter by date range
          const filteredArticles = articles.filter(article => {
            if (!article.date) {
              console.log(`  ℹ️ No date for "${article.title}" - including by default`);
              return true;
            }
            
            const articleDate = new Date(article.date);
            
            // Check for invalid date
            if (isNaN(articleDate.getTime())) {
              console.log(`  ⚠️ Invalid date "${article.date}" for "${article.title}" - including anyway`);
              return true;
            }
            
            const inRange = articleDate >= dateFromObj && articleDate <= dateToObj;
            console.log(`  ${inRange ? '✅' : '❌'} "${article.title}" (${article.date}) - ${inRange ? 'in range' : 'out of range'}`);
            return inRange;
          });

          console.log(`\n  ✅ ${filteredArticles.length} articles in date range`);

          // Process each article
          for (const article of filteredArticles) {
            // Create artifact
            const { error: artifactError } = await supabase
              .from('artifacts')
              .insert({
                name: article.title,
                title: article.title,
                content: article.content || '',
                type: 'news',
                date: article.date ? new Date(article.date).toISOString() : new Date().toISOString(),
                source_id: source.id,
                hero_image_url: article.imageUrl || null,
                url: article.url,
                environment: isTest ? 'test' : 'production'
              });

            if (artifactError) {
              console.error(`❌ Error creating artifact: ${artifactError.message}`);
              totalErrors++;
            } else {
              totalArtifacts++;
              console.log(`  ✅ Created artifact: "${article.title}"`);
            }
          }

          // Update source stats
          await supabase
            .from('sources')
            .update({
              items_fetched: (source.items_fetched || 0) + filteredArticles.length,
              last_fetch_at: new Date().toISOString()
            })
            .eq('id', source.id);

        } catch (error) {
          console.error(`❌ Error processing source ${source.name}:`, error);
          totalErrors++;
        }
      }

      // Update query history - mark as failed if no artifacts were created
      if (queryHistoryId) {
        const status = totalArtifacts === 0 && totalErrors > 0 ? 'failed' : 'completed';
        const errorMessage = totalArtifacts === 0 && totalErrors > 0 
          ? 'All sources failed to scrape articles' 
          : undefined;
        
        await supabase
          .from('query_history')
          .update({
            status,
            artifacts_count: totalArtifacts,
            sources_processed: sources.length,
            sources_failed: totalErrors,
            completed_at: new Date().toISOString(),
            ...(errorMessage && { error_message: errorMessage })
          })
          .eq('id', queryHistoryId);
      }

      console.log(`\n✅ Scrape complete!`);
      console.log(`  Artifacts created: ${totalArtifacts}`);
      console.log(`  Errors: ${totalErrors}`);

      return new Response(
        JSON.stringify({
          success: true,
          artifactsCreated: totalArtifacts,
          sourcesProcessed: sources.length,
          errors: totalErrors,
          message: `Scrape complete: ${totalArtifacts} artifacts, ${totalErrors} errors`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } catch (error) {
      console.error('❌ Critical error in scrape-articles:', error);
      
      // ALWAYS update query_history to failed on error
      if (queryHistoryId) {
        try {
          await supabase
            .from('query_history')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              error_message: error instanceof Error ? error.message : 'Unknown error'
            })
            .eq('id', queryHistoryId);
        } catch (updateError) {
          console.error('❌ Failed to update query_history:', updateError);
        }
      }
      
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ Error parsing request:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid request'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});

// ============================================================================
// IMAGE SELECTION
// ============================================================================

async function selectBestHeroImage(images: string[], title: string, lovableApiKey: string): Promise<string | null> {
  if (!images || images.length === 0) return null;

  console.log(`\n🖼️ Evaluating ${images.length} images`);

  // Simple validation
  for (const imageUrl of images) {
    if (await isValidImage(imageUrl)) {
      console.log(`✅ Selected: ${imageUrl.substring(0, 60)}...`);
      return imageUrl;
    }
  }

  return null;
}

async function isValidImage(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return false;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return false;

    const contentLength = parseInt(response.headers.get('content-length') || '0');
    return contentLength >= 10000; // At least 10KB
  } catch {
    return false;
  }
}
