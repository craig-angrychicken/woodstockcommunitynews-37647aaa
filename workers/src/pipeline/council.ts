/**
 * Council coverage pipeline (ported from supabase/functions/scrape-council-meetings
 * + generate-council-story).
 *
 * Two exports, transport-agnostic (the orchestrator wires routes/cron):
 *  - scrapeMeetings(env): scrape the Woodstock Granicus portal, upsert
 *    council_meetings rows, detect new agenda/packet/minutes PDFs, and generate
 *    up to MAX_GENERATIONS_PER_RUN missing stories (newest meetings first).
 *  - generateCouncilStory(env, meetingId, storyType): generate a single
 *    preview/update/recap story for a meeting.
 *
 * Platform changes vs the Deno originals:
 *  - No Supabase client / no `supabase.functions.invoke`. Data access goes
 *    through the D1 helpers (`all`/`first`/`run`/`insert`), and the scraper
 *    calls `generateCouncilStory` directly (in-process) instead of invoking the
 *    sibling edge function over HTTP.
 *  - `linkedom` is imported normally (no esm.sh dynamic import).
 *  - PDF text extraction uses the shared `../_shared/pdf` `extractPdfText`.
 *  - `callLLM` takes `keys` (OpenRouter/Lovable) and a refererUrl from
 *    PUBLIC_SITE_URL.
 *  - Timestamps are set in code as ISO-8601 TEXT; ids via crypto.randomUUID();
 *    booleans stored as INTEGER 0/1.
 *
 * Council stories are already grounded in the official PDF during generation,
 * so they bypass fact-check and rewrite and land at status `edited`, where
 * run-ai-editor picks them up for publish/reject.
 */
import { parseHTML } from "linkedom";

import type { Env } from "../env";
import type { CouncilMeetingRow, StoryRow, AppSettingRow, LLMModelConfig } from "../_shared/types";
import { first, insert, run, fromJson } from "../_shared/db";
import { fetchPageHTML } from "../_shared/readability";
import { extractPdfText } from "../_shared/pdf";
import { callLLM } from "../_shared/llm-client";

const GRANICUS_URL = "https://woodstockga.granicus.com/ViewPublisher.php?view_id=1";
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

const MAX_GENERATIONS_PER_RUN = 5;

type StoryType = "preview" | "update" | "recap";
type DocumentType = "agenda" | "packet" | "minutes";

interface ParsedMeeting {
  clipId: number | null;
  eventId: number | null;
  meetingType: string;
  meetingDate: Date;
  agendaUrl: string | null;
  packetUrl: string | null;
  minutesUrl: string | null;
}

interface DetectedDocument {
  type: DocumentType;
  url: string;
}

interface MissingStoryJob {
  meetingId: string;
  meetingDate: string;
  storyType: StoryType;
  storyIdCol: "preview_story_id" | "update_story_id" | "recap_story_id";
}

const STAGE_TO_STORY: Record<
  DocumentType,
  { storyType: MissingStoryJob["storyType"]; storyIdCol: MissingStoryJob["storyIdCol"] }
> = {
  agenda: { storyType: "preview", storyIdCol: "preview_story_id" },
  packet: { storyType: "update", storyIdCol: "update_story_id" },
  minutes: { storyType: "recap", storyIdCol: "recap_story_id" },
};

// ─── Granicus parsing helpers ───────────────────────────────────────

/** Parse "Mar 23, 2026 - 06:56 PM" into a Date */
function parseGranicusDate(text: string): Date | null {
  // Strip the time portion after the dash for simpler parsing
  const cleaned = text.replace(/\s*-\s*/, " ").trim();
  const d = new Date(cleaned);
  return isNaN(d.getTime()) ? null : d;
}

