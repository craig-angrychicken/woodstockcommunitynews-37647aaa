import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";

const MAX_STORIES_PER_RUN = 20;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🔍 run-ai-fact-checker started");

  const supabase = createSupabaseClient();

  const summary = { checked: 0, flagged: 0, errors: 0 };

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

    // Step 2: Fetch pending stories with their source artifacts
    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        content,
        story_artifacts(artifact_id, artifacts(title, content, url, source:sources(name)))
      `)
      .eq("status", "pending")
      .eq("environment", "production")
      .eq("is_test", false)
      .order("created_at", { ascending: true })
      .limit(MAX_STORIES_PER_RUN);

    if (storiesError) {
      throw new Error(`Failed to fetch stories: ${storiesError.message}`);
    }

    const storyList = stories || [];
    console.log(`📚 Found ${storyList.length} pending stories to fact-check`);

    if (storyList.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pending stories to fact-check", ...summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Fact-check each story
    for (const story of storyList) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔍 Fact-checking: "${storyTitle}" (${story.id})`);

      try {
        // Gather source material
        const sourceTexts = (story.story_artifacts as any[])
          ?.map((sa: any) => {
            const artifact = sa.artifacts;
            if (!artifact) return null;
            return `SOURCE: ${artifact.source?.name || "Unknown"}\nURL: ${artifact.url || "N/A"}\nTITLE: ${artifact.title || "N/A"}\nCONTENT: ${(artifact.content || "").substring(0, 3000)}`;
          })
          .filter(Boolean)
          .join("\n\n---\n\n") || "No source material available.";

        const prompt = `You are a fact-checker for Woodstock Community News, a local news outlet covering Woodstock, Georgia. Your job is to compare the generated news article against its source material and flag any claims that cannot be verified.

## Generated Article
HEADLINE: ${storyTitle}

${story.content || ""}

## Source Material
${sourceTexts}

## Instructions
1. Compare every factual claim in the article against the source material
2. Flag any claims, statistics, quotes, names, or details that are NOT present in or supported by the source material
3. Note any embellishments or additions beyond what the sources contain
4. If all claims are supported, say so

Respond in this format:
- If issues found: List each issue on a separate line, starting with "FLAG: "
- If all claims verified: "VERIFIED: All claims in the article are supported by the source material."
- End with a summary line: "OVERALL: [PASS/CONCERNS]"`;

        const llmResponse = await callLLM({
          prompt,
          modelConfig,
          maxTokens: 1000,
          temperature: 0.1,
          appTitle: "Woodstock Community News Fact Checker",
        });

        const factCheckResult = llmResponse.content.trim();
        console.log(`📋 Fact-check result for "${storyTitle}": ${factCheckResult.substring(0, 200)}`);

        const hasFlags = factCheckResult.includes("FLAG:") || factCheckResult.includes("CONCERNS");

        // Store fact-check notes and advance status
        await supabase
          .from("stories")
          .update({
            status: "fact_checked",
            fact_check_notes: factCheckResult,
          })
          .eq("id", story.id);

        summary.checked++;
        if (hasFlags) summary.flagged++;

        console.log(`✅ Fact-checked: "${storyTitle}" — ${hasFlags ? "has concerns" : "all clear"}`);
      } catch (storyErr) {
        console.error(`❌ Error fact-checking story ${story.id}:`, storyErr);
        summary.errors++;
      }
    }

    console.log(`\n✅ Fact-checker run complete:`, summary);

    return new Response(
      JSON.stringify({ success: true, ...summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Fatal error in run-ai-fact-checker:", error);
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
