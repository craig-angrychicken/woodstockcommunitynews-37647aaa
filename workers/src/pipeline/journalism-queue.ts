/**
 * AI Journalist queue: builds the per-run queue and converts one artifact at a
 * time into a story.
 *
 * Notes:
 *  - These are plain async functions wired to a Cloudflare Queue + routes.
 *  - Chaining is handled by the Queue consumer: each call processes exactly one
 *    queue item and (re)computes query_history progress — it does NOT
 *    fire-and-forget to the next item.
 *  - The three similarity searches (against published story artifacts, existing
 *    stories, and artifacts with images) are computed as in-worker cosine over
 *    the `embedding` / `title_embedding` TEXT (JSON) columns, with thresholds,
 *    environment/status filters, and ordering matching the schema.
 *  - Images live on R2 as relative `/images/<key>` paths, so image filters check
 *    "stored_url starts with /images/ and !download_failed". For LLM vision,
 *    those paths are made absolute against env.PUBLIC_SITE_URL (vision needs
 *    absolute HTTPS URLs).
 *  - LLM keys are passed explicitly to callLLM via `keys`.
 */
import type { Env } from "../env";
import type {
  ArtifactRow,
  JournalismQueueRow,
  PromptVersionRow,
  QueryHistoryRow,
  StoryRow,
  StoredImage,
  AppSettingRow,
  LLMModelConfig,
} from "../_shared/types";
import { all, first, insert, run, fromJson, toJson } from "../_shared/db";
import { callLLM, generateEmbedding } from "../_shared/llm-client";
import { stripEmDashes } from "../_shared/text-cleanup";

/** R2-served image path prefix. */
const STORAGE_MARKER = "/images/";

export interface StructuredStoryResponse {
  headline: string;
  subhead?: string;
  byline?: string;
  source_name?: string;
  source_url?: string;
  body: string[] | string;
  skip?: boolean;
  skip_reason?: string | null;
}

/**
 * Parse an LLM response as a structured story JSON object. Strips markdown code
 * fences if present. Returns null when the text is not valid JSON or is missing
 * the minimum required fields. (Exported; reused by story-regeneration.)
 */
export function parseStructuredResponse(content: string): StructuredStoryResponse | null {
  try {
    // Strip markdown code fences if present (```json ... ```)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate minimum required fields
    if (typeof parsed !== "object" || parsed === null) return null;
    if (parsed.skip === true) return parsed as StructuredStoryResponse;
    if (!parsed.headline || (!parsed.body && !Array.isArray(parsed.body))) return null;

    return parsed as StructuredStoryResponse;
  } catch {
    return null;
  }
}

/** Cosine similarity between two equal-length numeric vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Read the configured LLM model from app_settings key `ai_model_config`. */
async function getModelConfig(env: Env): Promise<LLMModelConfig> {
  const settings = await first<Pick<AppSettingRow, "value">>(
    env,
    `select value from app_settings where key = 'ai_model_config'`,
  );
  if (!settings) {
    throw new Error("Failed to fetch model configuration. Please configure a model in the Models tab.");
  }
  const modelConfig = fromJson<LLMModelConfig | null>(settings.value, null);
  if (!modelConfig || !modelConfig.model_name) {
    throw new Error("No model configured. Please select a model in the Models tab.");
  }
  return modelConfig;
}

/** LLM keys + referer used by callLLM. */
function llmKeys(env: Env) {
  return {
    openRouterApiKey: env.OPENROUTER_API_KEY,
    lovableApiKey: env.LOVABLE_API_KEY,
    refererUrl: env.PUBLIC_SITE_URL,
  };
}

/**
 * Recompute query_history progress counters + status from the current queue
 * state.
 */
export async function updateHistoryProgress(env: Env, historyId: string): Promise<void> {
  const queueStats = await all<Pick<JournalismQueueRow, "status">>(
    env,
    `select status from journalism_queue where query_history_id = ?`,
    historyId,
  );

  const completed = queueStats.filter((q) => q.status === "completed").length;
  const failed = queueStats.filter((q) => q.status === "failed").length;
  const skipped = queueStats.filter((q) => q.status === "skipped").length;
  const total = queueStats.length;

  const terminal = completed + failed + skipped;
  const status =
    terminal === total && total > 0
      ? failed > 0
        ? "failed"
        : "completed"
      : "running";

  await run(
    env,
    `update query_history
        set stories_count = ?,
            skipped_count = ?,
            artifacts_count = ?,
            status = ?,
            completed_at = ?
      where id = ?`,
    completed,
    skipped,
    total,
    status,
    status === "running" ? null : new Date().toISOString(),
    historyId,
  );
}

