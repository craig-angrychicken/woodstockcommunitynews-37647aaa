import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";
import { stripEmDashes } from "../_shared/text-cleanup.ts";

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

    // Step 2: Fetch fact_checked stories with their source artifacts (for images)
    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        content,
        fact_check_notes,
        structured_metadata,
        story_artifacts(artifact_id, artifacts(hero_image_url, images))
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

        // Collect images from source artifacts
        const imageUrls: string[] = [];
        for (const sa of (story.story_artifacts as Array<Record<string, unknown>>) || []) {
          const artifact = sa.artifacts;
          if (!artifact) continue;
          if (artifact.hero_image_url?.includes('supabase.co/storage')) {
            imageUrls.push(artifact.hero_image_url);
          }
          for (const img of artifact.images || []) {
            if (img && typeof img === 'object' && img.stored_url && !img.download_failed) {
              imageUrls.push(img.stored_url);
            }
          }
        }

        if (imageUrls.length > 0) {
          console.log(`📷 Including ${imageUrls.length} source image(s) for rewriting context`);
        }

        const promptText = `You are a senior editor at Woodstock Community News. Your job is to take this draft article and make it the best version of itself.

## Current Article
HEADLINE: ${storyTitle}

${story.content || ""}
${factCheckFeedback}

## Instructions
1. If the fact-checker flagged issues: remove or hedge claims that are truly unsupported by ANY source material (text or images). Source material includes BOTH text and attached images — details visible in images (dates, times, locations, names, addresses, event details on flyers/posters, etc.) are VALID and should be RETAINED.
2. Improve narrative flow — vary sentence structure, eliminate generic filler ("The district has prioritized...", "Such events offer an opportunity..."), and add smooth transitions between paragraphs.
3. Ensure every story answers: "Why should a Cherokee County resident care about this?"
4. Improve the headline if it is weak or clickbait-y
5. Ensure AP style consistency
6. Keep the factual core intact. Never invent quotes, statistics, or specific claims.

## CRITICAL: Do NOT fabricate details
Do NOT add geographic details, locations, directional references, distances, neighborhood descriptions, or any other specific claims that are not in the source material or the existing article. For example, do not describe where a park is relative to a street, which end of a road something is on, or how far apart two places are — unless the source material explicitly states it. If you are not certain a detail comes from the source, leave it out. An accurate short article is always better than a longer article with invented details.

## Output Format
Respond with the improved article in the SAME format as the input. Start with the headline on the first line, then the article body. Keep all existing structural markers (SUBHEAD:, BYLINE:, SOURCE:) if present.`;

        // Build multimodal prompt if images are available, with fallback to text-only
        let llmResponse;
        if (imageUrls.length > 0) {
          try {
            llmResponse = await callLLM({
              prompt: [
                { type: "text", text: promptText },
                ...imageUrls.map(url => ({ type: "image_url" as const, image_url: { url } })),
              ],
              modelConfig,
              maxTokens: 5000,
              temperature: 0.6,
              appTitle: "Woodstock Community News Rewriter",
            });
          } catch (imgErr) {
            console.warn(`⚠️ LLM call with images failed, retrying text-only:`, imgErr instanceof Error ? imgErr.message : imgErr);
            llmResponse = await callLLM({
              prompt: promptText,
              modelConfig,
              maxTokens: 5000,
              temperature: 0.6,
              appTitle: "Woodstock Community News Rewriter",
            });
          }
        } else {
          llmResponse = await callLLM({
            prompt: promptText,
            modelConfig,
            maxTokens: 5000,
            temperature: 0.6,
            appTitle: "Woodstock Community News Rewriter",
          });
        }

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
            title: stripEmDashes(newTitle),
            content: stripEmDashes(newContent),
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
