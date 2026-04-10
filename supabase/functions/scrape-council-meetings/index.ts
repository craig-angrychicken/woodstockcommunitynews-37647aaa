// Scrape Woodstock city government meetings from Granicus portal.
// Detects new agenda/packet/minutes PDFs and triggers story generation.

import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { fetchPageHTML } from "../_shared/readability.ts";

const GRANICUS_URL = "https://woodstockga.granicus.com/ViewPublisher.php?view_id=1";
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Dynamic import of linkedom (same pattern as readability.ts)
let parseHTML: ((html: string) => { document: Document }) | null = null;
try {
  const mod = await import("https://esm.sh/linkedom@0.18.5?external=canvas");
  parseHTML = mod.parseHTML;
} catch {
  try {
    const mod = await import("https://cdn.jsdelivr.net/npm/linkedom@0.18.5/+esm");
    parseHTML = mod.parseHTML;
  } catch (err) {
    console.error("Failed to load linkedom:", err);
  }
}

interface ParsedMeeting {
  clipId: number;
  meetingType: string;
  meetingDate: Date;
  agendaUrl: string | null;
  packetUrl: string | null;
  minutesUrl: string | null;
}

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
  if (!parseHTML) throw new Error("linkedom not loaded");

  // deno-lint-ignore no-explicit-any
  const { document } = parseHTML(html) as any;
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

    // Determine clip_id from agenda or minutes URL
    let clipId: number | null = null;
    if (agendaUrl) clipId = extractClipId(agendaUrl);
    if (!clipId && minutesUrl) clipId = extractClipId(minutesUrl);
    if (!clipId) continue; // Can't identify meeting without a clip_id

    meetings.push({ clipId, meetingType, meetingDate, agendaUrl, packetUrl, minutesUrl });
  }

  return meetings;
}

type DocumentType = "agenda" | "packet" | "minutes";

interface DetectedDocument {
  type: DocumentType;
  url: string;
}

interface MissingStoryJob {
  meetingId: string;
  meetingDate: string;
  storyType: "preview" | "update" | "recap";
  storyIdCol: "preview_story_id" | "update_story_id" | "recap_story_id";
}

const MAX_GENERATIONS_PER_RUN = 5;

const STAGE_TO_STORY: Record<
  DocumentType,
  { storyType: MissingStoryJob["storyType"]; storyIdCol: MissingStoryJob["storyIdCol"] }
> = {
  agenda: { storyType: "preview", storyIdCol: "preview_story_id" },
  packet: { storyType: "update", storyIdCol: "update_story_id" },
  minutes: { storyType: "recap", storyIdCol: "recap_story_id" },
};

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const supabase = createSupabaseClient();

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
      // 3. Check existing state
      const { data: existing } = await supabase
        .from("council_meetings")
        .select("*")
        .eq("granicus_clip_id", meeting.clipId)
        .maybeSingle();

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

      // 5. Upsert the meeting row
      const upsertData: Record<string, unknown> = {
        granicus_clip_id: meeting.clipId,
        meeting_type: meeting.meetingType,
        meeting_date: meeting.meetingDate.toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (meeting.agendaUrl) upsertData.agenda_url = meeting.agendaUrl;
      if (meeting.packetUrl) upsertData.packet_url = meeting.packetUrl;
      if (meeting.minutesUrl) upsertData.minutes_url = meeting.minutesUrl;

      for (const doc of newDocs) {
        upsertData[`${doc.type}_detected_at`] = new Date().toISOString();
      }

      const { data: upserted, error: upsertError } = await supabase
        .from("council_meetings")
        .upsert(upsertData, { onConflict: "granicus_clip_id" })
        .select()
        .single();

      if (upsertError) {
        console.error(`❌ Upsert failed for clip_id ${meeting.clipId}:`, upsertError.message);
        continue;
      }

      meetingsUpserted++;
      documentsDetected += newDocs.length;

      // 6. Collect any stage where a PDF exists but the story is missing.
      // This catches both newly-detected PDFs AND historical meetings whose
      // original fire-and-forget generation failed or never ran.
      const stages: DocumentType[] = ["agenda", "packet", "minutes"];
      for (const stage of stages) {
        const urlKey = `${stage}_url` as const;
        const hasPdf = !!upserted[urlKey];
        const { storyType, storyIdCol } = STAGE_TO_STORY[stage];
        const storyMissing = !upserted[storyIdCol];

        if (hasPdf && storyMissing) {
          missingJobs.push({
            meetingId: upserted.id,
            meetingDate: upserted.meeting_date as string,
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
        const { data, error } = await supabase.functions.invoke("generate-council-story", {
          body: { meetingId: job.meetingId, storyType: job.storyType },
        });
        if (error) {
          storiesFailed++;
          console.warn(`  ⚠️ ${job.storyType} generation failed:`, error.message);
        } else if (data?.success === false) {
          storiesFailed++;
          console.warn(`  ⚠️ ${job.storyType} generation returned error:`, data.error);
        } else {
          storiesGenerated++;
          console.log(`  ✅ ${job.storyType} generated (skipped=${data?.skipped ?? false})`);
        }
      } catch (err) {
        storiesFailed++;
        console.warn(`  ⚠️ Exception generating ${job.storyType}:`, err instanceof Error ? err.message : String(err));
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
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

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ scrape-council-meetings error:", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
