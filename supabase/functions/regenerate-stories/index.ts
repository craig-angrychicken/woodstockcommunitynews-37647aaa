import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";

interface StructuredStoryResponse {
  headline: string;
  subhead?: string;
  byline?: string;
  source_name?: string;
  source_url?: string;
  body: string[] | string;
  skip?: boolean;
  skip_reason?: string | null;
}

function parseStructuredResponse(content: string): StructuredStoryResponse | null {
  try {
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.skip === true) return parsed as StructuredStoryResponse;
    if (!parsed.headline || (!parsed.body && !Array.isArray(parsed.body))) return null;
    return parsed as StructuredStoryResponse;
  } catch {
    return null;
  }
}

const MAX_STORIES = 10;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🔄 regenerate-stories started");

  const supabase = createSupabaseClient();
  const results: Array<{ id: string; title: string; status: string; error?: string }> = [];

  try {
    // Step 1: Fetch the 10 most recent published production stories with their artifacts
    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        ghost_url,
        hero_image_url,
        source_id,
        story_artifacts(
          artifact_id,
          artifacts(
            id,
            title,
            name,
            date,
            url,
            content,
            hero_image_url,
            images,
            source_id,
            sources(name)
          )
        )
      `)
      .eq("status", "published")
      .eq("environment", "production")
      .eq("is_test", false)
      .order("published_at", { ascending: false })
      .limit(MAX_STORIES);

    if (storiesError) {
      throw new Error(`Failed to fetch stories: ${storiesError.message}`);
    }

    if (!stories || stories.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No published stories found", results }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📚 Found ${stories.length} published stories to regenerate`);

    // Step 2: Fetch active journalism prompt (v5)
    const { data: journalismPrompt, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("prompt_type", "journalism")
      .eq("is_active", true)
      .single();

    if (promptError || !journalismPrompt) {
      throw new Error("No active journalism prompt found");
    }

    console.log(`📝 Using journalism prompt: ${journalismPrompt.version_name}`);

    // Step 3: Fetch model config
    const { data: modelSettings, error: settingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_model_config")
      .single();

    if (settingsError || !modelSettings) {
      throw new Error("Failed to fetch model configuration");
    }

    const modelConfig = modelSettings.value as { model_name: string; model_provider: string };
    if (!modelConfig.model_name) {
      throw new Error("No model configured");
    }

    // Step 4: Regenerate each story
    for (const story of stories) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔄 Regenerating: "${storyTitle}" (${story.id})`);

      try {
        // Get the first linked artifact
        const storyArtifacts = story.story_artifacts as Array<Record<string, unknown>>;
        if (!storyArtifacts || storyArtifacts.length === 0) {
          console.warn(`⚠️ No artifacts linked to story ${story.id}, skipping`);
          results.push({ id: story.id, title: storyTitle, status: "skipped", error: "No linked artifacts" });
          continue;
        }

        const artifact = storyArtifacts[0].artifacts as Record<string, unknown>;
        if (!artifact) {
          console.warn(`⚠️ Artifact data missing for story ${story.id}, skipping`);
          results.push({ id: story.id, title: storyTitle, status: "skipped", error: "Artifact data missing" });
          continue;
        }

        // Build prompt the same way process-journalism-queue-item does
        const sourceName = (artifact.sources as Record<string, unknown>)?.name || "Unknown Source";
        let contentToUse = (artifact.content as string) || "No content";
        if (contentToUse.length > 20000) {
          contentToUse = contentToUse.substring(0, 20000) + "\n\n[Content truncated due to length...]";
        }

        const artifactData = `
Title: ${artifact.title || artifact.name}
Date: ${artifact.date}
Source: ${sourceName}
URL: ${artifact.url || "Not available"}
Content: ${contentToUse}
`;

        const fullPrompt = `${journalismPrompt.content}

## Artifact:
${artifactData}`;

        // Skip images for regeneration — storage images are cleaned up after initial
        // publish and external CDN URLs (Facebook, Instagram) expire quickly.

        // Call LLM (text-only)
        const llmResponse = await callLLM({
          prompt: fullPrompt,
          modelConfig,
          maxTokens: 5000,
          temperature: 0.6,
          appTitle: "Woodstock Community News AI Journalist",
        });

        const storyContent = llmResponse.content || "No content generated";
        const parsed = parseStructuredResponse(storyContent);

        // Check for skip
        const isSkip = parsed
          ? parsed.skip === true
          : storyContent.trim().toUpperCase().startsWith("SKIP:");

        if (isSkip) {
          const skipReason = parsed
            ? (parsed.skip_reason || "Insufficient source material")
            : storyContent.trim().slice(5).trim();
          console.warn(`⏭️ LLM skipped story ${story.id}: ${skipReason}`);
          results.push({ id: story.id, title: storyTitle, status: "skipped", error: skipReason });
          continue;
        }

        // Extract title, content, and structured metadata
        let newTitle: string;
        let newContent: string;
        let structuredMetadata: Record<string, unknown> | null = null;

        if (parsed) {
          newTitle = parsed.headline || "Untitled Story";
          newContent = Array.isArray(parsed.body)
            ? parsed.body.join("\n\n")
            : (parsed.body || "");
          structuredMetadata = {
            subhead: parsed.subhead || null,
            byline: parsed.byline || null,
            source_name: parsed.source_name || null,
            source_url: parsed.source_url || null,
          };
        } else {
          const lines = storyContent.split("\n").filter((line: string) => line.trim());
          newTitle = lines[0]
            .replace(/^#+\s*/, "")
            .replace(/^HEADLINE:\s*/i, "")
            .trim() || "Untitled Story";
          newContent = lines.slice(1).join("\n").trim();
        }

        const wordCount = newContent.split(/\s+/).filter((w: string) => w.length > 0).length;

        const generationMetadata = {
          model: llmResponse.model || modelConfig.model_name,
          provider: modelConfig.model_provider,
          prompt_tokens: llmResponse.usage?.prompt_tokens || null,
          completion_tokens: llmResponse.usage?.completion_tokens || null,
          total_tokens: llmResponse.usage?.total_tokens || null,
          prompt_version_id: journalismPrompt.id,
          regenerated_at: new Date().toISOString(),
        };

        // Update the story in-place (preserve ghost_url, source_id, hero_image_url, etc.)
        const { error: updateError } = await supabase
          .from("stories")
          .update({
            title: newTitle,
            content: newContent,
            structured_metadata: structuredMetadata,
            word_count: wordCount,
            generation_metadata: generationMetadata,
            prompt_version_id: journalismPrompt.id,
            status: "pending",
            fact_check_notes: null,
            publish_attempts: 0,
          })
          .eq("id", story.id);

        if (updateError) {
          throw new Error(`Failed to update story: ${updateError.message}`);
        }

        console.log(`✅ Regenerated: "${newTitle}" (${wordCount} words) → status=pending`);
        results.push({ id: story.id, title: newTitle, status: "regenerated" });
      } catch (storyErr) {
        const errMsg = storyErr instanceof Error ? storyErr.message : "Unknown error";
        console.error(`❌ Error regenerating story ${story.id}:`, storyErr);
        results.push({ id: story.id, title: storyTitle, status: "error", error: errMsg });
      }
    }

    const regenerated = results.filter((r) => r.status === "regenerated").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const errors = results.filter((r) => r.status === "error").length;

    console.log(`\n✅ Regeneration complete: ${regenerated} regenerated, ${skipped} skipped, ${errors} errors`);

    return new Response(
      JSON.stringify({ success: true, regenerated, skipped, errors, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Fatal error in regenerate-stories:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        results,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
