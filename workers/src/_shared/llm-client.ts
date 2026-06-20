/**
 * LLM + embedding client. API keys are passed in via `keys`, and the OpenRouter
 * HTTP-Referer header uses the public site URL.
 */
export interface LLMConfig {
  model_name: string;
  model_provider: string;
}

export interface LLMKeys {
  openRouterApiKey?: string;
  lovableApiKey?: string;
  /** Sent as OpenRouter HTTP-Referer header. */
  refererUrl?: string;
}

export interface LLMRequestOptions {
  prompt: string | Array<{ type: string; [key: string]: unknown }>;
  modelConfig: LLMConfig;
  keys: LLMKeys;
  maxTokens?: number;
  temperature?: number;
  appTitle?: string;
}

export interface LLMResponse {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  raw: unknown;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 4000, 8000];

/**
 * Generate a 384-dim embedding using OpenRouter's text-embedding-3-small,
 * matching the 384-dimension embedding column.
 */
export async function generateEmbedding(text: string, openRouterApiKey: string | undefined): Promise<number[]> {
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY not configured");

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
      dimensions: 384,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Embedding API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

export async function callLLM(options: LLMRequestOptions): Promise<LLMResponse> {
  const {
    prompt,
    modelConfig,
    keys,
    maxTokens = 5000,
    temperature = 0.6,
    appTitle = "Woodstock Community News",
  } = options;

  const isOpenRouter = modelConfig.model_provider === "openrouter";
  const apiUrl = isOpenRouter
    ? "https://openrouter.ai/api/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";

  const authToken = isOpenRouter ? keys.openRouterApiKey : keys.lovableApiKey;
  if (!authToken) {
    throw new Error(isOpenRouter ? "OPENROUTER_API_KEY not configured" : "LOVABLE_API_KEY not configured");
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
  if (isOpenRouter) {
    headers["HTTP-Referer"] = keys.refererUrl ?? "https://woodstockcommunity.news";
    headers["X-Title"] = appTitle;
  }

  const body = JSON.stringify({
    model: modelConfig.model_name,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    temperature,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(apiUrl, { method: "POST", headers, body });

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: LLMResponse["usage"];
          model?: string;
        };
        return {
          content: data.choices?.[0]?.message?.content || "",
          usage: data.usage,
          model: data.model,
          raw: data,
        };
      }

      const errorText = await response.text();
      let message = `AI API error ${response.status}`;
      try {
        const parsed = JSON.parse(errorText);
        const providerMsg = parsed?.error?.message || parsed?.message;
        if (providerMsg) message = providerMsg;
      } catch {
        // ignore JSON parse errors
      }

      // Don't retry client errors (4xx) except 429 (rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(message);
      }
      lastError = new Error(message);
      console.error(`LLM API error (attempt ${attempt + 1}/${MAX_RETRIES}):`, message);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("AI API error 4")) throw lastError;
      console.error(`LLM request failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, lastError.message);
    }

    if (attempt < MAX_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }

  throw lastError || new Error("LLM call failed after retries");
}
