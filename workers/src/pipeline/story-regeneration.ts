/**
 * Story regeneration (ported from supabase/functions/regenerate-stories/index.ts).
 *
 * Re-runs the active journalism prompt against the most recent published production
 * stories' first linked artifact, updating each story in-place and resetting it to
 * `pending` so it re-enters the editorial pipeline.
 *
 * Platform changes vs the original Deno function:
 *  - No HTTP/CORS shell — exports `regenerateStories(env, { maxStories? })`.
 *  - Supabase nested-join select is replaced with explicit D1 queries.
 *  - `parseStructuredResponse` is imported from ./journalism-queue (not reimplemented).
 *  - `callLLM` takes `keys` (OpenRouter/Lovable) and a refererUrl from PUBLIC_SITE_URL.
 *  - Text-only: images are intentionally skipped (matches original behavior).
 */
import type { Env } from "../env";
import type {
  AppSettingRow,
  ArtifactRow,
  LLMModelConfig,
  PromptVersionRow,
  SourceRow,
  StoryArtifactRow,
  StoryRow,
} from "../_shared/types";
import { all, first, fromJson, run, toJson } from "../_shared/db";
import { callLLM } from "../_shared/llm-client";
import { stripEmDashes } from "../_shared/text-cleanup";
import { parseStructuredResponse } from "./journalism-queue";

const MAX_STORIES = 10;

export interface RegenerateResult {
  id: string;
  title: string;
  status: "regenerated" | "skipped" | "error";
  error?: string;
}

export interface RegenerateStoriesResponse {
  success: boolean;
  message?: string;
  regenerated?: number;
  skipped?: number;
  errors?: number;
  results: RegenerateResult[];
  error?: string;
}

export async function regenerateStories(
  env: Env,
  options: { maxStories?: number } = {},
): Promise<RegenerateStoriesResponse> {
  const limit = options.maxStories ?? MAX_STORIES;

  console.log("🔄 regenerate-stories started");

  const results: RegenerateResult[] = [];

  try {
    // Step 1: Fetch the most recent published production stories.
    const stories = await all<StoryRow>(
      env,
      `select id, title, ghost_url, hero_image_url, source_id
         from stories
        where status = 'published'
          and environment = 'production'
          and is_test = 0
        order by published_at desc
        limit ?`,
      limit,
    );

    if (!stories || stories.length === 0) {
      return { success: true, message: "No published stories found", results };
    }

    console.log(`📚 Found ${stories.length} published stories to regenerate`);

    // Step 2: Fetch active journalism prompt.
    const journalismPrompt = await first<PromptVersionRow>(
      env,
      `select * from prompt_versions
        where prompt_type = 'journalism' and is_active = 1
        limit 1`,
    );

    if (!journalismPrompt) {
      throw new Error("No active journalism prompt found");
    }

    console.log(`📝 Using journalism prompt: ${journalismPrompt.version_name}`);

    // Step 3: Fetch model config.
    const modelSettings = await first<AppSettingRow>(
      env,
      `select value from app_settings where key = 'ai_model_config' limit 1`,
    );

    if (!modelSettings) {
      throw new Error("Failed to fetch model configuration");
    }

    const modelConfig = fromJson<LLMModelConfig | null>(modelSettings.value, null);
    if (!modelConfig || !modelConfig.model_name) {
      throw new Error("No model configured");
    }

    // Step 4: Regenerate each story.
    for (const story of stories) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔄 Regenerating: "${storyTitle}" (${story.id})`);

      try {
        // Get the first linked artifact (oldest link first, mirroring the original
        // first-element semantics of the nested join).
        const storyArtifact = await first<StoryArtifactRow>(
          env,
          `select artifact_id from story_artifacts
            where story_id = ?
            order by created_at asc
            limit 1`,
          story.id,
        );

        if (!storyArtifact) {
          console.warn(`⚠️ No artifacts linked to story ${story.id}, skipping`);
          results.push({ id: story.id, title: storyTitle, status: "skipped", error: "No linked artifacts" });
          continue;
        }

        const artifact = await first<ArtifactRow>(
          env,
          `select id, title, name, date, url, content, hero_image_url, images, source_id
             from artifacts
            where id = ?
            limit 1`,
          storyArtifact.artifact_id,
        );

        if (!artifact) {
          console.warn(`⚠️ Artifact data missing for story ${story.id}, skipping`);
          results.push({ id: story.id, title: storyTitle, status: "skipped", error: "Artifact data missing" });
          continue;
        }

        // Build prompt the same way process-journalism-queue-item does.
        let sourceName = "Unknown Source";
        if (artifact.source_id) {
          const source = await first<SourceRow>(
            env,
            `select name from sources where id = ? limit 1`,
            artifact.source_id,
          );
          if (source?.name) sourceName = source.name;
        }

        let contentToUse = artifact.content || "No content";
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

        // Call LLM (text-only).
        const llmResponse = await callLLM({
          prompt: fullPrompt,
          modelConfig,
          keys: {
            openRouterApiKey: env.OPENROUTER_API_KEY,
            lovableApiKey: env.LOVABLE_API_KEY,
            refererUrl: env.PUBLIC_SITE_URL,
          },
          maxTokens: 5000,
          temperature: 0.6,
          appTitle: "Woodstock Community News AI Journalist",
        });

        const storyContent = llmResponse.content || "No content generated";
        const parsed = parseStructuredResponse(storyContent);

        // Check for skip.
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

        // Extract title, content, and structured metadata.
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

        // Strip em/en dashes from reader-facing fields — classic AI tell.
        newTitle = stripEmDashes(newTitle);
        newContent = stripEmDashes(newContent);
        if (structuredMetadata) {
          structuredMetadata.subhead = stripEmDashes(
            structuredMetadata.subhead as string | null,
          );
          structuredMetadata.byline = stripEmDashes(
            structuredMetadata.byline as string | null,
          );
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

        // Update the story in-place (preserve ghost_url, source_id, hero_image_url, etc.).
        await run(
          env,
          `update stories set
              title = ?,
              content = ?,
              structured_metadata = ?,
              word_count = ?,
              generation_metadata = ?,
              prompt_version_id = ?,
              status = 'pending',
              fact_check_notes = NULL,
              publish_attempts = 0,
              updated_at = ?
            where id = ?`,
          newTitle,
          newContent,
          structuredMetadata ? toJson(structuredMetadata) : null,
          wordCount,
          toJson(generationMetadata),
          journalismPrompt.id,
          new Date().toISOString(),
          story.id,
        );

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

    console.log(
      `\n✅ Regeneration complete: ${regenerated} regenerated, ${skipped} skipped, ${errors} errors`,
    );

    return { success: true, regenerated, skipped, errors, results };
  } catch (error) {
    console.error("💥 Fatal error in regenerate-stories:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      results,
    };
  }
}
