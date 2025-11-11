import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeSourceStructure } from "../_shared/browserless-service.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl } = await req.json();

    if (!sourceUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'sourceUrl is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔍 Analyzing source: ${sourceUrl}`);

    // Use Browserless service to analyze the source
    const result = await analyzeSourceStructure(sourceUrl);

    // Extract sample articles from preview data
    const sampleArticles: any[] = [];
    
    if (result.previewData && result.previewData.data) {
      // Group results by container
      const containerData = result.previewData.data.find(
        (item: any) => item.selector.includes('container') || item.results.length > 0
      );

      if (containerData && containerData.results.length > 0) {
        // Take first 3 containers as samples
        for (let i = 0; i < Math.min(3, containerData.results.length); i++) {
          const container = containerData.results[i];
          
          // Extract title, date, link from other result groups
          let title = '';
          let date = '';
          let link = '';
          let excerpt = container.text?.substring(0, 150) || '';

          // Find title in results
          const titleData = result.previewData.data.find((item: any) => 
            item.selector.includes('title') || item.selector.includes('h1') || item.selector.includes('h2')
          );
          if (titleData && titleData.results[i]) {
            title = titleData.results[i].text || '';
          }

          // Find date in results
          const dateData = result.previewData.data.find((item: any) => 
            item.selector.includes('date') || item.selector.includes('time')
          );
          if (dateData && dateData.results[i]) {
            date = dateData.results[i].text || '';
          }

          // Find link in results
          const linkData = result.previewData.data.find((item: any) => 
            item.selector.includes('link') || item.selector.includes('a')
          );
          if (linkData && linkData.results[i]) {
            const href = linkData.results[i].attributes?.find((attr: any) => attr.name === 'href');
            link = href?.value || '';
          }

          if (title || excerpt) {
            sampleArticles.push({ title, date, link, excerpt });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          suggestedSelectors: result.suggestedConfig,
          sampleArticles,
          confidence: result.confidence,
          recommendedParser: 'browserless'
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error analyzing source:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
