/**
 * Editorial pipeline (ported from supabase/functions/run-ai-fact-checker,
 * run-ai-rewriter, and run-ai-editor).
 *
 * Platform changes vs the Deno originals:
 *  - Supabase client + nested PostgREST joins are replaced by explicit D1 queries
 *    (stories → story_artifacts → artifacts → sources). Booleans are INTEGER 0/1.
 *  - Model config is read from app_settings key 'ai_model_config' (JSON).
 *  - callLLM now takes a `keys` object (OpenRouter/Lovable keys + referer URL).
 *  - Images live on R2 as relative `/images/<key>` paths. The old
 *    "only supabase.co/storage images" filter becomes "stored_url starts with
 *    `/images/` and !download_failed". For LLM vision the URLs are made absolute
 *    via `new URL(storedUrl, env.PUBLIC_SITE_URL).toString()`.
 *  - run-ai-editor's `supabase.functions.invoke("publish-story", ...)` becomes a
 *    direct import of `publishStory` from ./publish-story.
 *  - Transport-agnostic: each function returns a plain summary object instead of a
 *    Response; routing/cron wiring is added by the orchestrator.
 */
import type { Env } from "../env";
import type { StoryRow, PromptVersionRow, AppSettingRow, StoredImage, LLMModelConfig } from "../_shared/types";
import { all, first, run, fromJson } from "../_shared/db";
import { callLLM } from "../_shared/llm-client";
import { stripEmDashes } from "../_shared/text-cleanup";
import { publishStory } from "./publish-story";

const MAX_STORIES_PER_RUN = 20;

export interface FactCheckerSummary {
  success: boolean;
  message?: string;
  checked: number;
  flagged: number;
  errors: number;
  error?: string;
}

export interface RewriterSummary {
  success: boolean;
  message?: string;
  rewritten: number;
  errors: number;
  error?: string;
}

export interface EditorSummary {
  success: boolean;
  message?: string;
  published: number;
  rejected: number;
  featured: number;
  skipped: number;
  errors: number;
  facebook_posted: number;
  facebook_failed: number;
  error?: string;
}

export interface EditorialPipelineResult {
  success: boolean;
  factChecker: FactCheckerSummary;
  rewriter: RewriterSummary;
  editor: EditorSummary;
}

/** LLM API keys + referer pulled from the worker env (callLLM no longer reads them itself). */
function llmKeys(env: Env) {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY,
    lovableApiKey: env.LOVABLE_API_KEY,
    refererUrl: env.PUBLIC_SITE_URL,
  };
}

/** Read the active model config from app_settings (key 'ai_model_config'). */
async function getModelConfig(env: Env): Promise<LLMModelConfig> {
  const setting = await first<AppSettingRow>(
    env,
    `select value from app_settings where key = ?`,
    "ai_model_config",
  );
  if (!setting) {
    throw new Error("Failed to fetch model configuration");
  }
  return fromJson<LLMModelConfig>(setting.value, { model_name: "", model_provider: "" });
}

/**
 * Decide whether an R2-served image should be sent to an LLM for vision.
 * Old rule: only supabase.co/storage URLs (external CDN URLs expire).
 * New rule: only images whose stored_url is a relative /images/ R2 path.
 */
function isVisionEligible(storedUrl: string | null | undefined): storedUrl is string {
  return typeof storedUrl === "string" && storedUrl.startsWith("/images/");
}

/** Convert a relative /images/ path to an absolute HTTPS URL for LLM vision. */
function toAbsoluteImageUrl(env: Env, storedUrl: string): string {
  return new URL(storedUrl, env.PUBLIC_SITE_URL).toString();
}

interface StoryArtifactJoin {
  artifact_id: string;
  title: string | null;
  content: string | null;
  url: string | null;
  hero_image_url: string | null;
  images: string | null; // JSON StoredImage[]
  source_name: string | null;
}

/** Fetch the source artifacts (joined to their source) for a story, ordered for stable output. */
async function getStoryArtifacts(env: Env, storyId: string): Promise<StoryArtifactJoin[]> {
  return all<StoryArtifactJoin>(
    env,
    `select sa.artifact_id as artifact_id,
            a.title as title,
            a.content as content,
            a.url as url,
            a.hero_image_url as hero_image_url,
            a.images as images,
            s.name as source_name
       from story_artifacts sa
       join artifacts a on a.id = sa.artifact_id
       left join sources s on s.id = a.source_id
      where sa.story_id = ?
      order by sa.created_at asc`,
    storyId,
  );
}

// ---------------------------------------------------------------------------
// Fact checker (← run-ai-fact-checker)
// ---------------------------------------------------------------------------