/** Mark a queue item as skipped with a reason, then refresh history progress. */
async function skipQueueItem(
  env: Env,
  queueItemId: string,
  historyId: string,
  reason: string,
): Promise<{ skipped: true; reason: string; queueItemId: string }> {
  await run(
    env,
    `update journalism_queue
        set status = 'skipped', completed_at = ?, error_message = ?
      where id = ?`,
    new Date().toISOString(),
    reason,
    queueItemId,
  );
  await updateHistoryProgress(env, historyId);
  return { skipped: true, reason, queueItemId };
}

export interface ProcessQueueItemResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  storyId?: string;
  queueItemId: string;
  error?: string;
}

/**
 * Process exactly one journalism queue item: dedup checks, LLM generation,
 * hero-image resolution, story insert. Chaining to the next item is the
 * orchestrator Queue's responsibility; this function never invokes the next.
 */
export async function processJournalismQueueItem(
  env: Env,
  queueItemId: string,
): Promise<ProcessQueueItemResult> {
  console.log("🔄 Processing queue item:", queueItemId);

  try {
    // Fetch queue item.
    const queueItem = await first<JournalismQueueRow>(
      env,
      `select * from journalism_queue where id = ?`,
      queueItemId,
    );
    if (!queueItem) {
      throw new Error("Queue item not found");
    }

    const historyId = queueItem.query_history_id;

    // Fetch the artifact + its source name.
    const artifact = await first<ArtifactRow & { source_name: string | null }>(
      env,
      `select a.*, s.name as source_name
         from artifacts a
         left join sources s on s.id = a.source_id
        where a.id = ?`,
      queueItem.artifact_id,
    );
    if (!artifact) {
      throw new Error("Queue item not found: artifact missing");
    }

    // Mark as processing.
    await run(
      env,
      `update journalism_queue set status = 'processing', started_at = ? where id = ?`,
      new Date().toISOString(),
      queueItemId,
    );

    console.log(`📝 Processing artifact: ${artifact.title || artifact.name}`);

    // Fetch prompt version (via the query_history's prompt_version_id).
    const history = await first<Pick<QueryHistoryRow, "prompt_version_id">>(
      env,
      `select prompt_version_id from query_history where id = ?`,
      historyId,
    );
    const promptVersionId = history?.prompt_version_id ?? null;
    const promptVersion = promptVersionId
      ? await first<PromptVersionRow>(
          env,
          `select * from prompt_versions where id = ?`,
          promptVersionId,
        )
      : null;
    if (!promptVersion) {
      throw new Error("Failed to fetch prompt version");
    }

    // Fetch model configuration.
    const modelConfig = await getModelConfig(env);

    // Determine environment.
    const environment = artifact.is_test ? "test" : "production";

    // Prepare content (with truncation if needed).
    let contentToUse = artifact.content || "No content";
    if (contentToUse.length > 20000) {
      contentToUse = contentToUse.substring(0, 20000) + "\n\n[Content truncated due to length...]";
    }

    // Build prompt.
    const sourceName = artifact.source_name || "Unknown Source";
    const artifactData = `
Title: ${artifact.title || artifact.name}
Date: ${artifact.date}
Source: ${sourceName}
URL: ${artifact.url || "Not available"}
Current time (for evaluating time-bound advisories): ${new Date().toISOString()}
Content: ${contentToUse}
`;

    const fullPrompt = `${promptVersion.content}

## Artifact:
${artifactData}`;

    // Decode artifact images + embedding (TEXT JSON columns).
    const artifactImages = fromJson<StoredImage[]>(artifact.images, []);
    const artifactEmbedding = fromJson<number[] | null>(artifact.embedding, null);

    // Collect images for vision analysis. Only include R2-stored images
    // (stored_url starts with /images/ and !download_failed). Convert to
    // absolute HTTPS URLs against PUBLIC_SITE_URL for the vision call.
    const imagePaths: string[] = [];

    // Hero image, if it's an R2-stored path.
    const heroUrl = artifact.hero_image_url;
    if (heroUrl) {
      if (heroUrl.startsWith(STORAGE_MARKER)) {
        imagePaths.push(heroUrl);
      } else {
        console.log(`⚠️ Skipping hero image for vision (not R2-stored): ${heroUrl}`);
      }
    }

    // Additional images from the images array.
    for (const img of artifactImages) {
      if (
        img &&
        typeof img === "object" &&
        !img.download_failed &&
        typeof img.stored_url === "string" &&
        img.stored_url.startsWith(STORAGE_MARKER) &&
        img.stored_url !== img.original_url
      ) {
        imagePaths.push(img.stored_url);
      }
    }

    // Build message content with vision support (absolute URLs for vision).
    const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: fullPrompt },
    ];
    if (imagePaths.length > 0) {
      console.log(`📷 Including ${imagePaths.length} image(s) for analysis`);
      for (const imagePath of imagePaths) {
        messageContent.push({
          type: "image_url",
          image_url: { url: new URL(imagePath, env.PUBLIC_SITE_URL).toString() },
        });
      }
    }

    // Artifact-level dedup: skip if this source artifact is similar to one that
    // already produced a (non-rejected/archived, production) story.
    // Replaces RPC match_published_story_artifacts (threshold 0.80).
    if (artifactEmbedding) {
      try {
        const candidates = await all<{ story_title: string; embedding: string | null }>(
          env,
          `select s.title as story_title, a.embedding as embedding
             from story_artifacts sa
             join artifacts a on a.id = sa.artifact_id
             join stories s on s.id = sa.story_id
            where a.embedding is not null
              and s.environment = 'production'
              and s.status not in ('rejected', 'archived')`,
        );

        let best: { title: string; similarity: number } | null = null;
        for (const c of candidates) {
          const emb = fromJson<number[] | null>(c.embedding, null);
          if (!emb) continue;
          const similarity = cosineSimilarity(artifactEmbedding, emb);
          if (similarity > 0.8 && (!best || similarity > best.similarity)) {
            best = { title: c.story_title, similarity };
          }
        }

        if (best) {
          const skipReason = `Source artifact similar to artifact behind story "${best.title}" (similarity: ${best.similarity.toFixed(3)})`;
          console.log(`⏭️ Skipping — artifact-level dedup: ${skipReason}`);
          return await skipQueueItem(env, queueItemId, historyId, skipReason);
        }
      } catch (artDedupErr) {
        console.warn(
          "⚠️ Artifact-level dedup check failed (proceeding anyway):",
          artDedupErr instanceof Error ? artDedupErr.message : artDedupErr,
        );
      }
    }

    // Title-level dedup: compare artifact title against existing story titles.
    // Replaces RPC match_stories_by_embedding (threshold 0.80, production only),
    // excluding rejected/archived stories.
    const artifactTitle = artifact.title || artifact.name || "";
    if (artifactTitle.length > 10) {
      try {
        const artifactTitleEmbedding = await generateEmbedding(artifactTitle, env.OPENROUTER_API_KEY);
        const match = await matchStoryByTitleEmbedding(env, artifactTitleEmbedding, 0.8, [
          "rejected",
          "archived",
        ]);
        if (match) {
          const skipReason = `Duplicate of existing story "${match.title}" (similarity: ${match.similarity.toFixed(3)})`;
          console.log(`⏭️ Skipping — artifact-title vs story-title dedup: ${skipReason}`);
          return await skipQueueItem(env, queueItemId, historyId, skipReason);
        }
      } catch (titleDedupErr) {
        console.warn(
          "⚠️ Title-level dedup check failed (proceeding anyway):",
          titleDedupErr instanceof Error ? titleDedupErr.message : titleDedupErr,
        );
      }
    }

    // Call LLM via shared client.
    const llmResponse = await callLLM({
      prompt: messageContent,
      modelConfig,
      keys: llmKeys(env),
      maxTokens: 5000,
      temperature: 0.6,
      appTitle: "Woodstock Community News AI Journalist",
    });

    const storyContent = llmResponse.content || "No content generated";

    // Try to parse as structured JSON first.
    const parsed = parseStructuredResponse(storyContent);

    // Check for skip signal (structured or legacy).
    const isSkip = parsed
      ? parsed.skip === true
      : storyContent.trim().toUpperCase().startsWith("SKIP:");

    if (isSkip) {
      const skipReason = parsed
        ? parsed.skip_reason || "Insufficient source material"
        : storyContent.trim().slice(5).trim();
      console.log(`⏭️ Skipping artifact — insufficient source material: ${skipReason}`);
      return await skipQueueItem(env, queueItemId, historyId, skipReason);
    }

    // Extract title, content, and structured metadata.
    let title: string;
    let content: string;
    let structuredMetadata: Record<string, unknown> | null = null;

    if (parsed) {
      console.log("📋 Using structured JSON response from LLM");
      title = parsed.headline || "Untitled Story";
      content = Array.isArray(parsed.body) ? parsed.body.join("\n\n") : parsed.body || "";
      structuredMetadata = {
        subhead: parsed.subhead || null,
        byline: parsed.byline || null,
        source_name: parsed.source_name || null,
        source_url: parsed.source_url || null,
      };
    } else {
      console.log("📋 Using legacy text parsing (LLM did not return JSON)");
      const lines = storyContent.split("\n").filter((line: string) => line.trim());
      title =
        lines[0]
          .replace(/^#+\s*/, "")
          .replace(/^HEADLINE:\s*/i, "")
          .trim() || "Untitled Story";
      content = lines.slice(1).join("\n").trim();
    }

    // Strip em/en dashes from reader-facing fields — classic AI tell.
    title = stripEmDashes(title);
    content = stripEmDashes(content);
    if (structuredMetadata) {
      structuredMetadata.subhead = stripEmDashes(structuredMetadata.subhead as string | null);
      structuredMetadata.byline = stripEmDashes(structuredMetadata.byline as string | null);
    }

    // Quality guard: never persist an empty/near-empty story. This catches an
    // empty structured body (`body: []`, which slips past parseStructuredResponse),
    // an empty/garbage LLM response, and degenerate legacy parses — before any of
    // them enter the editorial/publish chain. Skip (not fail) so the queue does
    // not churn retries on a hopeless artifact.
    const MIN_CONTENT_CHARS = 200;
    if (!title.trim() || content.trim().length < MIN_CONTENT_CHARS) {
      const skipReason = `Generated story failed quality guard (title=${title.trim().length} chars, content=${content.trim().length} chars; min ${MIN_CONTENT_CHARS})`;
      console.warn(`⏭️ Skipping — ${skipReason}`);
      return await skipQueueItem(env, queueItemId, historyId, skipReason);
    }

    // Story-level dedup: check for similar existing stories by title embedding.
    // Replaces RPC match_stories_by_embedding (threshold 0.85, production only),
    // excluding rejected stories (the primary check) and rejected/archived (retry).
    let titleEmbedding: number[] | null = null;
    try {
      titleEmbedding = await generateEmbedding(title, env.OPENROUTER_API_KEY);
      const match = await matchStoryByTitleEmbedding(env, titleEmbedding, 0.85, ["rejected"]);
      if (match) {
        const skipReason = `Duplicate of existing story "${match.title}" (similarity: ${match.similarity.toFixed(3)})`;
        console.log(`⏭️ Skipping — story-level dedup: ${skipReason}`);
        return await skipQueueItem(env, queueItemId, historyId, skipReason);
      }
    } catch (dedupErr) {
      console.error(
        "❌ Story-level dedup check failed — retrying once:",
        dedupErr instanceof Error ? dedupErr.message : dedupErr,
      );
      try {
        const retryEmbedding = await generateEmbedding(title, env.OPENROUTER_API_KEY);
        const match = await matchStoryByTitleEmbedding(env, retryEmbedding, 0.85, [
          "rejected",
          "archived",
        ]);
        if (match) {
          const skipReason = `Duplicate of existing story "${match.title}" (dedup retry)`;
          console.log(`⏭️ Skipping — story-level dedup retry caught: ${skipReason}`);
          return await skipQueueItem(env, queueItemId, historyId, skipReason);
        }
        titleEmbedding = retryEmbedding;
      } catch (retryErr) {
        console.warn(
          "⚠️ Story-level dedup retry also failed (proceeding):",
          retryErr instanceof Error ? retryErr.message : retryErr,
        );
      }
    }

    const source_id = artifact.source_id || null;

    // Hero image: use artifact's image, fall back to cluster mates or similar
    // artifacts. hero_image_url must be an R2-stored /images/ path so it stays
    // stable over time. External URLs (e.g. Facebook/Instagram CDN) are rejected.
    let heroImageUrl = artifact.hero_image_url || null;

    // If the artifact's own hero URL is external, try to salvage a successfully
    // stored image from its images array.
    if (heroImageUrl && !heroImageUrl.startsWith(STORAGE_MARKER)) {
      const salvaged = artifactImages.find(
        (img) =>
          !img?.download_failed &&
          typeof img?.stored_url === "string" &&
          img.stored_url.startsWith(STORAGE_MARKER),
      );
      if (salvaged?.stored_url) {
        console.log("🖼️ Salvaged hero from stored image in artifact.images");
        heroImageUrl = salvaged.stored_url;
      } else {
        console.log(`🖼️ Rejecting non-R2 artifact hero URL: ${heroImageUrl}`);
        heroImageUrl = null;
      }
    }

    if (!heroImageUrl && artifact.cluster_id) {
      console.log("🖼️ No hero image — checking cluster mates...");
      const clusterMate = await first<Pick<ArtifactRow, "hero_image_url">>(
        env,
        `select hero_image_url
           from artifacts
          where cluster_id = ?
            and hero_image_url is not null
            and id != ?
          limit 1`,
        artifact.cluster_id,
        artifact.id,
      );
      if (clusterMate) {
        const candidate = clusterMate.hero_image_url;
        if (candidate?.startsWith(STORAGE_MARKER)) {
          heroImageUrl = candidate;
          console.log("✅ Found hero image from cluster mate");
        } else {
          console.log("🖼️ Cluster mate hero URL is external, skipping");
        }
      }
    }

    if (!heroImageUrl && artifactEmbedding) {
      console.log("🖼️ No hero image in cluster — checking similar artifacts...");
      // Replaces RPC match_artifacts_with_images (threshold 0.80, has hero image).
      const withImages = await all<Pick<ArtifactRow, "hero_image_url" | "embedding">>(
        env,
        `select hero_image_url, embedding
           from artifacts
          where embedding is not null
            and hero_image_url is not null`,
      );
      let best: { hero_image_url: string | null; similarity: number } | null = null;
      for (const cand of withImages) {
        const emb = fromJson<number[] | null>(cand.embedding, null);
        if (!emb) continue;
        const similarity = cosineSimilarity(artifactEmbedding, emb);
        if (similarity > 0.8 && (!best || similarity > best.similarity)) {
          best = { hero_image_url: cand.hero_image_url, similarity };
        }
      }
      if (best) {
        const candidate = best.hero_image_url;
        if (candidate?.startsWith(STORAGE_MARKER)) {
          heroImageUrl = candidate;
          console.log("✅ Found hero image from similar artifact");
        } else {
          console.log("🖼️ Similar-artifact hero URL is external, skipping");
        }
      }
    }

    // Compute quality metrics.
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Build generation metadata from LLM response.
    const generationMetadata = {
      model: llmResponse.model || modelConfig.model_name,
      provider: modelConfig.model_provider,
      prompt_tokens: llmResponse.usage?.prompt_tokens || null,
      completion_tokens: llmResponse.usage?.completion_tokens || null,
      total_tokens: llmResponse.usage?.total_tokens || null,
      prompt_version_id: promptVersion.id,
    };

    // Generate title embedding for dedup if not already done.
    if (!titleEmbedding) {
      try {
        titleEmbedding = await generateEmbedding(title, env.OPENROUTER_API_KEY);
      } catch (embErr) {
        console.warn(
          "⚠️ Failed to generate title embedding (non-fatal):",
          embErr instanceof Error ? embErr.message : embErr,
        );
      }
    }

    // Insert story.
    const now = new Date().toISOString();
    const newStory = await insert<StoryRow>(env, "stories", {
      id: crypto.randomUUID(),
      title,
      content,
      status: "pending",
      source_id,
      prompt_version_id: promptVersion.id,
      environment,
      is_test: environment === "test" ? 1 : 0,
      hero_image_url: heroImageUrl,
      word_count: wordCount,
      source_count: 1,
      generation_metadata: toJson(generationMetadata),
      ...(structuredMetadata ? { structured_metadata: toJson(structuredMetadata) } : {}),
      ...(titleEmbedding ? { title_embedding: toJson(titleEmbedding) } : {}),
      created_at: now,
      updated_at: now,
    });

    if (!newStory) {
      throw new Error("Failed to insert story");
    }

    // Link artifact to story.
    await insert(env, "story_artifacts", {
      id: crypto.randomUUID(),
      story_id: newStory.id,
      artifact_id: artifact.id,
      created_at: new Date().toISOString(),
    });

    // Mark queue item as completed.
    await run(
      env,
      `update journalism_queue
          set status = 'completed', completed_at = ?, story_id = ?
        where id = ?`,
      new Date().toISOString(),
      newStory.id,
      queueItemId,
    );

    // Update query history with progress.
    await updateHistoryProgress(env, historyId);

    console.log(`✅ Story created: ${title}`);

    return { success: true, storyId: newStory.id, queueItemId };
  } catch (error) {
    console.error("❌ Error processing queue item:", error);

    // Try to mark queue item as failed + refresh history progress so the queue
    // doesn't stall on failure. (Chaining is the orchestrator's job.)
    try {
      await run(
        env,
        `update journalism_queue
            set status = 'failed', completed_at = ?, error_message = ?
          where id = ?`,
        new Date().toISOString(),
        error instanceof Error ? error.message : "Unknown error",
        queueItemId,
      );

      const queueItem = await first<Pick<JournalismQueueRow, "query_history_id">>(
        env,
        `select query_history_id from journalism_queue where id = ?`,
        queueItemId,
      );
      if (queueItem) {
        await updateHistoryProgress(env, queueItem.query_history_id);
      }
    } catch (updateError) {
      console.error("Failed to update queue item status:", updateError);
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      queueItemId,
    };
  }
}

