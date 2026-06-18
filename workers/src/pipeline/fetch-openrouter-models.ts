interface OpenRouterModel {
  id: string;
  [key: string]: unknown;
}

export interface FetchOpenRouterModelsResult {
  success: boolean;
  models: OpenRouterModel[];
}

/**
 * Fetch the list of available models from OpenRouter, filtered to Google,
 * Anthropic, OpenAI, and xAI (Grok) providers, sorted by provider then id.
 */
export async function fetchOpenRouterModels(
  openRouterApiKey: string | undefined,
): Promise<FetchOpenRouterModelsResult> {
  console.log("🔍 Fetching OpenRouter models");

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

  const data = await response.json() as { data: OpenRouterModel[] };

  // Filter to only show Google, Anthropic, OpenAI, and xAI (Grok) models
  const filteredModels = data.data.filter((model: { id: string }) => {
    const id = model.id.toLowerCase();
    return (
      id.includes("google/") ||
      id.includes("anthropic/") ||
      id.includes("openai/") ||
      id.includes("x-ai/")
    );
  });

  // Sort by provider and name
  const sortedModels = filteredModels.sort((a: { id: string }, b: { id: string }) => {
    const providerA = a.id.split("/")[0];
    const providerB = b.id.split("/")[0];
    if (providerA !== providerB) {
      return providerA.localeCompare(providerB);
    }
    return a.id.localeCompare(b.id);
  });

  console.log(
    `✅ Found ${sortedModels.length} models from Google, Anthropic, OpenAI, and xAI`,
  );

  return {
    success: true,
    models: sortedModels,
  };
}
