// Generate a council coverage story (preview, update, or recap) for a meeting.
// Each story type uses a different prompt and references prior stories in the chain.

import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { callLLM } from "../_shared/llm-client.ts";
import { extractPdfText } from "../_shared/pdf-extract.ts";

type StoryType = "preview" | "update" | "recap";

interface CouncilMeeting {
  id: string;
  granicus_clip_id: number;
  meeting_type: string;
  meeting_date: string;
  agenda_url: string | null;
  agenda_content: string | null;
  packet_url: string | null;
  packet_content: string | null;
  minutes_url: string | null;
  minutes_content: string | null;
  preview_story_id: string | null;
  update_story_id: string | null;
  recap_story_id: string | null;
}

interface StoryRecord {
  id: string;
  title: string;
  content: string | null;
}

function formatMeetingDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function buildPreviewPrompt(meeting: CouncilMeeting): string {
  const date = formatMeetingDate(meeting.meeting_date);
  return `You are a veteran community journalist for Woodstock Community News covering the City of Woodstock government beat. Write a PREVIEW story about an upcoming ${meeting.meeting_type} meeting.

## Meeting Details
- Type: ${meeting.meeting_type}
- Date: ${date}
- Agenda: ${meeting.agenda_url || "N/A"}

## Agenda Content
${meeting.agenda_content || "(Agenda content not available)"}

## Instructions
Write an informative preview story that:
1. Leads with when the meeting will take place
2. Highlights the most newsworthy agenda items (zoning decisions, budget items, ordinance changes, appointments, public hearings)
3. Explains why each key item matters to Woodstock residents
4. Notes any items that involve public participation or hearings
5. Keeps a neutral, informative tone appropriate for civic coverage
6. Uses AP style, third person, future tense for the meeting itself

## Headline and Subhead Rules (CRITICAL)
- The headline MUST include the exact calendar date of the meeting (e.g., "March 23" or "March 23, 2026"). NEVER use relative time references like "Monday," "Monday night," "tonight," "this week," "next week," or "upcoming." These become meaningless after the date passes.
- The subhead MUST mention that the story is based on the published agenda (e.g., "Based on the published agenda, ..." or "A look at the agenda for ...").

Respond ONLY with JSON (no markdown fencing):
{"headline":"...","subhead":"...","byline":"Woodstock Community News Staff","source_name":"City of Woodstock","source_url":"${meeting.agenda_url || ""}","body":["paragraph1","paragraph2","..."],"skip":false}`;
}

function buildUpdatePrompt(meeting: CouncilMeeting, previewStory: StoryRecord | null): string {
  const date = formatMeetingDate(meeting.meeting_date);
  const priorCoverage = previewStory
    ? `## Previously Published Preview\nHeadline: ${previewStory.title}\n\n${previewStory.content || ""}`
    : "(No prior preview was published for this meeting)";

  return `You are a veteran community journalist for Woodstock Community News. Write an UPDATE story with additional details from the full agenda packet for an upcoming ${meeting.meeting_type} meeting.

## Meeting Details
- Type: ${meeting.meeting_type}
- Date: ${date}
- Agenda Packet: ${meeting.packet_url || "N/A"}

${priorCoverage}

## Agenda Packet Content (new material)
${meeting.packet_content || "(Packet content not available)"}

## Instructions
Write an update story that:
1. Opens by noting this is an update with additional details from the full agenda packet
2. References the prior preview if one exists ("As Woodstock Community News previously reported...")
3. Focuses on NEW information from the packet that was not in the original agenda (supporting documents, staff recommendations, financial details, maps, proposed text of ordinances)
4. Highlights any items that residents should pay attention to
5. Does NOT simply repeat the preview — add new value
6. Uses AP style, third person

## Headline and Subhead Rules (CRITICAL)
- The headline MUST include the exact calendar date of the meeting (e.g., "March 23" or "March 23, 2026"). NEVER use relative time references like "Monday," "Monday night," "tonight," "this week," "next week," or "upcoming." These become meaningless after the date passes.
- The subhead MUST mention that the story is based on the full agenda packet (e.g., "Based on the full agenda packet, ..." or "New details from the agenda packet for ...").

Respond ONLY with JSON (no markdown fencing):
{"headline":"...","subhead":"...","byline":"Woodstock Community News Staff","source_name":"City of Woodstock","source_url":"${meeting.packet_url || ""}","body":["paragraph1","paragraph2","..."],"skip":false}`;
}

