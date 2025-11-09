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

    // Get all artifact IDs that are already used in stories
    const { data: usedArtifacts, error: usedError } = await supabase
      .from('story_artifacts')
      .select('artifact_id');

    if (usedError) {
      console.error('⚠️ Error fetching used artifacts:', usedError);
      // Continue anyway - better to process duplicates than fail completely
    }

    const usedArtifactIds = new Set(usedArtifacts?.map(sa => sa.artifact_id) || []);
    console.log(`📊 Found ${usedArtifactIds.size} artifacts already used in stories`);

    // Fetch artifacts without applying maxArtifacts limit yet (we'll apply it after filtering)
    const { data: allArtifacts, error: artifactsError } = await artifactsQuery;

    if (artifactsError) {
      throw new Error(`Failed to fetch artifacts: ${artifactsError.message}`);
    }

    // Filter out artifacts that are already used in stories
    let artifacts = allArtifacts?.filter(a => !usedArtifactIds.has(a.id)) || [];

    // Apply maxArtifacts limit AFTER filtering (only if not using specific artifact IDs)
    if (maxArtifacts && (!artifactIds || artifactIds.length === 0) && artifacts.length > maxArtifacts) {
      artifacts = artifacts.slice(0, maxArtifacts);
    }

    console.log(`📊 Artifact filtering results:`);
    console.log(`  - Total artifacts in query range: ${allArtifacts?.length || 0}`);
    console.log(`  - Already used (filtered out): ${(allArtifacts?.length || 0) - artifacts.length}`);
    console.log(`  - Available for processing: ${artifacts.length}`);

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

    // Helper functions
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    const callAIWithRetry = async (
      apiUrl: string,
      headers: HeadersInit,
      body: any,
      maxRetries = 3
    ) => {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        
        if (response.status === 429) {
          const waitTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
          console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
          await sleep(waitTime);
          continue;
        }
        
        return response;
      }
      throw new Error("Max retries exceeded for rate limiting");
    };

    // Start background processing
    const processStories = async () => {
      try {
        console.log(`Processing ${artifacts.length} artifacts (one story per artifact)`);

        let storiesCreated = 0;
        const failures: Array<{
          artifact_id: string;
          artifact_title: string;
          error: string;
        }> = [];

        for (let i = 0; i < artifacts.length; i++) {
          const artifact = artifacts[i];
          console.log(`Processing artifact ${i + 1}/${artifacts.length}: ${artifact.title || artifact.name}`);

          try {
            // Determine API endpoint and key based on provider
            const apiUrl = promptVersion.model_provider === "openrouter" 
              ? "https://openrouter.ai/api/v1/chat/completions"
              : "https://ai.gateway.lovable.dev/v1/chat/completions";
            
            const apiKey = openRouterApiKey;
            const model = promptVersion.model_name || "google/gemini-2.0-flash-exp:free";

            // Try with full content first
            let contentToUse = artifact.content || "No content";
            let attemptNumber = 1;

            const makeAPICall = async (content: string): Promise<Response> => {
              const artifactData = `
Title: ${artifact.title || artifact.name}
Date: ${artifact.date}
Source: ${artifact.source_id}
Content: ${content}
${artifact.image_url ? `Image: ${artifact.image_url}` : ""}
`;

              const fullPrompt = `${promptVersion.content}

## Artifact:
${artifactData}`;

              return await callAIWithRetry(
                apiUrl,
                {
                  Authorization: `Bearer ${apiKey}`,
                  "Content-Type": "application/json",
                  ...(promptVersion.model_provider === "openrouter" && {
                    "HTTP-Referer": supabaseUrl,
                    "X-Title": "Woodstock Wire AI Journalist",
                  }),
                },
                {
                  model: model,
                  messages: [
                    {
                      role: "user",
                      content: fullPrompt,
                    },
                  ],
                  max_tokens: 5000,
                  temperature: 0.6,
                }
              );
            };

            let aiResponse = await makeAPICall(contentToUse);

            // Handle token limit errors by retrying with truncated content
            if (!aiResponse.ok) {
              const errorText = await aiResponse.text();
              
              if (
                (aiResponse.status === 413 || 
                 aiResponse.status === 400 || 
                 errorText.includes("context_length_exceeded") ||
                 errorText.includes("too long")) &&
                contentToUse.length > 20000
              ) {
                console.log(`Token limit hit for artifact ${artifact.id}, retrying with truncated content (20k chars)`);
                contentToUse = contentToUse.substring(0, 20000) + "\n\n[Content truncated due to length...]";
                attemptNumber = 2;
                aiResponse = await makeAPICall(contentToUse);
              }
            }

            if (!aiResponse.ok) {
              const errorText = await aiResponse.text();
              console.error(`✗ AI API error for artifact ${artifact.id}:`, aiResponse.status, errorText);
              failures.push({
                artifact_id: artifact.id,
                artifact_title: artifact.title || artifact.name,
                error: `API error ${aiResponse.status}: ${errorText}`,
              });
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
              console.error(`✗ Failed to insert story for artifact ${artifact.id}:`, storyError);
              failures.push({
                artifact_id: artifact.id,
                artifact_title: artifact.title || artifact.name,
                error: `Database error: ${storyError?.message || "Unknown error"}`,
              });
              continue;
            }

            // Link single artifact to story
            await supabase.from("story_artifacts").insert({
              story_id: newStory.id,
              artifact_id: artifact.id,
            });

            storiesCreated++;
            console.log(`✓ Story ${storiesCreated}/${artifacts.length} created: ${title}`);

            // Add delay between requests to avoid rate limiting
            if (i < artifacts.length - 1) {
              await sleep(2000); // 2 second delay
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "Unknown error";
            console.error(`✗ Error generating story for artifact ${artifact.id}:`, errorMsg);
            failures.push({
              artifact_id: artifact.id,
              artifact_title: artifact.title || artifact.name,
              error: errorMsg,
            });
            continue;
          }
        }

        // Log summary
        console.log(`\n=== Processing Summary ===`);
        console.log(`Total artifacts: ${artifacts.length}`);
        console.log(`Stories created: ${storiesCreated}`);
        console.log(`Failures: ${failures.length}`);

        if (failures.length > 0) {
          console.log("\nFailed artifacts:");
          failures.forEach(f => {
            console.log(`- ${f.artifact_title} (${f.artifact_id}): ${f.error}`);
          });
        }

        // Update history record with detailed status
        await supabase
          .from("query_history")
          .update({
            status: storiesCreated === 0 ? "failed" : "completed",
            stories_count: storiesCreated,
            completed_at: new Date().toISOString(),
            error_message: failures.length > 0 
              ? `${storiesCreated} succeeded, ${failures.length} failed. Check logs for details.`
              : null,
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
