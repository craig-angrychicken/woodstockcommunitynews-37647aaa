import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_STORIES_PER_RUN = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  console.log("🖊️ run-ai-editor started");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing required environment variables" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const summary = { published: 0, rejected: 0, featured: 0, skipped: 0, errors: 0 };

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

    // Step 3: Fetch pending production stories (with linked artifact for publish-to-ghost)
    const { data: stories, error: storiesError } = await supabase
      .from("stories")
      .select(`
        id,
        title,
        content,
        hero_image_url,
        story_artifacts(artifact_id)
      `)
      .eq("status", "pending")
      .eq("environment", "production")
      .eq("is_test", false)
      .order("created_at", { ascending: true })
      .limit(MAX_STORIES_PER_RUN);

    if (storiesError) {
      throw new Error(`Failed to fetch pending stories: ${storiesError.message}`);
    }

    const storyList = stories || [];
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

    // Determine LLM API endpoint and auth
    const isOpenRouter = modelConfig.model_provider === "openrouter";
    const apiUrl = isOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";

    const authToken = isOpenRouter ? openRouterApiKey : LOVABLE_API_KEY;
    if (!authToken) {
      throw new Error(isOpenRouter ? "OPENROUTER_API_KEY not configured" : "LOVABLE_API_KEY not configured");
    }

    const llmHeaders: Record<string, string> = {
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    };
    if (isOpenRouter) {
      llmHeaders["HTTP-Referer"] = supabaseUrl;
      llmHeaders["X-Title"] = "Woodstock Community News AI Editor";
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

        // Call LLM
        const aiResponse = await fetch(apiUrl, {
          method: "POST",
          headers: llmHeaders,
          body: JSON.stringify({
            model: modelConfig.model_name,
            messages: [{ role: "user", content: fullPrompt }],
            max_tokens: 200,
            temperature: 0.2,
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`❌ LLM error for story ${story.id}: ${aiResponse.status} ${errorText}`);
          summary.errors++;
          continue; // Fail-safe: leave as pending
        }

        const aiData = await aiResponse.json();
        const verdict = (aiData.choices?.[0]?.message?.content || "").trim();

        console.log(`📋 Verdict for "${storyTitle}": ${verdict.substring(0, 100)}`);

        const upperVerdict = verdict.toUpperCase().trim();
        const isFeatured = upperVerdict === "PUBLISH_FEATURED";
        const isPublish = upperVerdict === "PUBLISH" || isFeatured;

        if (isPublish) {
          // Get artifact_id for storage cleanup
          const artifactId = (story.story_artifacts as any[])?.[0]?.artifact_id || null;

          // Invoke publish-to-ghost
          const { data: publishData, error: publishError } = await supabase.functions.invoke(
            "publish-to-ghost",
            {
              body: {
                title: storyTitle,
                content: story.content,
                status: "published",
                heroImageUrl: story.hero_image_url || null,
                artifactId,
                featured: isFeatured,
              },
            }
          );

          if (publishError || !publishData?.success) {
            const errMsg = publishError?.message || publishData?.error || "Unknown publish error";
            console.error(`❌ Publish failed for story ${story.id}: ${errMsg}`);
            summary.errors++;
            continue; // Leave as pending on publish failure
          }

          // Update story status and ghost_url in DB
          await supabase
            .from("stories")
            .update({
              status: "published",
              ghost_url: publishData.url || null,
              featured: isFeatured,
            })
            .eq("id", story.id);

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