/** Extract clip_id from a Granicus URL like AgendaViewer.php?view_id=1&clip_id=625 */
function extractClipId(url: string): number | null {
  const match = url.match(/clip_id=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Extract event_id from a Granicus URL like AgendaViewer.php?view_id=1&event_id=468.
 * Upcoming meetings use event_id until they are recorded; archived meetings use clip_id. */
function extractEventId(url: string): number | null {
  const match = url.match(/event_id=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** Resolve a potentially protocol-relative URL */
function resolveUrl(href: string): string {
  if (href.startsWith("//")) return `https:${href}`;
  return href;
}

/** Parse the Granicus listing page HTML into meeting rows.
 *
 * Granicus HTML uses:
 *   - <tr class="listingRow"> for each meeting
 *   - <td class="listItem" headers="Name"> for meeting type
 *   - <td class="listItem" headers="Date ..."> for date (with &nbsp;)
 *   - Agenda/minutes/packet links in generic <td class="listItem"> cells
 *   - Empty cells have id="AgendaLink not Available" etc.
 */
function parseMeetings(html: string): ParsedMeeting[] {
  const { document } = parseHTML(html);
  const rows = document.querySelectorAll("tr.listingRow");
  const meetings: ParsedMeeting[] = [];
  const cutoff = Date.now() - NINETY_DAYS_MS;

  for (const row of rows) {
    // Extract meeting type — cell with headers containing "Name"
    const cells = row.querySelectorAll("td.listItem");
    let meetingType = "";
    let dateText = "";

    for (const cell of cells) {
      const hdrs = (cell.getAttribute("headers") || "").toLowerCase();
      if (hdrs === "name" || (hdrs.length > 0 && !meetingType)) {
        const scope = cell.getAttribute("scope");
        if (scope === "row" || hdrs === "name") {
          meetingType = (cell.textContent || "").trim();
        }
      }
      if (hdrs.includes("date") || hdrs === "date") {
        dateText = (cell.textContent || "").trim();
      }
    }

    if (!meetingType) continue;
    if (/cancelled|canceled/i.test(meetingType)) continue;

    // Parse date — Granicus uses &nbsp; which becomes \u00a0
    const cleanDate = dateText.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const meetingDate = parseGranicusDate(cleanDate);
    if (!meetingDate || meetingDate.getTime() < cutoff) continue;

    // Extract all links in this row
    const allLinks = row.querySelectorAll("a");
    let agendaUrl: string | null = null;
    let minutesUrl: string | null = null;
    let packetUrl: string | null = null;

    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      const text = (link.textContent || "").trim().toLowerCase();

      if (/AgendaViewer/i.test(href) || text === "agenda") {
        agendaUrl = resolveUrl(href);
      } else if (/MinutesViewer/i.test(href) || text === "minutes") {
        minutesUrl = resolveUrl(href);
      } else if (/\.pdf$/i.test(href) || /cloudfront\.net/i.test(href)) {
        packetUrl = resolveUrl(href);
      }
    }

    // Determine clip_id and/or event_id from agenda or minutes URL. Archived
    // meetings expose clip_id; upcoming meetings only expose event_id.
    let clipId: number | null = null;
    let eventId: number | null = null;
    for (const url of [agendaUrl, minutesUrl, packetUrl]) {
      if (!url) continue;
      if (!clipId) clipId = extractClipId(url);
      if (!eventId) eventId = extractEventId(url);
    }
    if (!clipId && !eventId) continue; // Can't identify the meeting at all

    meetings.push({ clipId, eventId, meetingType, meetingDate, agendaUrl, packetUrl, minutesUrl });
  }

  return meetings;
}

// ─── Scrape + detect + generate ─────────────────────────────────────

export interface ScrapeMeetingsSummary {
  success: boolean;
  meetingsParsed?: number;
  meetingsUpserted?: number;
  documentsDetected?: number;
  missingStages?: number;
  storiesGenerated?: number;
  storiesFailed?: number;
  executionMs?: number;
  error?: string;
}

export async function scrapeMeetings(env: Env): Promise<ScrapeMeetingsSummary> {
  const startTime = Date.now();

  try {
    console.log("🏛️ Scraping Granicus meetings page...");

    // 1. Fetch the listing page
    const fetchResult = await fetchPageHTML(GRANICUS_URL);
    if ("error" in fetchResult) {
      throw new Error(`Failed to fetch Granicus page: ${fetchResult.error}`);
    }

    // 2. Parse meetings from HTML
    const meetings = parseMeetings(fetchResult.html);
    console.log(`📋 Parsed ${meetings.length} recent meetings`);

    let meetingsUpserted = 0;
    let documentsDetected = 0;
    const missingJobs: MissingStoryJob[] = [];

    for (const meeting of meetings) {
      // 3. Look up an existing row by either identifier. A meeting that was
      // first seen while upcoming has only event_id; once it's archived,
      // Granicus assigns clip_id and we need to update the same row rather
      // than creating a duplicate. Fall back to (meeting_type, date) to
      // bridge the transition cleanly.
      let existing: CouncilMeetingRow | null = null;

      if (meeting.clipId) {
        existing = await first<CouncilMeetingRow>(
          env,
          `select * from council_meetings where granicus_clip_id = ? limit 1`,
          meeting.clipId,
        );
      }

      if (!existing && meeting.eventId) {
        existing = await first<CouncilMeetingRow>(
          env,
          `select * from council_meetings where granicus_event_id = ? limit 1`,
          meeting.eventId,
        );
      }

      if (!existing) {
        // Bridge: a previously-upcoming row with the same type and date but
        // no clip_id yet. Match on the calendar date to tolerate minor
        // time-of-day drift between the upcoming and archived listings.
        const dayStart = new Date(meeting.meetingDate);
        dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
        existing = await first<CouncilMeetingRow>(
          env,
          `select * from council_meetings
            where meeting_type = ?
              and meeting_date >= ?
              and meeting_date < ?
            limit 1`,
          meeting.meetingType,
          dayStart.toISOString(),
          dayEnd.toISOString(),
        );
      }

      // 4. Track newly-detected documents (for detection timestamps only)
      const newDocs: DetectedDocument[] = [];

      if (meeting.agendaUrl && !existing?.agenda_url) {
        newDocs.push({ type: "agenda", url: meeting.agendaUrl });
      }
      if (meeting.packetUrl && !existing?.packet_url) {
        newDocs.push({ type: "packet", url: meeting.packetUrl });
      }
      if (meeting.minutesUrl && !existing?.minutes_url) {
        newDocs.push({ type: "minutes", url: meeting.minutesUrl });
      }

      // 5. Build the write payload. Only set ids when we have them so we
      // don't clobber a clip_id with NULL when the archived listing drops a
      // meeting we previously saw while upcoming.
      const nowIso = new Date().toISOString();
      const writeData: Record<string, unknown> = {
        meeting_type: meeting.meetingType,
        meeting_date: meeting.meetingDate.toISOString(),
        updated_at: nowIso,
      };
      if (meeting.clipId) writeData.granicus_clip_id = meeting.clipId;
      if (meeting.eventId) writeData.granicus_event_id = meeting.eventId;
      if (meeting.agendaUrl) writeData.agenda_url = meeting.agendaUrl;
      if (meeting.packetUrl) writeData.packet_url = meeting.packetUrl;
      if (meeting.minutesUrl) writeData.minutes_url = meeting.minutesUrl;
      for (const doc of newDocs) {
        writeData[`${doc.type}_detected_at`] = nowIso;
      }

      let upserted: CouncilMeetingRow | null = null;
      if (existing) {
        const cols = Object.keys(writeData);
        const setClause = cols.map((c) => `${c} = ?`).join(", ");
        const values = cols.map((c) => writeData[c]);
        upserted = await first<CouncilMeetingRow>(
          env,
          `update council_meetings set ${setClause} where id = ? returning *`,
          ...values,
          existing.id,
        );
        if (!upserted) {
          console.error(`❌ Update failed for meeting ${existing.id}`);
          continue;
        }
      } else {
        const id = crypto.randomUUID();
        try {
          upserted = await insert<CouncilMeetingRow>(env, "council_meetings", {
            id,
            created_at: nowIso,
            ...writeData,
          });
        } catch (err) {
          console.error(
            `❌ Insert failed for ${meeting.meetingType} ${meeting.meetingDate.toISOString()}:`,
            err instanceof Error ? err.message : String(err),
          );
          continue;
        }
      }
      if (!upserted) continue;

      meetingsUpserted++;
      documentsDetected += newDocs.length;

      // 6. Collect any stage where a PDF exists but the story is missing.
      // This catches both newly-detected PDFs AND historical meetings whose
      // original fire-and-forget generation failed or never ran.
      const stages: DocumentType[] = ["agenda", "packet", "minutes"];
      for (const stage of stages) {
        const urlKey = `${stage}_url` as keyof CouncilMeetingRow;
        const hasPdf = !!upserted[urlKey];
        const { storyType, storyIdCol } = STAGE_TO_STORY[stage];
        const storyMissing = !upserted[storyIdCol];

        if (hasPdf && storyMissing) {
          missingJobs.push({
            meetingId: upserted.id,
            meetingDate: upserted.meeting_date,
            storyType,
            storyIdCol,
          });
        }
      }
    }

    // 7. Generate missing stories — capped and sequential so LLM costs stay
    // bounded and failures are visible in the cron log. Newest meetings first.
    missingJobs.sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
    const jobsToRun = missingJobs.slice(0, MAX_GENERATIONS_PER_RUN);

    console.log(
      `📝 ${missingJobs.length} stage(s) missing stories — will generate ${jobsToRun.length} this run (cap ${MAX_GENERATIONS_PER_RUN})`,
    );

    let storiesGenerated = 0;
    let storiesFailed = 0;

    for (const job of jobsToRun) {
      try {
        console.log(`  🖊️ Generating ${job.storyType} for meeting ${job.meetingId} (${job.meetingDate})`);
        const result = await generateCouncilStory(env, job.meetingId, job.storyType);
        if (result.success === false) {
          storiesFailed++;
          console.warn(`  ⚠️ ${job.storyType} generation returned error:`, result.error);
        } else {
          storiesGenerated++;
          console.log(`  ✅ ${job.storyType} generated (skipped=${result.skipped ?? false})`);
        }
      } catch (err) {
        storiesFailed++;
        console.warn(`  ⚠️ Exception generating ${job.storyType}:`, err instanceof Error ? err.message : String(err));
      }
    }

    const duration = Date.now() - startTime;
    const summary: ScrapeMeetingsSummary = {
      success: true,
      meetingsParsed: meetings.length,
      meetingsUpserted,
      documentsDetected,
      missingStages: missingJobs.length,
      storiesGenerated,
      storiesFailed,
      executionMs: duration,
    };

    console.log("✅ Council scrape complete:", JSON.stringify(summary));
    return summary;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ scrape-council-meetings error:", msg);
    return { success: false, error: msg };
  }
}

// ─── Story generation ───────────────────────────────────────────────

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

function buildPreviewPrompt(meeting: CouncilMeetingRow): string {
  const date = formatMeetingDate(meeting.meeting_date);
  return `You are a community journalist for Woodstock Community News covering the City of Woodstock government beat. Write a PREVIEW story about an upcoming ${meeting.meeting_type} meeting. Do not guess at geographic or spatial details — do not describe where places are relative to streets or landmarks unless the source documents explicitly state it.

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

function buildUpdatePrompt(meeting: CouncilMeetingRow, previewStory: StoryRecord | null): string {
  const date = formatMeetingDate(meeting.meeting_date);
  const priorCoverage = previewStory
    ? `## Previously Published Preview\nHeadline: ${previewStory.title}\n\n${previewStory.content || ""}`
    : "(No prior preview was published for this meeting)";

  return `You are a community journalist for Woodstock Community News. Write an UPDATE story with additional details from the full agenda packet for an upcoming ${meeting.meeting_type} meeting. Do not guess at geographic or spatial details — do not describe where places are relative to streets or landmarks unless the source documents explicitly state it.

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
  meeting: CouncilMeetingRow,
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

  return `You are a community journalist for Woodstock Community News. Write a RECAP story about a ${meeting.meeting_type} meeting that has already occurred. Do not guess at geographic or spatial details — do not describe where places are relative to streets or landmarks unless the source documents explicitly state it.

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

async function fetchStory(env: Env, storyId: string | null): Promise<StoryRecord | null> {
  if (!storyId) return null;
  return first<StoryRecord>(
    env,
    `select id, title, content from stories where id = ? limit 1`,
    storyId,
  );
}

export interface GenerateCouncilStoryResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  storyId?: string;
  title?: string;
  error?: string;
}

export async function generateCouncilStory(
  env: Env,
  meetingId: string,
  storyType: StoryType,
): Promise<GenerateCouncilStoryResult> {
  try {
    if (!meetingId || !storyType) {
      throw new Error("meetingId and storyType are required");
    }

    if (!["preview", "update", "recap"].includes(storyType)) {
      throw new Error(`Invalid storyType: ${storyType}`);
    }

    console.log(`🖊️ Generating ${storyType} story for meeting ${meetingId}`);

    // Fetch meeting data
    const meeting = await first<CouncilMeetingRow>(
      env,
      `select * from council_meetings where id = ? limit 1`,
      meetingId,
    );

    if (!meeting) {
      throw new Error(`Meeting not found: ${meetingId}`);
    }

    // Check if story already exists for this type
    const storyIdCol = (
      storyType === "preview" ? "preview_story_id" : storyType === "update" ? "update_story_id" : "recap_story_id"
    ) as "preview_story_id" | "update_story_id" | "recap_story_id";
    if (meeting[storyIdCol]) {
      console.log(`⏭️ ${storyType} story already exists for this meeting, skipping`);
      return { success: true, skipped: true, reason: "Story already exists" };
    }

    // Extract PDF content if not already done
    const docMap: Record<
      StoryType,
      { urlCol: keyof CouncilMeetingRow; contentCol: keyof CouncilMeetingRow }
    > = {
      preview: { urlCol: "agenda_url", contentCol: "agenda_content" },
      update: { urlCol: "packet_url", contentCol: "packet_content" },
      recap: { urlCol: "minutes_url", contentCol: "minutes_content" },
    };
    const { urlCol, contentCol } = docMap[storyType];
    if (meeting[urlCol] && !meeting[contentCol]) {
      console.log(`📄 Extracting PDF for ${storyType}: ${meeting[urlCol]}`);
      try {
        const text = await extractPdfText(meeting[urlCol] as string);
        // Mutate the in-memory row so the freshly-extracted content flows into
        // the prompt builders below (mirrors the original meeting[contentCol] = text).
        (meeting as unknown as Record<string, unknown>)[contentCol] = text;
        await run(
          env,
          `update council_meetings set ${contentCol} = ? where id = ?`,
          text,
          meetingId,
        );
        console.log(`  ✅ Extracted ${text.length} chars`);
      } catch (err) {
        console.warn(`  ⚠️ PDF extraction failed:`, err instanceof Error ? err.message : String(err));
      }
    }

    // Fetch prior stories in the chain
    const previewStory = await fetchStory(env, meeting.preview_story_id);
    const updateStory = await fetchStory(env, meeting.update_story_id);

    // Build the appropriate prompt
    let prompt: string;
    switch (storyType) {
      case "preview":
        prompt = buildPreviewPrompt(meeting);
        break;
      case "update":
        prompt = buildUpdatePrompt(meeting, previewStory);
        break;
      case "recap":
        prompt = buildRecapPrompt(meeting, previewStory, updateStory);
        break;
    }

    // Fetch model config
    const modelSettings = await first<AppSettingRow>(
      env,
      `select value from app_settings where key = 'ai_model_config' limit 1`,
    );

    if (!modelSettings) {
      throw new Error("Failed to fetch model configuration");
    }

    const modelConfig = fromJson<LLMModelConfig | null>(modelSettings.value, null);
    if (!modelConfig || !modelConfig.model_name) {
      throw new Error("No model configured");
    }

    // Call LLM
    const llmResponse = await callLLM({
      prompt,
      modelConfig,
      keys: {
        openRouterApiKey: env.OPENROUTER_API_KEY,
        lovableApiKey: env.LOVABLE_API_KEY,
        refererUrl: env.PUBLIC_SITE_URL,
      },
      maxTokens: 4000,
      temperature: 0.5,
      appTitle: "Woodstock Community News - Council Coverage",
    });

    // Parse response
    let parsed: {
      headline: string;
      subhead: string;
      byline: string;
      source_name: string;
      source_url: string;
      body: string[];
      skip?: boolean;
    };
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
      return { success: true, skipped: true, reason: "LLM skipped" };
    }

    // Strip em/en dashes (matching existing pipeline behavior)
    const title = parsed.headline.replace(/[–—]/g, "-");
    const content = parsed.body.map((p) => p.replace(/[–—]/g, "-")).join("\n\n");
    const wordCount = content.split(/\s+/).length;

    // Insert story.
    // Council stories are already grounded in the official PDF during
    // generation, so they bypass fact-check and rewrite and land at
    // `edited` where run-ai-editor picks them up for publish/reject.
    const nowIso = new Date().toISOString();
    const newStory = await insert<StoryRow>(env, "stories", {
      id: crypto.randomUUID(),
      title,
      content,
      status: "edited",
      environment: "production",
      is_test: 0,
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
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (!newStory) {
      throw new Error("Failed to insert story");
    }

    // Update meeting with story reference
    await run(
      env,
      `update council_meetings set ${storyIdCol} = ?, updated_at = ? where id = ?`,
      newStory.id,
      new Date().toISOString(),
      meetingId,
    );

    console.log(`✅ ${storyType} story created: "${title}" (${newStory.id})`);

    return { success: true, storyId: newStory.id, title };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ generate-council-story error:`, msg);
    return { success: false, error: msg };
  }
}
