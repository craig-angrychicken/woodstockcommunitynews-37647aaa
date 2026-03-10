import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function updateHistoryProgress(supabase: any, historyId: string) {
  const { data: queueStats } = await supabase
    .from("journalism_queue")
    .select("status")
    .eq("query_history_id", historyId);

  const completed = queueStats?.filter((q: any) => q.status === "completed").length || 0;
  const failed = queueStats?.filter((q: any) => q.status === "failed").length || 0;
  const skipped = queueStats?.filter((q: any) => q.status === "skipped").length || 0;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");

    const supabase = createClient(supabaseUrl, supabaseKey);

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
    await supabase
      .from("journalism_queue")
      .update({
        status: "processing",
        started_at: new Date().toISOString(),
      })
      .eq("id", queueItemId);

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

    // Determine API URL and authentication based on provider from settings
    const isOpenRouter = modelConfig.model_provider === "openrouter";
    const apiUrl = isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";

    const authToken = isOpenRouter ? openRouterApiKey : LOVABLE_API_KEY;
    if (!authToken) {
      throw new Error(
        isOpenRouter
          ? "OPENROUTER_API_KEY not configured"
          : "LOVABLE_API_KEY not configured"
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    };

    if (isOpenRouter) {
      headers["HTTP-Referer"] = supabaseUrl;
      headers["X-Title"] = "Woodstock Community News AI Journalist";
    }

    const model = modelConfig.model_name;

    // Build message content with vision support
    const messageContent: any[] = [
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

    // Call AI API with vision support
    const aiResponse = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: messageContent,
          },
        ],
        max_tokens: 5000,
        temperature: 0.6,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);

      let message = `AI API error ${aiResponse.status}`;
      try {
        const parsed = JSON.parse(errorText);
        const providerMsg = parsed?.error?.message || parsed?.message;
        if (providerMsg) {
          message = providerMsg;
        }
      } catch {
        // ignore JSON parse errors
      }

      throw new Error(message);
    }

    const aiData = await aiResponse.json();
    const storyContent = aiData.choices?.[0]?.message?.content || "No content generated";

    // Check if LLM signaled insufficient source material
    if (storyContent.trim().toUpperCase().startsWith("SKIP:")) {
      const skipReason = storyContent.trim().slice(5).trim();
      console.log(`⏭️ Skipping artifact — insufficient source material: ${skipReason}`);

      await supabase
        .from("journalism_queue")
        .update({
          status: "skipped",
          completed_at: new Date().toISOString(),
          error_message: skipReason,
        })
        .eq("id", queueItemId);

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
        console.log("📋 Chaining to next item (fire-and-forget)...");
        const secret = Deno.env.get("QUEUE_PROCESSOR_SECRET")!;
        fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseKey}`,
            "x-internal-secret": secret,
          },
          body: JSON.stringify({ queueItemId: nextItem.id }),
        }).catch(err => console.warn("Chain invoke error (non-fatal):", err?.message));
      }

      return new Response(
        JSON.stringify({ skipped: true, reason: skipReason, queueItemId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract title and content
    const lines = storyContent.split("\n").filter((line: string) => line.trim());
    let title = lines[0]
      .replace(/^#+\s*/, "")
      .replace(/^HEADLINE:\s*/i, "")
      .trim() || "Untitled Story";
    
    const content = lines.slice(1).join("\n").trim();
    const source_id = queueItem.artifact.source_id || null;
    const heroImageUrl = queueItem.artifact.hero_image_url || null;

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
    await supabase
      .from("journalism_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        story_id: newStory.id,
      })
      .eq("id", queueItemId);

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
      console.log("📋 Chaining to next item (fire-and-forget)...");
      const INTERNAL_SECRET = Deno.env.get('QUEUE_PROCESSOR_SECRET')!;
      fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseKey}`,
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({ queueItemId: nextItem.id }),
      }).catch(err => console.warn("Chain invoke error (non-fatal):", err?.message));
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
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseKey);

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
            console.log("📋 Chaining to next item after failure (fire-and-forget)...");
            const secret = Deno.env.get("QUEUE_PROCESSOR_SECRET")!;
            fetch(`${supabaseUrl}/functions/v1/process-journalism-queue-item`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseKey}`,
                "x-internal-secret": secret,
              },
              body: JSON.stringify({ queueItemId: nextItem.id }),
            }).catch(err => console.warn("Chain invoke error (non-fatal):", err?.message));
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