function buildRecapPrompt(
  meeting: CouncilMeeting,
  previewStory: StoryRecord | null,
  updateStory: StoryRecord | null,
): string {
  const date = formatMeetingDate(meeting.meeting_date);

  let priorCoverage = "";
  if (previewStory) {
    priorCoverage += `### Preview Story\nHeadline: ${previewStory.title}\n\n${previewStory.content || ""}\n\n`;
  }
  if (updateStory) {
    priorCoverage += `### Update Story\nHeadline: ${updateStory.title}\n\n${updateStory.content || ""}\n\n`;
  }
  if (!priorCoverage) {
    priorCoverage = "(No prior coverage was published for this meeting)\n";
  }

  return `You are a veteran community journalist for Woodstock Community News. Write a RECAP story about a ${meeting.meeting_type} meeting that has already occurred.

## Meeting Details
- Type: ${meeting.meeting_type}
- Date: ${date}

## Previously Published Coverage
${priorCoverage}

## Official Minutes
${meeting.minutes_content || "(Minutes content not available)"}

## Instructions
Write a recap story that:
1. Leads with the most significant actions taken (votes, approvals, denials)
2. References prior coverage if it exists ("Following the agenda items Woodstock Community News previewed last week...")
3. Reports what actually happened vs. what was anticipated
4. Notes vote tallies for significant items
5. Includes any notable public comments or council discussion
6. Uses past tense since the meeting has occurred
7. Notes any items tabled or continued to future meetings
8. Uses AP style, third person

## Headline and Subhead Rules (CRITICAL)
- The headline MUST include the exact calendar date of the meeting (e.g., "March 23" or "March 23, 2026"). NEVER use relative time references like "Monday," "Monday night," "tonight," "this week," "next week," or "upcoming." These become meaningless after the date passes.
- The subhead MUST mention that the story is based on the official meeting minutes (e.g., "Based on the official minutes, ..." or "From the minutes of the ...").

Respond ONLY with JSON (no markdown fencing):
{"headline":"...","subhead":"...","byline":"Woodstock Community News Staff","source_name":"City of Woodstock","source_url":"${meeting.minutes_url || ""}","body":["paragraph1","paragraph2","..."],"skip":false}`;
}

