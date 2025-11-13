import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { testConfiguration } from "../_shared/browserless-scraper.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl, config, html, containersHtml } = await req.json();

    if (!sourceUrl || !config) {
      return new Response(
        JSON.stringify({ success: false, error: 'sourceUrl and config are required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🧪 Testing scrape config for: ${sourceUrl}`);
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log(`📄 Using ${containersHtml ? `${containersHtml.length} selected containers` : html ? 'provided' : 'fetched'} HTML`);

    const { articles } = await testConfiguration(sourceUrl, config, html, containersHtml);

    console.log(`✅ Found ${articles.length} articles`);

    return new Response(
      JSON.stringify({
        success: true,
        articles: articles,
        count: articles.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error testing scrape config:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
