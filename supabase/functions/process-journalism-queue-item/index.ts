import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient, getSupabaseUrl, getServiceRoleKey } from "../_shared/supabase-client.ts";
import { callLLM, generateEmbedding } from "../_shared/llm-client.ts";
import { stripEmDashes } from "../_shared/text-cleanup.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function updateHistoryProgress(supabase: SupabaseClient, historyId: string) {
  const { data: queueStats } = await supabase
    .from("journalism_queue")
    .select("status")
    .eq("query_history_id", historyId);

  const completed = queueStats?.filter((q: { status: string }) => q.status === "completed").length || 0;
  const failed = queueStats?.filter((q: { status: string }) => q.status === "failed").length || 0;
  const skipped = queueStats?.filter((q: { status: string }) => q.status === "skipped").length || 0;
  const total = queueStats?.length || 0;

  const terminal = completed + failed + skipped;
  const status =
    terminal === total && total > 0
      ? failed > 0
        ? "failed"
        : "completed"
      : "running";

  await supabase
    .from("query_history")
    .update({
      stories_count: completed,
      skipped_count: skipped,
      artifacts_count: total,
      status,
      completed_at: status === "running" ? null : new Date().toISOString(),
    })
    .eq("id", historyId);
}

function chainToNextItem(supabaseUrl: string, supabaseKey: string, secret: string, nextItemId: string) {
  console.log("📋 Chaining to next item (fire-and-forget)...");
  fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseKey}`,
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ queueItemId: nextItemId }),
  }).catch(err => console.warn("Chain invoke error (non-fatal):", err?.message));
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  // Security: Check for internal secret to prevent unauthorized access
  const INTERNAL_SECRET = Deno.env.get('QUEUE_PROCESSOR_SECRET');
  const providedSecret = req.headers.get('x-internal-secret');

  if (!INTERNAL_SECRET || providedSecret !== INTERNAL_SECRET) {
    console.error("❌ Unauthorized access attempt - invalid or missing secret");
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  let queueItemId: string | null = null;

  try {
    const body = await req.json();
    queueItemId = body.queueItemId as string;

    console.log("🔄 Processing queue item:", queueItemId);

    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getServiceRoleKey();
    const supabase = createSupabaseClient();

    // Fetch queue item with artifact, source, and prompt details
    const { data: queueItem, error: queueError } = await supabase
      .from("journalism_queue")
      .select(`
        *,
        artifact:artifacts(*, source:sources(name)),
        query_history:query_history(prompt_version_id)
      `)
      .eq("id", queueItemId)
      .single();

    if (queueError || !queueItem) {
      throw new Error(`Queue item not found: ${queueError?.message}`);
    }

    // Mark as processing
    const { error: processingError } = await supabase
      .from("journalism_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .eq("id", queueItemId);
    if (processingError) throw new Error(`Failed to mark queue item as processing: ${processingError.message}`);

    console.log(`📝 Processing artifact: ${queueItem.artifact.title || queueItem.artifact.name}`);

    // Fetch prompt version (for content only)
    const { data: promptVersion, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", queueItem.query_history.prompt_version_id)
      .single();

    if (promptError || !promptVersion) {
      throw new Error("Failed to fetch prompt version");
    }

    // Fetch model configuration from app_settings
    const { data: modelSettings, error: settingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_model_config")
      .single();

    if (settingsError || !modelSettings) {
      throw new Error("Failed to fetch model configuration. Please configure a model in the Models tab.");
    }

    const modelConfig = modelSettings.value as { model_name: string; model_provider: string };

    if (!modelConfig.model_name) {
      throw new Error("No model configured. Please select a model in the Models tab.");
    }

    // Determine environment
    const environment = queueItem.artifact.is_test ? "test" : "production";

    // Prepare content (with truncation if needed)
    let contentToUse = queueItem.artifact.content || "No content";
    if (contentToUse.length > 20000) {
      contentToUse = contentToUse.substring(0, 20000) + "\n\n[Content truncated due to length...]";
    }

    // Build prompt
    const sourceName = queueItem.artifact.source?.name || "Unknown Source";
    const artifactData = `
Title: ${queueItem.artifact.title || queueItem.artifact.name}
Date: ${queueItem.artifact.date}
Source: ${sourceName}
URL: ${queueItem.artifact.url || "Not available"}
Content: ${contentToUse}
`;

    const fullPrompt = `${promptVersion.content}

