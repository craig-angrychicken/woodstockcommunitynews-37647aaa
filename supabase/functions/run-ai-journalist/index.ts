import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      maxArtifacts,
    } = await req.json();

    console.log("AI Journalist run started:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      maxArtifacts,
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the prompt version
    const { data: promptVersion, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("id", promptVersionId)
      .single();

    if (promptError || !promptVersion) {
      throw new Error("Failed to fetch prompt version");
    }

    // Fetch artifacts in the date range
    let artifactsQuery = supabase
      .from("artifacts")
      .select("*")
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("date", { ascending: false });

    if (environment === "test") {
      artifactsQuery = artifactsQuery.eq("is_test", true);
    } else {
      artifactsQuery = artifactsQuery.eq("is_test", false);
    }

    if (maxArtifacts) {
      artifactsQuery = artifactsQuery.limit(maxArtifacts);
    }

    const { data: artifacts, error: artifactsError } = await artifactsQuery;

    if (artifactsError) {
      throw new Error(`Failed to fetch artifacts: ${artifactsError.message}`);
    }

    console.log(`Found ${artifacts?.length || 0} artifacts to process`);

    if (!artifacts || artifacts.length === 0) {
      await supabase
        .from("query_history")
        .update({
          status: "completed",
          stories_count: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);

      return new Response(
        JSON.stringify({
          success: true,
          message: "No artifacts found in the specified date range",
          storiesCreated: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group artifacts for story generation (in batches of 3-5)
    const storyBatches: any[][] = [];
    let currentBatch: any[] = [];

    for (const artifact of artifacts) {
      currentBatch.push(artifact);
      if (currentBatch.length >= 3) {
        storyBatches.push([...currentBatch]);
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      storyBatches.push(currentBatch);
    }

    console.log(`Created ${storyBatches.length} story batches`);

    // Generate stories from batches
    let storiesCreated = 0;

    for (let i = 0; i < storyBatches.length; i++) {
      const batch = storyBatches[i];
      console.log(`Processing batch ${i + 1}/${storyBatches.length}`);

      // Prepare the prompt with artifact data
      const artifactSummaries = batch
        .map(
          (a, idx) => `
### Artifact ${idx + 1}
Title: ${a.title || a.name}
Date: ${a.date}
Source: ${a.source_id}
Content: ${a.content || "No content"}
${a.image_url ? `Image: ${a.image_url}` : ""}
`
        )
        .join("\n\n");

      const fullPrompt = `${promptVersion.content}

## Artifacts to synthesize:
${artifactSummaries}

Generate a compelling news story that synthesizes the above artifacts.`;

      try {
        // Determine API endpoint and key based on provider
        const apiUrl = promptVersion.model_provider === "openrouter" 
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://ai.gateway.lovable.dev/v1/chat/completions";
        
        const apiKey = openRouterApiKey;
        const model = promptVersion.model_name || "google/gemini-2.0-flash-exp:free";

        console.log(`Using ${promptVersion.model_provider} with model: ${model}`);

        // Call AI API
        const aiResponse = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
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
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error("AI API error:", aiResponse.status, errorText);
          continue;
        }

        const aiData = await aiResponse.json();
        const storyContent =
          aiData.choices?.[0]?.message?.content || "No content generated";

        // Extract title from first line or use a default
        const lines = storyContent.split("\n");
        const title = lines[0].replace(/^#+\s*/, "").trim() || "Untitled Story";
        const content = lines.slice(1).join("\n").trim();

        // Insert story
        const { data: newStory, error: storyError } = await supabase
          .from("stories")
          .insert({
            title,
            content,
            prompt_version_id: promptVersionId,
            environment,
            is_test: environment === "test",
          })
          .select()
          .single();

        if (storyError || !newStory) {
          console.error("Failed to insert story:", storyError);
          continue;
        }

        // Link artifacts to story
        const artifactLinks = batch.map((artifact) => ({
          story_id: newStory.id,
          artifact_id: artifact.id,
        }));

        await supabase.from("story_artifacts").insert(artifactLinks);

        storiesCreated++;
        console.log(`Story created: ${title}`);
      } catch (error) {
        console.error("Error generating story:", error);
        continue;
      }
    }

    // Update history record
    await supabase
      .from("query_history")
      .update({
        status: "completed",
        stories_count: storiesCreated,
        completed_at: new Date().toISOString(),
      })
      .eq("id", historyId);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Generated ${storiesCreated} stories from ${artifacts.length} artifacts`,
        storiesCreated,
        artifactsProcessed: artifacts.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in run-ai-journalist:", error);
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