async function fetchStory(supabase: ReturnType<typeof createSupabaseClient>, storyId: string | null): Promise<StoryRecord | null> {
  if (!storyId) return null;
  const { data } = await supabase
    .from("stories")
    .select("id, title, content")
    .eq("id", storyId)
    .single();
  return data as StoryRecord | null;
}

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const supabase = createSupabaseClient();

  try {
    const { meetingId, storyType } = await req.json() as { meetingId: string; storyType: StoryType };

    if (!meetingId || !storyType) {
      throw new Error("meetingId and storyType are required");
    }

    if (!["preview", "update", "recap"].includes(storyType)) {
      throw new Error(`Invalid storyType: ${storyType}`);
    }

    console.log(`🖊️ Generating ${storyType} story for meeting ${meetingId}`);

    // Fetch meeting data
    const { data: meeting, error: meetingError } = await supabase
      .from("council_meetings")
      .select("*")
      .eq("id", meetingId)
      .single();

    if (meetingError || !meeting) {
      throw new Error(`Meeting not found: ${meetingError?.message || meetingId}`);
    }

    // Check if story already exists for this type
    const storyIdCol = `${storyType === "preview" ? "preview" : storyType === "update" ? "update" : "recap"}_story_id`;
    if (meeting[storyIdCol]) {
      console.log(`⏭️ ${storyType} story already exists for this meeting, skipping`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "Story already exists" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extract PDF content if not already done
    const docMap: Record<string, { urlCol: string; contentCol: string }> = {
      preview: { urlCol: "agenda_url", contentCol: "agenda_content" },
      update: { urlCol: "packet_url", contentCol: "packet_content" },
      recap: { urlCol: "minutes_url", contentCol: "minutes_content" },
    };
    const { urlCol, contentCol } = docMap[storyType];
    if (meeting[urlCol] && !meeting[contentCol]) {
      console.log(`📄 Extracting PDF for ${storyType}: ${meeting[urlCol]}`);
      try {
        const text = await extractPdfText(meeting[urlCol] as string);
        meeting[contentCol] = text;
        await supabase
          .from("council_meetings")
          .update({ [contentCol]: text })
          .eq("id", meetingId);
        console.log(`  ✅ Extracted ${text.length} chars`);
      } catch (err) {
        console.warn(`  ⚠️ PDF extraction failed:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Fetch prior stories in the chain
    const previewStory = await fetchStory(supabase, meeting.preview_story_id);
    const updateStory = await fetchStory(supabase, meeting.update_story_id);

    // Build the appropriate prompt
    let prompt: string;
    switch (storyType) {
      case "preview":
        prompt = buildPreviewPrompt(meeting as CouncilMeeting);
        break;
      case "update":
        prompt = buildUpdatePrompt(meeting as CouncilMeeting, previewStory);
        break;
      case "recap":
        prompt = buildRecapPrompt(meeting as CouncilMeeting, previewStory, updateStory);
        break;
    }

    // Fetch model config
    const { data: modelSettings, error: settingsError } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_model_config")
      .single();

    if (settingsError || !modelSettings) {
      throw new Error("Failed to fetch model configuration");
    }

    const modelConfig = modelSettings.value as { model_name: string; model_provider: string };

    // Call LLM
    const llmResponse = await callLLM({
      prompt,
      modelConfig,
      maxTokens: 4000,
      temperature: 0.5,
      appTitle: "Woodstock Community News - Council Coverage",
    });

    // Parse response
    let parsed: { headline: string; subhead: string; byline: string; source_name: string; source_url: string; body: string[]; skip?: boolean };
    try {
      const cleaned = llmResponse.content
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse LLM response as JSON: ${llmResponse.content.slice(0, 200)}`);
    }

    if (parsed.skip) {
      console.log(`⏭️ LLM chose to skip: ${storyType}`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "LLM skipped" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Strip em/en dashes (matching existing pipeline behavior)
    const title = parsed.headline.replace(/[\u2013\u2014]/g, "-");
    const content = parsed.body.map(p => p.replace(/[\u2013\u2014]/g, "-")).join("\n\n");
    const wordCount = content.split(/\s+/).length;

    // Insert story
    const { data: newStory, error: storyError } = await supabase
      .from("stories")
      .insert({
        title,
        content,
        status: "pending",
        environment: "production",
        is_test: false,
        word_count: wordCount,
        source_count: 1,
        council_meeting_id: meetingId,
        story_type: storyType,
        structured_metadata: {
          subhead: parsed.subhead,
          byline: parsed.byline || "Woodstock Community News Staff",
          source_name: parsed.source_name || "City of Woodstock",
          source_url: parsed.source_url || "",
        },
        generation_metadata: {
          model: llmResponse.model || modelConfig.model_name,
          provider: modelConfig.model_provider,
          prompt_tokens: llmResponse.usage?.prompt_tokens,
          completion_tokens: llmResponse.usage?.completion_tokens,
          pipeline: "council_coverage",
          story_type: storyType,
        },
      })
      .select()
      .single();

    if (storyError || !newStory) {
      throw new Error(`Failed to insert story: ${storyError?.message}`);
    }

    // Update meeting with story reference
    await supabase
      .from("council_meetings")
      .update({ [storyIdCol]: newStory.id, updated_at: new Date().toISOString() })
      .eq("id", meetingId);

    console.log(`✅ ${storyType} story created: "${title}" (${newStory.id})`);

    return new Response(
      JSON.stringify({ success: true, storyId: newStory.id, title }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ generate-council-story error:`, msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
