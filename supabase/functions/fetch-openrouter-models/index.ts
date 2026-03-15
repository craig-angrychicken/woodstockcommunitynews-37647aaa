import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

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

    // Filter to only show Google, Anthropic, OpenAI, and xAI (Grok) models
    const filteredModels = data.data.filter((model: { id: string }) => {
      const id = model.id.toLowerCase();
      return (
        id.includes('google/') ||
        id.includes('anthropic/') ||
        id.includes('openai/') ||
        id.includes('x-ai/')
      );
    });

    // Sort by provider and name
    const sortedModels = filteredModels.sort((a: { id: string }, b: { id: string }) => {
      const providerA = a.id.split('/')[0];
      const providerB = b.id.split('/')[0];
      if (providerA !== providerB) {
        return providerA.localeCompare(providerB);
      }
      return a.id.localeCompare(b.id);
    });

    console.log(`✅ Found ${sortedModels.length} models from Google, Anthropic, OpenAI, and xAI`);

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
