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
        story_artifacts(artifact_id, artifacts(title, content, url, hero_image_url, images, source:sources(name)))
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
        // Gather source material and images
        const imageUrls: string[] = [];
        const sourceTexts = (story.story_artifacts as Array<Record<string, unknown>>)
          ?.map((sa: Record<string, unknown>) => {
            const artifact = sa.artifacts;
            if (!artifact) return null;

            // Collect images from this artifact for multimodal fact-checking
            if (artifact.hero_image_url?.includes('supabase.co/storage')) {
              imageUrls.push(artifact.hero_image_url);
            }
            for (const img of artifact.images || []) {
              if (img && typeof img === 'object' && img.stored_url && !img.download_failed) {
                imageUrls.push(img.stored_url);
              }
            }

            return `SOURCE: ${artifact.source?.name || "Unknown"}\nURL: ${artifact.url || "N/A"}\nTITLE: ${artifact.title || "N/A"}\nCONTENT: ${(artifact.content || "").substring(0, 3000)}`;
          })
          .filter(Boolean)
          .join("\n\n---\n\n") || "No source material available.";

        const promptText = `You are a fact-checker for Woodstock Community News, a local news outlet covering Woodstock, Georgia and Cherokee County. Your job is to compare the generated news article against its source material and flag ONLY genuinely problematic claims.

## Generated Article
HEADLINE: ${storyTitle}

${story.content || ""}

## Source Material
${sourceTexts}

## Instructions
1. Compare factual claims in the article against the source material — this includes BOTH the text above AND any attached images
2. Source material includes text AND attached images. Details visible in images (dates, times, locations, names, addresses, event details on flyers/posters, etc.) are VALID source material. Do NOT flag claims that are supported by information visible in an image.
3. ONLY flag these kinds of problems:
   - Fabricated quotes attributed to real people
   - Invented statistics, dollar amounts, or specific numbers not in the source
   - Made-up partnerships, agreements, or organizational relationships
   - Specific factual claims that appear incorrect (wrong dates, wrong names, wrong locations)
4. Do NOT flag any of the following — these are expected enrichment, not errors:
   - Well-known facts about local organizations, government bodies, schools, and venues (e.g., "Cherokee County School District serves over 43,000 students", "Woodstock is located in Cherokee County")
   - General context about what organizations do, where places are located, or when they were established
   - Explanatory sentences about why something matters to local residents
   - Background context drawn from general knowledge that is factually accurate
   - Descriptions of standard processes (how Eagle Scouts earn rank, how city government works, etc.)
5. If all claims are supported or represent reasonable enrichment, say so. Err on the side of PASS — the rewriter stage will handle quality improvements.

Respond in this format:
- If issues found: List each issue on a separate line, starting with "FLAG: "
- If all claims verified: "VERIFIED: All claims in the article are supported by the source material."
- End with a summary line: "OVERALL: [PASS/CONCERNS]"`;

        // Build multimodal prompt if images are available
        const prompt: string | Array<{ type: string; text?: string; image_url?: { url: string } }> =
          imageUrls.length > 0
            ? [
                { type: "text", text: promptText },
                ...imageUrls.map(url => ({ type: "image_url" as const, image_url: { url } })),
              ]
            : promptText;

        if (imageUrls.length > 0) {
          console.log(`📷 Including ${imageUrls.length} source image(s) for fact-checking`);
        }

        const llmResponse = await callLLM({
          prompt,
          modelConfig,
          maxTokens: 1000,
          temperature: 0.1,
          appTitle: "Woodstock Community News Fact Checker",
        });

        const factCheckResult = llmResponse.content.trim();
        console.log(`📋 Fact-check result for "${storyTitle}": ${factCheckResult.substring(0, 200)}`);

        const upperResult = factCheckResult.toUpperCase();
        const hasFlags = upperResult.includes("FLAG:") || upperResult.includes("CONCERNS");

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
