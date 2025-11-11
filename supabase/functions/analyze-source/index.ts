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
    // Elements are ordered: [0]=container, [1]=title, [2]=date, [3]=link, [4]=content
    const sampleArticles: any[] = [];
    
    if (result.previewData && result.previewData.data && result.previewData.data.length > 0) {
      const containerData = result.previewData.data[0]; // First element is container
      const titleData = result.previewData.data[1];     // Second element is title
      const dateData = result.previewData.data[2];      // Third element is date
      const linkData = result.previewData.data[3];      // Fourth element is link

      if (containerData && containerData.results && containerData.results.length > 0) {
        // Take first 3 containers as samples
        for (let i = 0; i < Math.min(3, containerData.results.length); i++) {
          const container = containerData.results[i];
          
          const title = titleData?.results[i]?.text?.trim() || '';
          const date = dateData?.results[i]?.text?.trim() || 
                      dateData?.results[i]?.attributes?.find((a: any) => a.name === 'datetime')?.value || '';
          
          const href = linkData?.results[i]?.attributes?.find((a: any) => a.name === 'href')?.value || '';
          const link = href;
          
          const excerpt = container.text?.substring(0, 150) || '';

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
