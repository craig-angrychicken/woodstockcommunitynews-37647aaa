import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { queueItemId } = await req.json();

    console.log("🔄 Processing queue item:", queueItemId);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch queue item with artifact and prompt details
    const { data: queueItem, error: queueError } = await supabase
      .from("journalism_queue")
      .select(`
        *,
        artifact:artifacts(*),
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

    // Fetch prompt version
    const { data: promptVersion, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", queueItem.query_history.prompt_version_id)
      .single();

    if (promptError || !promptVersion) {
      throw new Error("Failed to fetch prompt version");
    }

    // Determine environment
    const environment = queueItem.artifact.is_test ? "test" : "production";

    // Prepare content (with truncation if needed)
    let contentToUse = queueItem.artifact.content || "No content";
    if (contentToUse.length > 20000) {
      contentToUse = contentToUse.substring(0, 20000) + "\n\n[Content truncated due to length...]";
    }

    // Build prompt
    const artifactData = `
Title: ${queueItem.artifact.title || queueItem.artifact.name}
Date: ${queueItem.artifact.date}
Source: ${queueItem.artifact.source_id}
Content: ${contentToUse}
${queueItem.artifact.image_url ? `Image: ${queueItem.artifact.image_url}` : ""}
`;

    const fullPrompt = `${promptVersion.content}

## Artifact:
${artifactData}`;

    // Call AI API
    const apiUrl = promptVersion.model_provider === "openrouter" 
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    
    const model = promptVersion.model_name || "google/gemini-2.0-flash-exp:free";

    const aiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        ...(promptVersion.model_provider === "openrouter" && {
          "HTTP-Referer": supabaseUrl,
          "X-Title": "Woodstock Wire AI Journalist",
        }),
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: fullPrompt,
          },
        ],
        max_tokens: 5000,
        temperature: 0.6,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error ${aiResponse.status}: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    const storyContent = aiData.choices?.[0]?.message?.content || "No content generated";

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
    const { data: queueStats } = await supabase
      .from("journalism_queue")
      .select("status")
      .eq("query_history_id", queueItem.query_history_id);

    const completed = queueStats?.filter(q => q.status === "completed").length || 0;
    const failed = queueStats?.filter(q => q.status === "failed").length || 0;
    const total = queueStats?.length || 0;

    await supabase
      .from("query_history")
      .update({
        stories_count: completed,
        artifacts_count: total,
        status: completed + failed === total ? "completed" : "running",
      })
      .eq("id", queueItem.query_history_id);

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
      console.log("📋 Processing next item in queue...");
      // Trigger next item processing
      await supabase.functions.invoke("process-journalism-queue-item", {
        body: { queueItemId: nextItem.id },
      });
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
    try {
      const { queueItemId } = await req.json();
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
    } catch (updateError) {
      console.error("Failed to update queue item status:", updateError);
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