/**
 * In-worker replacement for RPC match_stories_by_embedding. Finds the single
 * most-similar production story whose title_embedding cosine similarity exceeds
 * `threshold` and whose status is not in `excludeStatuses`.
 */
async function matchStoryByTitleEmbedding(
  env: Env,
  queryEmbedding: number[],
  threshold: number,
  excludeStatuses: string[],
): Promise<{ id: string; title: string; status: string; similarity: number } | null> {
  const rows = await all<Pick<StoryRow, "id" | "title" | "status" | "title_embedding">>(
    env,
    `select id, title, status, title_embedding
       from stories
      where title_embedding is not null
        and environment = 'production'`,
  );

  let best: { id: string; title: string; status: string; similarity: number } | null = null;
  for (const row of rows) {
    if (excludeStatuses.includes(row.status)) continue;
    const emb = fromJson<number[] | null>(row.title_embedding, null);
    if (!emb) continue;
    const similarity = cosineSimilarity(queryEmbedding, emb);
    if (similarity > threshold && (!best || similarity > best.similarity)) {
      best = { id: row.id, title: row.title, status: row.status, similarity };
    }
  }
  return best;
}

export interface CreateJournalismQueueResult {
  success: boolean;
  message: string;
  historyId: string;
  queueSize: number;
  firstItemId: string | null;
}