## Artifact:
${artifactData}`;

    // Collect images for vision analysis
    const imageUrls: string[] = [];

    // Add hero image if available and successfully stored (not a 403 fallback)
    const heroUrl = queueItem.artifact.hero_image_url;
    if (heroUrl) {
      // Only use hero image for vision if it's a Supabase storage URL (successfully downloaded)
      const isStoredInSupabase = heroUrl.includes('supabase.co/storage');
      if (isStoredInSupabase) {
        imageUrls.push(heroUrl);
      } else {
        console.log(`⚠️ Skipping hero image for vision (not in Supabase storage): ${heroUrl}`);
      }
    }

    // Add additional images from images array if available and successfully downloaded
    if (queueItem.artifact.images && Array.isArray(queueItem.artifact.images)) {
      for (const img of queueItem.artifact.images) {
        if (typeof img === 'string') {
          imageUrls.push(img);
        } else if (img && typeof img === 'object' && img.stored_url && img.stored_url !== img.original_url) {
          imageUrls.push(img.stored_url);
        }
      }
    }

    // Build message content with vision support
    const messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: fullPrompt }
    ];

    // Add images for vision analysis
    if (imageUrls.length > 0) {
      console.log(`📷 Including ${imageUrls.length} image(s) for analysis`);
      for (const imageUrl of imageUrls) {
        messageContent.push({
          type: "image_url",
          image_url: { url: imageUrl }
        });
      }
    }

    // Artifact-level dedup: check if source artifact is similar to one that already produced a story
    // This catches cases where clustering missed near-threshold pairs and the LLM would generate
    // different-enough titles to bypass story-title dedup.
    if (queueItem.artifact.embedding) {
      try {
        const { data: similarStoryArtifacts, error: artDedupError } = await supabase.rpc(
          "match_published_story_artifacts",
          {
            query_embedding: typeof queueItem.artifact.embedding === "string"
              ? queueItem.artifact.embedding
              : JSON.stringify(queueItem.artifact.embedding),
            similarity_threshold: 0.80,
            match_count: 1,
          }
        );

        if (!artDedupError && similarStoryArtifacts && similarStoryArtifacts.length > 0) {
          const match = similarStoryArtifacts[0];
          const skipReason = `Source artifact similar to artifact behind story "${match.story_title}" (similarity: ${match.similarity.toFixed(3)})`;
          console.log(`⏭️ Skipping — artifact-level dedup: ${skipReason}`);

          await supabase
            .from("journalism_queue")
            .update({
              status: "skipped",
              completed_at: new Date().toISOString(),
              error_message: skipReason,
            })
            .eq("id", queueItemId);

          await updateHistoryProgress(supabase, queueItem.query_history_id);

          const { data: nextItem } = await supabase
            .from("journalism_queue")
            .select("id")
            .eq("query_history_id", queueItem.query_history_id)
            .eq("status", "pending")
            .order("position", { ascending: true })
            .limit(1)
            .single();

          if (nextItem) {
            chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
          }

          return new Response(
            JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      } catch (artDedupErr) {
        console.warn("⚠️ Artifact-level dedup check failed (proceeding anyway):", artDedupErr instanceof Error ? artDedupErr.message : artDedupErr);
      }
    }

    // Title-level dedup: compare artifact title against existing story titles.
    // Catches cross-format duplicates (e.g. Facebook post vs. website article about the same event)
    // where full-content embeddings diverge but titles cover the same topic.
    const artifactTitle = queueItem.artifact.title || queueItem.artifact.name || "";
    if (artifactTitle.length > 10) {
      try {
        const artifactTitleEmbedding = await generateEmbedding(artifactTitle);
        const { data: titleMatches, error: titleMatchError } = await supabase.rpc(
          "match_stories_by_embedding",
          {
            query_embedding: JSON.stringify(artifactTitleEmbedding),
            similarity_threshold: 0.80,
            match_count: 1,
          }
        );

        if (!titleMatchError && titleMatches && titleMatches.length > 0) {
          const match = titleMatches.find(
            (s: { id: string; title: string; status: string; similarity: number }) =>
              s.status !== "rejected" && s.status !== "archived"
          );
          if (match) {
            const skipReason = `Duplicate of existing story "${match.title}" (similarity: ${match.similarity.toFixed(3)})`;
            console.log(`⏭️ Skipping — artifact-title vs story-title dedup: ${skipReason}`);

            await supabase
              .from("journalism_queue")
              .update({
                status: "skipped",
                completed_at: new Date().toISOString(),
                error_message: skipReason,
              })
              .eq("id", queueItemId);

            await updateHistoryProgress(supabase, queueItem.query_history_id);

            const { data: nextItem } = await supabase
              .from("journalism_queue")
              .select("id")
              .eq("query_history_id", queueItem.query_history_id)
              .eq("status", "pending")
              .order("position", { ascending: true })
              .limit(1)
              .single();

            if (nextItem) {
              chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
            }

            return new Response(
              JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      } catch (titleDedupErr) {
        console.warn("⚠️ Title-level dedup check failed (proceeding anyway):", titleDedupErr instanceof Error ? titleDedupErr.message : titleDedupErr);
      }
    }

    // Call LLM via shared client
    const llmResponse = await callLLM({
      prompt: messageContent,
      modelConfig,
      maxTokens: 5000,
      temperature: 0.6,
      appTitle: "Woodstock Community News AI Journalist",
    });

    const storyContent = llmResponse.content || "No content generated";

    // Try to parse as structured JSON first
    const parsed = parseStructuredResponse(storyContent);

    // Check for skip signal (structured or legacy)
    const isSkip = parsed
      ? parsed.skip === true
      : storyContent.trim().toUpperCase().startsWith("SKIP:");

    if (isSkip) {
      const skipReason = parsed
        ? (parsed.skip_reason || "Insufficient source material")
        : storyContent.trim().slice(5).trim();

      console.log(`⏭️ Skipping artifact — insufficient source material: ${skipReason}`);

      const { error: skipError } = await supabase
        .from("journalism_queue")
        .update({
          status: "skipped",
          completed_at: new Date().toISOString(),
          error_message: skipReason,
        })
        .eq("id", queueItemId);
      if (skipError) throw new Error(`Failed to mark queue item as skipped: ${skipError.message}`);

      await updateHistoryProgress(supabase, queueItem.query_history_id);

      // Chain to next pending item
      const { data: nextItem } = await supabase
        .from("journalism_queue")
        .select("id")
        .eq("query_history_id", queueItem.query_history_id)
        .eq("status", "pending")
        .order("position", { ascending: true })
        .limit(1)
        .single();

      if (nextItem) {
        chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
      }

      return new Response(
        JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract title, content, and structured metadata
    let title: string;
    let content: string;
    let structuredMetadata: Record<string, unknown> | null = null;

    if (parsed) {
      // Structured JSON response
      console.log("📋 Using structured JSON response from LLM");
      title = parsed.headline || "Untitled Story";
      content = Array.isArray(parsed.body)
        ? parsed.body.join("\n\n")
        : (parsed.body || "");
      structuredMetadata = {
        subhead: parsed.subhead || null,
        byline: parsed.byline || null,
        source_name: parsed.source_name || null,
        source_url: parsed.source_url || null,
      };
    } else {
      // Legacy text response — fallback to regex parsing
      console.log("📋 Using legacy text parsing (LLM did not return JSON)");
      const lines = storyContent.split("\n").filter((line: string) => line.trim());
      title = lines[0]
        .replace(/^#+\s*/, "")
        .replace(/^HEADLINE:\s*/i, "")
        .trim() || "Untitled Story";
      content = lines.slice(1).join("\n").trim();
    }

    // Strip em/en dashes from reader-facing fields — classic AI tell.
    title = stripEmDashes(title);
    content = stripEmDashes(content);
    if (structuredMetadata) {
      structuredMetadata.subhead = stripEmDashes(
        structuredMetadata.subhead as string | null
      );
      structuredMetadata.byline = stripEmDashes(
        structuredMetadata.byline as string | null
      );
    }

    // Story-level dedup: check for similar existing stories by title embedding
    let titleEmbedding: number[] | null = null;
    try {
      titleEmbedding = await generateEmbedding(title);

      const { data: similarStories, error: simError } = await supabase.rpc(
        "match_stories_by_embedding",
        {
          query_embedding: JSON.stringify(titleEmbedding),
          similarity_threshold: 0.85,
          match_count: 3,
        }
      );

      if (!simError && similarStories && similarStories.length > 0) {
        const activeDupes = similarStories.filter(
          (s: { id: string; title: string; status: string; similarity: number }) =>
            s.status !== "rejected"
        );

        if (activeDupes.length > 0) {
          const dupeTitle = activeDupes[0].title;
          const dupeSim = activeDupes[0].similarity.toFixed(3);
          const skipReason = `Duplicate of existing story "${dupeTitle}" (similarity: ${dupeSim})`;
          console.log(`⏭️ Skipping — story-level dedup: ${skipReason}`);

          await supabase
            .from("journalism_queue")
            .update({
              status: "skipped",
              completed_at: new Date().toISOString(),
              error_message: skipReason,
            })
            .eq("id", queueItemId);

          await updateHistoryProgress(supabase, queueItem.query_history_id);

          const { data: nextItem } = await supabase
            .from("journalism_queue")
            .select("id")
            .eq("query_history_id", queueItem.query_history_id)
            .eq("status", "pending")
            .order("position", { ascending: true })
            .limit(1)
            .single();

          if (nextItem) {
            chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
          }

          return new Response(
            JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    } catch (dedupErr) {
      console.error("❌ Story-level dedup check failed — retrying once:", dedupErr instanceof Error ? dedupErr.message : dedupErr);
      try {
        const retryEmbedding = await generateEmbedding(title);
        const { data: retryStories } = await supabase.rpc("match_stories_by_embedding", {
          query_embedding: JSON.stringify(retryEmbedding),
          similarity_threshold: 0.85,
          match_count: 1,
        });
        if (retryStories && retryStories.length > 0) {
          const match = retryStories.find(
            (s: { status: string }) => s.status !== "rejected" && s.status !== "archived"
          );
          if (match) {
            const skipReason = `Duplicate of existing story "${(match as { title: string }).title}" (dedup retry)`;
            console.log(`⏭️ Skipping — story-level dedup retry caught: ${skipReason}`);
            await supabase
              .from("journalism_queue")
              .update({ status: "skipped", completed_at: new Date().toISOString(), error_message: skipReason })
              .eq("id", queueItemId);
            await updateHistoryProgress(supabase, queueItem.query_history_id);
            const { data: nextItem } = await supabase
              .from("journalism_queue")
              .select("id")
              .eq("query_history_id", queueItem.query_history_id)
              .eq("status", "pending")
              .order("position", { ascending: true })
              .limit(1)
              .single();
            if (nextItem) chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
            return new Response(JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
        titleEmbedding = retryEmbedding;
      } catch (retryErr) {
        console.warn("⚠️ Story-level dedup retry also failed (proceeding):", retryErr instanceof Error ? retryErr.message : retryErr);
      }
    }

    const source_id = queueItem.artifact.source_id || null;

    // Hero image: use artifact's image, fall back to cluster mates or similar artifacts.
    // hero_image_url must be a Supabase storage URL so it stays stable over time.
    // External URLs (e.g. Facebook/Instagram CDN) are rejected at every step.
    const STORAGE_MARKER = "supabase.co/storage";
    let heroImageUrl = queueItem.artifact.hero_image_url || null;

    // If the artifact's own hero URL is external (download_failed entry),
    // try to salvage a successfully-stored image from its images array.
    if (heroImageUrl && !heroImageUrl.includes(STORAGE_MARKER)) {
      const images = queueItem.artifact.images as
        | Array<{ stored_url?: string; download_failed?: boolean }>
        | null
        | undefined;
      const salvaged = images?.find(
        (img) =>
          !img?.download_failed &&
          typeof img?.stored_url === "string" &&
          img.stored_url.includes(STORAGE_MARKER)
      );
      if (salvaged?.stored_url) {
        console.log("🖼️ Salvaged hero from stored image in artifact.images");
        heroImageUrl = salvaged.stored_url;
      } else {
        console.log(
          `🖼️ Rejecting non-Supabase artifact hero URL: ${heroImageUrl}`
        );
        heroImageUrl = null;
      }
    }

    if (!heroImageUrl && queueItem.artifact.cluster_id) {
      console.log("🖼️ No hero image — checking cluster mates...");
      const { data: clusterMates } = await supabase
        .from("artifacts")
        .select("hero_image_url")
        .eq("cluster_id", queueItem.artifact.cluster_id)
        .not("hero_image_url", "is", null)
        .neq("id", queueItem.artifact.id)
        .limit(1);

      if (clusterMates && clusterMates.length > 0) {
        const candidate = clusterMates[0].hero_image_url;
        if (candidate?.includes(STORAGE_MARKER)) {
          heroImageUrl = candidate;
          console.log(`✅ Found hero image from cluster mate`);
        } else {
          console.log(`🖼️ Cluster mate hero URL is external, skipping`);
        }
      }
    }

    if (!heroImageUrl && queueItem.artifact.embedding) {
      console.log("🖼️ No hero image in cluster — checking similar artifacts...");
      const { data: similarWithImages } = await supabase.rpc(
        "match_artifacts_with_images",
        {
          query_embedding: typeof queueItem.artifact.embedding === "string"
            ? queueItem.artifact.embedding
            : JSON.stringify(queueItem.artifact.embedding),
          similarity_threshold: 0.80,
          match_count: 1,
        }
      );

      if (similarWithImages && similarWithImages.length > 0) {
        const candidate = similarWithImages[0].hero_image_url;
        if (candidate?.includes(STORAGE_MARKER)) {
          heroImageUrl = candidate;
          console.log(`✅ Found hero image from similar artifact`);
        } else {
          console.log(`🖼️ Similar-artifact hero URL is external, skipping`);
        }
      }
    }

    // Compute quality metrics
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length;

    // Build generation metadata from LLM response
    const generationMetadata = {
      model: llmResponse.model || modelConfig.model_name,
      provider: modelConfig.model_provider,
      prompt_tokens: llmResponse.usage?.prompt_tokens || null,
      completion_tokens: llmResponse.usage?.completion_tokens || null,
      total_tokens: llmResponse.usage?.total_tokens || null,
      prompt_version_id: promptVersion.id,
    };

    // Generate title embedding for dedup if not already done
    if (!titleEmbedding) {
      try {
        titleEmbedding = await generateEmbedding(title);
      } catch (embErr) {
        console.warn("⚠️ Failed to generate title embedding (non-fatal):", embErr instanceof Error ? embErr.message : embErr);
      }
    }

    // Insert story
    const { data: newStory, error: storyError } = await supabase
      .from("stories")
      .insert({
        title,
        content,
        source_id,
        prompt_version_id: promptVersion.id,
        environment,
        is_test: environment === "test",
        hero_image_url: heroImageUrl,
        word_count: wordCount,
        source_count: 1,
        generation_metadata: generationMetadata,
        ...(structuredMetadata ? { structured_metadata: structuredMetadata } : {}),
        ...(titleEmbedding ? { title_embedding: JSON.stringify(titleEmbedding) } : {}),
      })
      .select()
      .single();

    if (storyError || !newStory) {
      throw new Error(`Failed to insert story: ${storyError?.message}`);
    }

    // Link artifact to story
    await supabase.from("story_artifacts").insert({
      story_id: newStory.id,
      artifact_id: queueItem.artifact.id,
    });

    // Mark queue item as completed
    const { error: completedError } = await supabase
      .from("journalism_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        story_id: newStory.id,
      })
      .eq("id", queueItemId);
    if (completedError) throw new Error(`Failed to mark queue item as completed: ${completedError.message}`);

    // Update query history with progress
    await updateHistoryProgress(supabase, queueItem.query_history_id);

    console.log(`✅ Story created: ${title}`);

    // Check if there are more pending items and process next
    const { data: nextItem } = await supabase
      .from("journalism_queue")
      .select("id")
      .eq("query_history_id", queueItem.query_history_id)
      .eq("status", "pending")
      .order("position", { ascending: true })
      .limit(1)
      .single();

    if (nextItem) {
      chainToNextItem(supabaseUrl, supabaseKey, INTERNAL_SECRET, nextItem.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        storyId: newStory.id,
        queueItemId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error processing queue item:", error);

    // Try to mark queue item as failed
    if (queueItemId) {
      try {
        const supabaseUrl = getSupabaseUrl();
        const supabaseKey = getServiceRoleKey();
        const supabase = createSupabaseClient();

        await supabase
          .from("journalism_queue")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            error_message: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", queueItemId);

        // Get the query_history_id to update progress
        const { data: queueItem } = await supabase
          .from("journalism_queue")
          .select("query_history_id")
          .eq("id", queueItemId)
          .single();

        if (queueItem) {
          await updateHistoryProgress(supabase, queueItem.query_history_id);

          // Chain to next pending item so the queue doesn't stall on failure
          const { data: nextItem } = await supabase
            .from("journalism_queue")
            .select("id")
            .eq("query_history_id", queueItem.query_history_id)
            .eq("status", "pending")
            .order("position", { ascending: true })
            .limit(1)
            .single();

          if (nextItem) {
            const secret = Deno.env.get("QUEUE_PROCESSOR_SECRET")!;
            chainToNextItem(supabaseUrl, supabaseKey, secret, nextItem.id);
          }
        }
      } catch (updateError) {
        console.error("Failed to update queue item status:", updateError);
      }
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