export async function runFactChecker(env: Env, _opts?: Record<string, unknown>): Promise<FactCheckerSummary> {
  console.log("🔍 run-ai-fact-checker started");

  const summary: FactCheckerSummary = { success: true, checked: 0, flagged: 0, errors: 0 };

  try {
    const modelConfig = await getModelConfig(env);

    const stories = await all<Pick<StoryRow, "id" | "title" | "content">>(
      env,
      `select id, title, content
         from stories
        where status = ?
          and environment = ?
          and is_test = 0
        order by created_at asc
        limit ?`,
      "pending",
      "production",
      MAX_STORIES_PER_RUN,
    );

    console.log(`📚 Found ${stories.length} pending stories to fact-check`);

    if (stories.length === 0) {
      return { ...summary, message: "No pending stories to fact-check" };
    }

    for (const story of stories) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔍 Fact-checking: "${storyTitle}" (${story.id})`);

      try {
        const artifacts = await getStoryArtifacts(env, story.id);

        // Gather source material and images for multimodal fact-checking.
        const imageUrls: string[] = [];
        const sourceTexts =
          artifacts
            .map((artifact) => {
              // Collect images from this artifact (R2-served /images/ paths only).
              if (isVisionEligible(artifact.hero_image_url)) {
                imageUrls.push(toAbsoluteImageUrl(env, artifact.hero_image_url));
              }
              const images = fromJson<StoredImage[]>(artifact.images, []);
              for (const img of images || []) {
                if (img && typeof img === "object" && img.stored_url && !img.download_failed) {
                  if (isVisionEligible(img.stored_url)) {
                    imageUrls.push(toAbsoluteImageUrl(env, img.stored_url));
                  }
                }
              }

              return `SOURCE: ${artifact.source_name || "Unknown"}\nURL: ${artifact.url || "N/A"}\nTITLE: ${artifact.title || "N/A"}\nCONTENT: ${(artifact.content || "").substring(0, 3000)}`;
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
   - Geographic or spatial claims that appear fabricated — e.g., describing where a place is relative to a street, which end of a road something is on, or what "anchors" an area. These are high-risk for AI hallucination and should be flagged unless you are confident the detail is correct.
4. Do NOT flag any of the following — these are expected enrichment, not errors:
   - Well-known facts about local organizations, government bodies, schools, and venues (e.g., "Cherokee County School District serves over 43,000 students", "Woodstock is located in Cherokee County")
   - General context about what organizations do or when they were established
   - Explanatory sentences about why something matters to local residents
   - Background context drawn from general knowledge that is factually accurate
   - Descriptions of standard processes (how Eagle Scouts earn rank, how city government works, etc.)
5. If all claims are supported or represent reasonable enrichment, say so. Err on the side of PASS — but always flag suspect geographic/spatial details.

Respond in this format:
- If issues found: List each issue on a separate line, starting with "FLAG: "
- If all claims verified: "VERIFIED: All claims in the article are supported by the source material."
- End with a summary line: "OVERALL: [PASS/CONCERNS]"`;

        // Build multimodal prompt if images are available, with fallback to text-only.
        let llmResponse;
        if (imageUrls.length > 0) {
          console.log(`📷 Including ${imageUrls.length} source image(s) for fact-checking`);
          try {
            llmResponse = await callLLM({
              prompt: [
                { type: "text", text: promptText },
                ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
              ],
              modelConfig,
              keys: llmKeys(env),
              maxTokens: 1000,
              temperature: 0.1,
              appTitle: "Woodstock Community News Fact Checker",
            });
          } catch (imgErr) {
            console.warn(
              `⚠️ LLM call with images failed, retrying text-only:`,
              imgErr instanceof Error ? imgErr.message : imgErr,
            );
            llmResponse = await callLLM({
              prompt: promptText,
              modelConfig,
              keys: llmKeys(env),
              maxTokens: 1000,
              temperature: 0.1,
              appTitle: "Woodstock Community News Fact Checker",
            });
          }
        } else {
          llmResponse = await callLLM({
            prompt: promptText,
            modelConfig,
            keys: llmKeys(env),
            maxTokens: 1000,
            temperature: 0.1,
            appTitle: "Woodstock Community News Fact Checker",
          });
        }

        const factCheckResult = llmResponse.content.trim();
        console.log(`📋 Fact-check result for "${storyTitle}": ${factCheckResult.substring(0, 200)}`);

        const upperResult = factCheckResult.toUpperCase();
        const hasFlags = upperResult.includes("FLAG:") || upperResult.includes("CONCERNS");

        // Store fact-check notes and advance status.
        await run(
          env,
          `update stories set status = ?, fact_check_notes = ?, updated_at = ? where id = ?`,
          "fact_checked",
          factCheckResult,
          new Date().toISOString(),
          story.id,
        );

        summary.checked++;
        if (hasFlags) summary.flagged++;

        console.log(`✅ Fact-checked: "${storyTitle}" — ${hasFlags ? "has concerns" : "all clear"}`);
      } catch (storyErr) {
        console.error(`❌ Error fact-checking story ${story.id}:`, storyErr);
        summary.errors++;
      }
    }

    console.log(`\n✅ Fact-checker run complete:`, summary);
    return summary;
  } catch (error) {
    console.error("💥 Fatal error in run-ai-fact-checker:", error);
    return {
      ...summary,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Rewriter (← run-ai-rewriter)
// ---------------------------------------------------------------------------

export async function runRewriter(env: Env, _opts?: Record<string, unknown>): Promise<RewriterSummary> {
  console.log("✏️ run-ai-rewriter started");

  const summary: RewriterSummary = { success: true, rewritten: 0, errors: 0 };

  try {
    const modelConfig = await getModelConfig(env);

    const stories = await all<Pick<StoryRow, "id" | "title" | "content" | "fact_check_notes" | "structured_metadata">>(
      env,
      `select id, title, content, fact_check_notes, structured_metadata
         from stories
        where status = ?
          and environment = ?
          and is_test = 0
        order by created_at asc
        limit ?`,
      "fact_checked",
      "production",
      MAX_STORIES_PER_RUN,
    );

    console.log(`📚 Found ${stories.length} fact-checked stories to rewrite`);

    if (stories.length === 0) {
      return { ...summary, message: "No fact-checked stories to rewrite" };
    }

    for (const story of stories) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n✏️ Rewriting: "${storyTitle}" (${story.id})`);

      try {
        const factCheckFeedback = story.fact_check_notes
          ? `\n\n## Fact-Check Feedback\n${story.fact_check_notes}`
          : "";

        // Collect images from source artifacts (R2-served /images/ paths only).
        const artifacts = await getStoryArtifacts(env, story.id);
        const imageUrls: string[] = [];
        for (const artifact of artifacts) {
          if (isVisionEligible(artifact.hero_image_url)) {
            imageUrls.push(toAbsoluteImageUrl(env, artifact.hero_image_url));
          }
          const images = fromJson<StoredImage[]>(artifact.images, []);
          for (const img of images || []) {
            if (img && typeof img === "object" && img.stored_url && !img.download_failed) {
              if (isVisionEligible(img.stored_url)) {
                imageUrls.push(toAbsoluteImageUrl(env, img.stored_url));
              }
            }
          }
        }

        if (imageUrls.length > 0) {
          console.log(`📷 Including ${imageUrls.length} source image(s) for rewriting context`);
        }

        const promptText = `You are a senior editor at Woodstock Community News — a veteran journalist who knows Woodstock, Georgia and Cherokee County inside out. Your job is to take this draft article and make it the best version of itself: not just fix errors, but enrich and elevate.

## Current Article
HEADLINE: ${storyTitle}

${story.content || ""}
${factCheckFeedback}

## Instructions
1. If the fact-checker flagged issues: remove or hedge claims that are truly unsupported by ANY source material (text or images). Source material includes BOTH text and attached images — details visible in images (dates, times, locations, names, addresses, event details on flyers/posters, etc.) are VALID and should be RETAINED.
2. ADD community context where it is missing: explain what organizations do, why this matters to local residents, and how it connects to broader community patterns.
3. Improve narrative flow — vary sentence structure, eliminate generic filler ("The district has prioritized...", "Such events offer an opportunity..."), and add smooth transitions between paragraphs.
4. If the article is thin (under 150 words), expand it with well-established factual context about the people, places, or organizations mentioned. A rich, informative article is the goal.
5. Ensure every story answers: "Why should a Cherokee County resident care about this?"
6. Improve the headline if it is weak or clickbait-y
7. Ensure AP style consistency
8. Keep the factual core intact — enrich, don't fabricate. Never invent quotes, statistics, or specific claims.

## IMPORTANT: Do not guess at geography
Do NOT add geographic or spatial details you are not certain about — do not describe where a place is relative to a street, which end of a road something is on, which direction something faces, or how far apart two places are, unless you are highly confident the detail is correct. Getting a geographic detail wrong in a local publication is immediately obvious to readers and destroys credibility. When in doubt, leave it out.

## Output Format
Respond with the improved article in the SAME format as the input. Start with the headline on the first line, then the article body. Keep all existing structural markers (SUBHEAD:, BYLINE:, SOURCE:) if present.`;

        // Build multimodal prompt if images are available, with fallback to text-only.
        let llmResponse;
        if (imageUrls.length > 0) {
          try {
            llmResponse = await callLLM({
              prompt: [
                { type: "text", text: promptText },
                ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
              ],
              modelConfig,
              keys: llmKeys(env),
              maxTokens: 5000,
              temperature: 0.6,
              appTitle: "Woodstock Community News Rewriter",
            });
          } catch (imgErr) {
            console.warn(
              `⚠️ LLM call with images failed, retrying text-only:`,
              imgErr instanceof Error ? imgErr.message : imgErr,
            );
            llmResponse = await callLLM({
              prompt: promptText,
              modelConfig,
              keys: llmKeys(env),
              maxTokens: 5000,
              temperature: 0.6,
              appTitle: "Woodstock Community News Rewriter",
            });
          }
        } else {
          llmResponse = await callLLM({
            prompt: promptText,
            modelConfig,
            keys: llmKeys(env),
            maxTokens: 5000,
            temperature: 0.6,
            appTitle: "Woodstock Community News Rewriter",
          });
        }

        const rewrittenContent = llmResponse.content.trim();

        // Extract new title (first line).
        const lines = rewrittenContent.split("\n").filter((l: string) => l.trim());
        const rawTitle = lines[0] || "";
        const newTitle =
          rawTitle
            .replace(/^#+\s*/, "")
            .replace(/^HEADLINE:\s*/i, "")
            .replace(/^TITLE:\s*/i, "")
            .replace(/^\*\*(.+)\*\*$/, "$1")
            .replace(/^["'](.+)["']$/, "$1")
            .trim() || storyTitle;
        const newContent = lines.slice(1).join("\n").trim();

        // Update story with rewritten content and advance status.
        await run(
          env,
          `update stories set title = ?, content = ?, status = ?, updated_at = ? where id = ?`,
          stripEmDashes(newTitle),
          stripEmDashes(newContent),
          "edited",
          new Date().toISOString(),
          story.id,
        );

        summary.rewritten++;
        console.log(`✅ Rewritten: "${storyTitle}" → "${newTitle}"`);
      } catch (storyErr) {
        console.error(`❌ Error rewriting story ${story.id}:`, storyErr);
        summary.errors++;
      }
    }

    console.log(`\n✅ Rewriter run complete:`, summary);
    return summary;
  } catch (error) {
    console.error("💥 Fatal error in run-ai-rewriter:", error);
    return {
      ...summary,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Editor (← run-ai-editor)
// ---------------------------------------------------------------------------

export async function runEditor(env: Env, _opts?: Record<string, unknown>): Promise<EditorSummary> {
  console.log("🖊️ run-ai-editor started");

  const summary: EditorSummary = {
    success: true,
    published: 0,
    rejected: 0,
    featured: 0,
    skipped: 0,
    errors: 0,
    facebook_posted: 0,
    facebook_failed: 0,
  };

  try {
    // Step 1: Fetch active editor prompt.
    const editorPrompt = await first<PromptVersionRow>(
      env,
      `select * from prompt_versions where prompt_type = ? and is_active = 1 limit 1`,
      "editor",
    );

    if (!editorPrompt) {
      throw new Error("No active editor prompt found");
    }

    console.log(`📝 Using editor prompt: ${editorPrompt.version_name}`);

    // Step 2: Fetch model config.
    const modelConfig = await getModelConfig(env);

    if (!modelConfig.model_name) {
      throw new Error("No model configured");
    }

    // Step 3: Fetch edited production stories (excludes those with 3+ failed publish attempts).
    const storyList = await all<Pick<StoryRow, "id" | "title" | "content" | "publish_attempts">>(
      env,
      `select id, title, content, publish_attempts
         from stories
        where status = ?
          and environment = ?
          and is_test = 0
          and publish_attempts < 3
        order by created_at asc
        limit ?`,
      "edited",
      "production",
      MAX_STORIES_PER_RUN,
    );

    console.log(`📚 Found ${storyList.length} pending stories to evaluate`);

    // Query recent featured count for context.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const featuredRow = await first<{ count: number }>(
      env,
      `select count(*) as count
         from stories
        where featured = 1
          and status = ?
          and published_at >= ?`,
      "published",
      sevenDaysAgo.toISOString(),
    );

    const featuredThisWeek = featuredRow?.count || 0;
    console.log(`⭐ Featured stories in last 7 days: ${featuredThisWeek}`);

    if (storyList.length === 0) {
      return { ...summary, message: "No pending stories to evaluate" };
    }

    // Step 4: Evaluate each story.
    for (const story of storyList) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔍 Evaluating: "${storyTitle}" (${story.id})`);

      try {
        // Build evaluation prompt with featured context.
        const featuredContext = `\n\nFEATURED CONTEXT: ${featuredThisWeek} stories have been featured in the last 7 days. ${
          featuredThisWeek === 0
            ? "The featured section is EMPTY — be more willing to feature a high-impact story."
            : "The minimum of 1/week is met; only feature truly standout community stories."
        }`;

        const fullPrompt = `${editorPrompt.content}${featuredContext}

HEADLINE: ${storyTitle}

${story.content || ""}`;

        // Call LLM via shared client.
        const llmResponse = await callLLM({
          prompt: fullPrompt,
          modelConfig,
          keys: llmKeys(env),
          maxTokens: 200,
          temperature: 0.2,
          appTitle: "Woodstock Community News AI Editor",
        });

        const verdict = llmResponse.content.trim();

        console.log(`📋 Verdict for "${storyTitle}": ${verdict.substring(0, 100)}`);

        const upperVerdict = verdict.toUpperCase().trim();
        const isFeatured = upperVerdict === "PUBLISH_FEATURED";
        const isPublish = upperVerdict === "PUBLISH" || isFeatured;

        if (isPublish) {
          // Invoke publish-story (handles slug, status, revalidation, and Facebook).
          let publishData: { success?: boolean; url?: string; slug?: string; error?: string } | null = null;
          let publishErrorMessage: string | null = null;
          try {
            publishData = await publishStory(env, story.id, isFeatured);
          } catch (publishErr) {
            publishErrorMessage = publishErr instanceof Error ? publishErr.message : "Unknown publish error";
          }

          if (publishErrorMessage || !publishData?.success) {
            const errMsg = publishErrorMessage || publishData?.error || "Unknown publish error";
            const attempts = (story.publish_attempts || 0) + 1;
            console.error(`❌ Publish failed for story ${story.id} (attempt ${attempts}/3): ${errMsg}`);
            await run(
              env,
              `update stories set publish_attempts = ?, updated_at = ? where id = ?`,
              attempts,
              new Date().toISOString(),
              story.id,
            );
            summary.errors++;
            continue;
          }

          console.log(
            `${isFeatured ? "⭐" : "✅"} Published${isFeatured ? " (featured)" : ""}: "${storyTitle}" → ${publishData.url}`,
          );
          summary.published++;
          if (isFeatured) summary.featured++;
        } else if (upperVerdict.startsWith("REJECT:")) {
          const reason = verdict.slice(7).trim();

          await run(
            env,
            `update stories set status = ?, editor_notes = ?, updated_at = ? where id = ?`,
            "rejected",
            reason,
            new Date().toISOString(),
            story.id,
          );

          console.log(`🚫 Rejected: "${storyTitle}" — ${reason}`);
          summary.rejected++;
        } else {
          // Unexpected response — fail-safe, leave as pending.
          console.warn(
            `⚠️ Unexpected verdict for story ${story.id}: "${verdict.substring(0, 100)}" — leaving as pending`,
          );
          summary.skipped++;
        }
      } catch (storyErr) {
        console.error(`❌ Error evaluating story ${story.id}:`, storyErr);
        summary.errors++;
        // Leave as pending.
      }
    }

    console.log(`\n✅ AI Editor run complete:`, summary);
    return summary;
  } catch (error) {
    console.error("💥 Fatal error in run-ai-editor:", error);
    return {
      ...summary,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Full pipeline orchestration
// ---------------------------------------------------------------------------

/**
 * Run the full editorial pipeline in stage order: fact-check pending stories,
 * rewrite fact-checked stories, then evaluate/publish edited stories. Each stage
 * advances story status, so running them sequentially flows stories end-to-end.
 */
export async function runEditorialPipeline(env: Env): Promise<EditorialPipelineResult> {
  console.log("📰 Editorial pipeline started");

  const factChecker = await runFactChecker(env);
  const rewriter = await runRewriter(env);
  const editor = await runEditor(env);

  const result: EditorialPipelineResult = {
    success: factChecker.success && rewriter.success && editor.success,
    factChecker,
    rewriter,
    editor,
  };

  console.log("✅ Editorial pipeline complete:", {
    checked: factChecker.checked,
    rewritten: rewriter.rewritten,
    published: editor.published,
  });

  return result;
}