/**
 * Build the journalism queue for a query_history run. Selects artifacts (by IDs
 * or date range), applies production dedup (used GUIDs/clusters,
 * previously-skipped), groups by cluster,
 * runs in-batch title-token dedup for unclustered artifacts, and inserts queue
 * rows. Does NOT kick off processing — the orchestrator's Queue consumer does.
 *
 * `environment` and `promptVersionId` are read from the query_history row.
 */
export async function createJournalismQueue(
  env: Env,
  historyId: string,
  dateFrom: string,
  dateTo: string,
  artifactIds?: string[],
): Promise<CreateJournalismQueueResult> {
  console.log("🚀 createJournalismQueue started");

  try {
    const history = await first<Pick<QueryHistoryRow, "environment" | "prompt_version_id">>(
      env,
      `select environment, prompt_version_id from query_history where id = ?`,
      historyId,
    );
    if (!history) {
      throw new Error("Query history not found");
    }
    const environment = history.environment;
    const promptVersionId = history.prompt_version_id;

    console.log("📋 Request params:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      artifactIds: artifactIds ? `${artifactIds.length} IDs` : "null",
    });

    // Step 1: Fetch the prompt version.
    console.log(`🔍 Step 1: Fetching prompt version ${promptVersionId}...`);
    const promptVersion = promptVersionId
      ? await first<PromptVersionRow>(
          env,
          `select * from prompt_versions where id = ?`,
          promptVersionId,
        )
      : null;
    if (!promptVersion) {
      console.error("❌ Step 1 failed - Prompt not found");
      throw new Error("Prompt version not found");
    }
    console.log(`✅ Step 1 complete: Prompt "${promptVersion.version_name}" loaded`);

    // Step 2: Fetch artifacts by IDs or date range.
    const useIds = !!(artifactIds && artifactIds.length > 0);
    const queryMode = useIds ? "by IDs" : "by date range";
    console.log(`🔍 Step 2: Querying artifacts (${queryMode})...`);
    const isTest = environment === "test" ? 1 : 0;

    let allArtifacts: ArtifactRow[];
    if (useIds) {
      const placeholders = artifactIds!.map(() => "?").join(", ");
      allArtifacts = await all<ArtifactRow>(
        env,
        `select * from artifacts where id in (${placeholders}) and is_test = ?`,
        ...artifactIds!,
        isTest,
      );
    } else {
      allArtifacts = await all<ArtifactRow>(
        env,
        `select * from artifacts
          where date >= ? and date <= ? and is_test = ?
          order by date desc`,
        dateFrom,
        dateTo,
        isTest,
      );
    }
    console.log(`✅ Step 2 complete: Found ${allArtifacts.length} artifacts`);

    let artifacts = allArtifacts;

    // Step 3: Check for duplicates (production only).
    if (environment !== "test") {
      console.log("🔍 Step 3: Checking for duplicates...");

      // Filter out artifacts whose guid was already used by a story.
      const usedGuidRows = await all<{ guid: string | null }>(
        env,
        `select a.guid as guid
           from story_artifacts sa
           join artifacts a on a.id = sa.artifact_id`,
      );
      const usedGUIDs = new Set(
        usedGuidRows.map((r) => r.guid).filter((g): g is string => g != null),
      );
      const beforeCount = artifacts.length;
      artifacts = artifacts.filter((a) => !a.guid || !usedGUIDs.has(a.guid));
      console.log(
        `✅ Step 3 complete: ${usedGUIDs.size} already used, ${artifacts.length} remaining (filtered out ${beforeCount - artifacts.length})`,
      );

      // Cluster-based dedup: skip artifacts whose cluster already produced a story.
      const usedClusterRows = await all<{ cluster_id: string | null }>(
        env,
        `select a.cluster_id as cluster_id
           from story_artifacts sa
           join artifacts a on a.id = sa.artifact_id`,
      );
      const usedClusterIds = new Set(
        usedClusterRows.map((r) => r.cluster_id).filter((c): c is string => c != null),
      );
      const beforeClusterFilter = artifacts.length;
      artifacts = artifacts.filter((a) => !a.cluster_id || !usedClusterIds.has(a.cluster_id));
      console.log(
        `   Cluster-dedup filter: ${usedClusterIds.size} clusters already have stories, ${artifacts.length} remaining (filtered out ${beforeClusterFilter - artifacts.length})`,
      );

      // Filter out artifacts that were already skipped (evaluated, no story).
      const skippedRows = await all<{ artifact_id: string }>(
        env,
        `select artifact_id from journalism_queue where status = 'skipped'`,
      );
      const skippedIds = new Set(skippedRows.map((r) => r.artifact_id));
      const beforeSkipFilter = artifacts.length;
      artifacts = artifacts.filter((a) => !skippedIds.has(a.id));
      console.log(
        `   Skipped-artifact filter: ${skippedIds.size} previously skipped, ${artifacts.length} remaining (filtered out ${beforeSkipFilter - artifacts.length})`,
      );
    } else {
      console.log("🧪 Step 3: Test mode - Skipping duplicate check to allow multiple runs");
    }

    if (artifacts.length === 0) {
      await run(
        env,
        `update query_history set status = 'completed', stories_count = 0, completed_at = ? where id = ?`,
        new Date().toISOString(),
        historyId,
      );
      return {
        success: true,
        message: "No artifacts found",
        historyId,
        queueSize: 0,
        firstItemId: null,
      };
    }

    // Step 3b: Group by cluster — queue one item per cluster (representative artifact).
    console.log("🔗 Step 3b: Grouping artifacts by cluster...");

    const clustered = new Map<string, ArtifactRow[]>();
    const unclustered: ArtifactRow[] = [];
    for (const artifact of artifacts) {
      if (artifact.cluster_id) {
        const existing = clustered.get(artifact.cluster_id) || [];
        existing.push(artifact);
        clustered.set(artifact.cluster_id, existing);
      } else {
        unclustered.push(artifact);
      }
    }

    // For each cluster, pick the most recent artifact as the representative.
    const representativeArtifacts: ArtifactRow[] = [];
    for (const [clusterId, clusterArtifacts] of clustered) {
      const sorted = clusterArtifacts.sort(
        (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
      );
      representativeArtifacts.push(sorted[0]);
      if (clusterArtifacts.length > 1) {
        console.log(
          `   Cluster ${clusterId.substring(0, 8)}: ${clusterArtifacts.length} artifacts → using "${sorted[0].title?.substring(0, 60) || sorted[0].id}"`,
        );
      }
    }

    // In-batch dedup for unclustered artifacts: group by token-overlap of title/name.
    const tokenize = (s: string): Set<string> =>
      new Set(
        (s || "")
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .split(/\s+/)
          .filter((t) => t.length >= 4),
      );
    const jaccard = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 || b.size === 0) return 0;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter++;
      return inter / (a.size + b.size - inter);
    };

    const titleGroups: Array<{ tokens: Set<string>; members: ArtifactRow[] }> = [];
    for (const artifact of unclustered) {
      const tokens = tokenize(artifact.title || artifact.name || "");
      if (tokens.size < 3) {
        titleGroups.push({ tokens, members: [artifact] });
        continue;
      }
      let placed = false;
      for (const group of titleGroups) {
        if (jaccard(tokens, group.tokens) >= 0.5) {
          group.members.push(artifact);
          placed = true;
          break;
        }
      }
      if (!placed) titleGroups.push({ tokens, members: [artifact] });
    }

    const dedupedUnclustered: ArtifactRow[] = [];
    let inBatchDuplicates = 0;
    for (const group of titleGroups) {
      if (group.members.length === 1) {
        dedupedUnclustered.push(group.members[0]);
        continue;
      }
      const sorted = group.members.sort(
        (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
      );
      dedupedUnclustered.push(sorted[0]);
      inBatchDuplicates += group.members.length - 1;
      console.log(
        `   In-batch title dedup: ${group.members.length} unclustered artifacts → "${(sorted[0].title || sorted[0].name || sorted[0].id).substring(0, 80)}"`,
      );
    }

    // Combine: representatives + deduped unclustered artifacts.
    const artifactsToQueue = [...representativeArtifacts, ...dedupedUnclustered];
    console.log(
      `✅ Step 3b complete: ${artifacts.length} artifacts → ${artifactsToQueue.length} queue items (${clustered.size} clusters, ${dedupedUnclustered.length} unclustered after in-batch dedup, ${inBatchDuplicates} in-batch duplicates removed)`,
    );

    // Step 4: Create queue entries for all artifacts.
    console.log(`🔍 Step 4: Creating queue with ${artifactsToQueue.length} items...`);
    for (let index = 0; index < artifactsToQueue.length; index++) {
      await insert(env, "journalism_queue", {
        id: crypto.randomUUID(),
        query_history_id: historyId,
        artifact_id: artifactsToQueue[index].id,
        position: index + 1,
        status: "pending",
        created_at: new Date().toISOString(),
      });
    }
    console.log(`✅ Step 4 complete: ${artifactsToQueue.length} queue items created`);

    // Step 5: Get the first item (orchestrator Queue picks up processing).
    console.log("🔍 Step 5: Fetching first queue item...");
    const firstItem = await first<Pick<JournalismQueueRow, "id">>(
      env,
      `select id from journalism_queue
        where query_history_id = ? and status = 'pending'
        order by position asc
        limit 1`,
      historyId,
    );
    if (!firstItem) {
      console.error("❌ Step 5 failed - No first item found");
      throw new Error("No first queue item found");
    }
    console.log(`✅ Step 5 complete: First item ID ${firstItem.id}`);

    return {
      success: true,
      message: "AI Journalist queue created",
      historyId,
      queueSize: artifactsToQueue.length,
      firstItemId: firstItem.id,
    };
  } catch (error) {
    console.error("💥 Fatal error in createJournalismQueue:", error);

    // Mark history record as failed so it doesn't stay 'running' forever.
    try {
      await run(
        env,
        `update query_history set status = 'failed', error_message = ?, completed_at = ? where id = ?`,
        error instanceof Error ? error.message : "Unknown error",
        new Date().toISOString(),
        historyId,
      );
    } catch (updateError) {
      console.error("Failed to update history status:", updateError);
    }

    throw error instanceof Error ? error : new Error("Unknown error");
  }
}
