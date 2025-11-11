import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { analyzeSource } from "../_shared/browserless-scraper.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    const result = await analyzeSource(sourceUrl);

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          suggestedConfig: result.suggestedConfig,
          sampleArticles: result.previewArticles,
          confidence: result.confidence,
          diagnostics: result.diagnostics,
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
