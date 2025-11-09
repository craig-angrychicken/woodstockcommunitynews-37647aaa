import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("🔍 Fetching OpenRouter models");

    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    // Fetch available models from OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenRouter API error:", response.status, errorText);
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Filter to only show Google, Anthropic, and OpenAI models
    const filteredModels = data.data.filter((model: any) => {
      const id = model.id.toLowerCase();
      return (
        id.includes('google/') || 
        id.includes('anthropic/') || 
        id.includes('openai/')
      );
    });

    // Sort by provider and name
    const sortedModels = filteredModels.sort((a: any, b: any) => {
      const providerA = a.id.split('/')[0];
      const providerB = b.id.split('/')[0];
      if (providerA !== providerB) {
        return providerA.localeCompare(providerB);
      }
      return a.id.localeCompare(b.id);
    });

    console.log(`✅ Found ${sortedModels.length} models from Google, Anthropic, and OpenAI`);

    return new Response(
      JSON.stringify({
        success: true,
        models: sortedModels,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Error fetching OpenRouter models:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
