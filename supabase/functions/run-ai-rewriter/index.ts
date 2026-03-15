import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";

const MAX_STORIES_PER_RUN = 20;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("✏️ run-ai-rewriter started");

  const supabase = createSupabaseClient();

  const summary = { rewritten: 0, errors: 0 };

  try {
    // Step 1: Fetch model config
    const { data: modelSettings, error: settingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_model_config")
      .single();

    if (settingsError || !modelSettings) {
      throw new Error("Failed to fetch model configuration");
    }

    const modelConfig = modelSettings.value as { model_name: string; model_provider: string };

    // Step 2: Fetch fact_checked stories
    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        content,
        fact_check_notes,
        structured_metadata
      `)
      .eq("status", "fact_checked")
      .eq("environment", "production")
      .eq("is_test", false)
      .order("created_at", { ascending: true })
      .limit(MAX_STORIES_PER_RUN);

    if (storiesError) {
      throw new Error(`Failed to fetch stories: ${storiesError.message}`);
    }

    const storyList = stories || [];
    console.log(`📚 Found ${storyList.length} fact-checked stories to rewrite`);

    if (storyList.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No fact-checked stories to rewrite", ...summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Rewrite each story
    for (const story of storyList) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n✏️ Rewriting: "${storyTitle}" (${story.id})`);

      try {
        const factCheckFeedback = story.fact_check_notes
          ? `\n\n## Fact-Check Feedback\n${story.fact_check_notes}`
          : "";

        const prompt = `You are a senior editor at Woodstock Community News, a local news outlet covering Woodstock, Georgia and Cherokee County. Your job is to improve this article based on fact-check feedback.

## Current Article
HEADLINE: ${storyTitle}

${story.content || ""}
${factCheckFeedback}

## Instructions
1. If the fact-checker flagged any unverified claims, REMOVE them or add hedging language ("reportedly", "according to")
2. Improve the headline if it's weak or clickbait-y
3. Tighten the prose — remove redundant sentences, improve flow
4. Ensure AP style consistency
5. Keep the article factual and professional

## Output Format
Respond with the improved article in the SAME format as the input. Start with the headline on the first line, then the article body. Keep all existing structural markers (SUBHEAD:, BYLINE:, SOURCE:) if present.

If the article is already well-written and no fact-check issues were found, return it mostly unchanged with only minor polish.`;

        const llmResponse = await callLLM({
          prompt,
          modelConfig,
          maxTokens: 5000,
          temperature: 0.4,
          appTitle: "Woodstock Community News Rewriter",
        });

        const rewrittenContent = llmResponse.content.trim();

        // Extract new title (first line)
        const lines = rewrittenContent.split("\n").filter((l: string) => l.trim());
        const rawTitle = lines[0] || "";
        const newTitle = rawTitle
          .replace(/^#+\s*/, "")
          .replace(/^HEADLINE:\s*/i, "")
          .replace(/^TITLE:\s*/i, "")
          .replace(/^\*\*(.+)\*\*$/, "$1")
          .replace(/^["'](.+)["']$/, "$1")
          .trim() || storyTitle;
        const newContent = lines.slice(1).join("\n").trim();

        // Update story with rewritten content and advance status
        await supabase
          .from("stories")
          .update({
            title: newTitle,
            content: newContent,
            status: "edited",
          })
          .eq("id", story.id);

        summary.rewritten++;
        console.log(`✅ Rewritten: "${storyTitle}" → "${newTitle}"`);
      } catch (storyErr) {
        console.error(`❌ Error rewriting story ${story.id}:`, storyErr);
        summary.errors++;
      }
    }

    console.log(`\n✅ Rewriter run complete:`, summary);

    return new Response(
      JSON.stringify({ success: true, ...summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Fatal error in run-ai-rewriter:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        ...summary,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
