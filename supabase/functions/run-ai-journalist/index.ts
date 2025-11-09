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
      artifactIds,
    } = await req.json();

    console.log("AI Journalist run started:", {
      dateFrom,
      dateTo,
      environment,
      promptVersionId,
      historyId,
      maxArtifacts,
      artifactIds,
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

    // Fetch artifacts by IDs or date range
    let artifactsQuery = supabase
      .from("artifacts")
      .select("*");

    if (artifactIds && artifactIds.length > 0) {
      // Use specific artifact IDs
      artifactsQuery = artifactsQuery.in("id", artifactIds);
    } else {
      // Use date range
      artifactsQuery = artifactsQuery
        .gte("date", dateFrom)
        .lte("date", dateTo)
        .order("date", { ascending: false });
    }

    if (environment === "test") {
      artifactsQuery = artifactsQuery.eq("is_test", true);
    } else {
      artifactsQuery = artifactsQuery.eq("is_test", false);
    }

    if (maxArtifacts && (!artifactIds || artifactIds.length === 0)) {
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
          message: "No artifacts found",
          historyId,
        }),
        { 
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    // Start background processing
    const processStories = async () => {
      try {
        console.log(`Processing ${artifacts.length} artifacts (one story per artifact)`);

        // Generate one story per artifact
        let storiesCreated = 0;

        for (let i = 0; i < artifacts.length; i++) {
          const artifact = artifacts[i];
          console.log(`Processing artifact ${i + 1}/${artifacts.length}: ${artifact.title || artifact.name}`);

          // Prepare the prompt with single artifact data
          const artifactData = `
Title: ${artifact.title || artifact.name}
Date: ${artifact.date}
Source: ${artifact.source_id}
Content: ${artifact.content || "No content"}
${artifact.image_url ? `Image: ${artifact.image_url}` : ""}
`;

          const fullPrompt = `${promptVersion.content}

## Artifact:
${artifactData}

Generate a compelling news story based on this artifact.`;

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
                max_tokens: 5000,
                temperature: 0.7,
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

            // Extract title and content properly
            const lines = storyContent.split("\n").filter((line: string) => line.trim());
            let title = lines[0]
              .replace(/^#+\s*/, "")
              .replace(/^HEADLINE:\s*/i, "")
              .trim() || "Untitled Story";
            
            const content = lines.slice(1).join("\n").trim();
            const source_id = artifact.source_id || null;

            // Insert story
            const { data: newStory, error: storyError } = await supabase
              .from("stories")
              .insert({
                title,
                content,
                source_id,
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

            // Link single artifact to story
            await supabase.from("story_artifacts").insert({
              story_id: newStory.id,
              artifact_id: artifact.id,
            });

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

        console.log(`Background processing complete: ${storiesCreated} stories created`);
      } catch (error) {
        console.error("Background processing error:", error);
        await supabase
          .from("query_history")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : "Unknown error",
            completed_at: new Date().toISOString(),
          })
          .eq("id", historyId);
      }
    };

    // Start background processing without waiting for it to complete
    processStories();

    // Return immediately with 202 Accepted
    return new Response(
      JSON.stringify({
        success: true,
        message: "AI Journalist started",
        historyId,
        artifactsCount: artifacts.length,
      }),
      { 
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
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
