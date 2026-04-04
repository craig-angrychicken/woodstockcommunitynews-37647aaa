import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient, getSupabaseUrl } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";

const MAX_STORIES_PER_RUN = 20;

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  console.log("🖊️ run-ai-editor started");

  const supabase = createSupabaseClient();

  const summary = { published: 0, rejected: 0, featured: 0, skipped: 0, errors: 0, facebook_posted: 0, facebook_failed: 0 };

  try {
    // Step 1: Fetch active editor prompt
    const { data: editorPrompt, error: promptError } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("prompt_type", "editor")
      .eq("is_active", true)
      .single();

    if (promptError || !editorPrompt) {
      throw new Error("No active editor prompt found");
    }

    console.log(`📝 Using editor prompt: ${editorPrompt.version_name}`);

    // Step 2: Fetch model config
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

    // Step 3: Fetch edited production stories (excludes those with 3+ failed publish attempts)
    const { data: editedStories, error: editedError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        content,
        publish_attempts
      `)
      .eq("status", "edited")
      .eq("environment", "production")
      .eq("is_test", false)
      .lt("publish_attempts", 3)
      .order("created_at", { ascending: true })
      .limit(MAX_STORIES_PER_RUN);

    if (editedError) {
      throw new Error(`Failed to fetch edited stories: ${editedError.message}`);
    }

    const storyList = editedStories || [];
    console.log(`📚 Found ${storyList.length} pending stories to evaluate`);

    // Query recent featured count for context
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { count: recentFeaturedCount } = await supabase
      .from("stories")
      .select("id", { count: "exact", head: true })
      .eq("featured", true)
      .eq("status", "published")
      .gte("published_at", sevenDaysAgo.toISOString());

    const featuredThisWeek = recentFeaturedCount || 0;
    console.log(`⭐ Featured stories in last 7 days: ${featuredThisWeek}`);

    if (storyList.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No pending stories to evaluate", ...summary }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 4: Evaluate each story
    for (const story of storyList) {
      const storyTitle = story.title || "Untitled";
      console.log(`\n🔍 Evaluating: "${storyTitle}" (${story.id})`);

      try {
        // Build evaluation prompt with featured context
        const featuredContext = `\n\nFEATURED CONTEXT: ${featuredThisWeek} stories have been featured in the last 7 days. ${
          featuredThisWeek === 0
            ? "The featured section is EMPTY — be more willing to feature a high-impact story."
            : "The minimum of 1/week is met; only feature truly standout community stories."
        }`;

        const fullPrompt = `${editorPrompt.content}${featuredContext}

HEADLINE: ${storyTitle}

${story.content || ""}`;

        // Call LLM via shared client
        const llmResponse = await callLLM({
          prompt: fullPrompt,
          modelConfig,
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
          // Invoke publish-story (handles slug, status, revalidation, and Facebook)
          const { data: publishData, error: publishError } = await supabase.functions.invoke(
            "publish-story",
            {
              body: {
                storyId: story.id,
                featured: isFeatured,
              },
            }
          );

          if (publishError || !publishData?.success) {
            const errMsg = publishError?.message || publishData?.error || "Unknown publish error";
            const attempts = ((story as Record<string, unknown>).publish_attempts as number || 0) + 1;
            console.error(`❌ Publish failed for story ${story.id} (attempt ${attempts}/3): ${errMsg}`);
            await supabase
              .from("stories")
              .update({ publish_attempts: attempts })
              .eq("id", story.id);
            summary.errors++;
            continue;
          }

          console.log(`${isFeatured ? "⭐" : "✅"} Published${isFeatured ? " (featured)" : ""}: "${storyTitle}" → ${publishData.url}`);
          summary.published++;
          if (isFeatured) summary.featured++;
        } else if (upperVerdict.startsWith("REJECT:")) {
          const reason = verdict.slice(7).trim();

          await supabase
            .from("stories")
            .update({
              status: "rejected",
              editor_notes: reason,
            })
            .eq("id", story.id);

          console.log(`🚫 Rejected: "${storyTitle}" — ${reason}`);
          summary.rejected++;
        } else {
          // Unexpected response — fail-safe, leave as pending
          console.warn(`⚠️ Unexpected verdict for story ${story.id}: "${verdict.substring(0, 100)}" — leaving as pending`);
          summary.skipped++;
        }
      } catch (storyErr) {
        console.error(`❌ Error evaluating story ${story.id}:`, storyErr);
        summary.errors++;
        // Leave as pending
      }
    }

    console.log(`\n✅ AI Editor run complete:`, summary);

    return new Response(
      JSON.stringify({ success: true, ...summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Fatal error in run-ai-editor:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        ...summary,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
