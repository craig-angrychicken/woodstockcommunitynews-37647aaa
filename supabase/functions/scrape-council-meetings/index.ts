// Scrape Woodstock city government meetings from Granicus portal.
// Detects new agenda/packet/minutes PDFs and triggers story generation.

import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { createSupabaseClient } from "../_shared/supabase-client.ts";
import { fetchPageHTML } from "../_shared/readability.ts";
import { extractPdfText } from "../_shared/pdf-extract.ts";

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

/** Parse the Granicus listing page HTML into meeting rows */
function parseMeetings(html: string): ParsedMeeting[] {
  if (!parseHTML) throw new Error("linkedom not loaded");

  const { document } = parseHTML(html) as unknown as { document: {
    querySelectorAll: (s: string) => Array<{
      querySelector: (s: string) => { textContent: string; getAttribute: (a: string) => string | null } | null;
      querySelectorAll: (s: string) => Array<{ getAttribute: (a: string) => string | null }>;
    }>;
  }};

  const rows = document.querySelectorAll("tr.listingRow");
  const meetings: ParsedMeeting[] = [];
  const cutoff = Date.now() - NINETY_DAYS_MS;

  for (const row of rows) {
    // Extract meeting type
    const nameCell = row.querySelector("td.Name");
    const meetingType = nameCell?.textContent?.trim() || "";
    if (!meetingType) continue;

    // Skip cancelled meetings
    if (/cancelled|canceled/i.test(meetingType)) continue;

    // Extract date
    const dateCell = row.querySelector("td.Date");
    const dateText = dateCell?.textContent?.trim() || "";
    const meetingDate = parseGranicusDate(dateText);
    if (!meetingDate || meetingDate.getTime() < cutoff) continue;

    // Extract agenda URL + clip_id
    const agendaCell = row.querySelector("td.Agenda");
    const agendaLink = agendaCell?.querySelector?.("a");
    const agendaHref = agendaLink?.getAttribute?.("href") || null;
    const agendaUrl = agendaHref ? resolveUrl(agendaHref) : null;

    // Extract minutes URL
    const minutesCell = row.querySelector("td.Minutes");
    const minutesLink = minutesCell?.querySelector?.("a");
    const minutesHref = minutesLink?.getAttribute?.("href") || null;
    const minutesUrl = minutesHref ? resolveUrl(minutesHref) : null;

    // Extract packet URL (PDF link, usually on CloudFront)
    let packetUrl: string | null = null;
    const allLinks = row.querySelectorAll("a");
    for (const link of allLinks) {
      const href = link.getAttribute?.("href") || "";
      if (/\.pdf$/i.test(href) || /cloudfront\.net/i.test(href)) {
        packetUrl = resolveUrl(href);
        break;
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
    let storiesTriggered = 0;

    for (const meeting of meetings) {
      // 3. Check existing state
      const { data: existing } = await supabase
        .from("council_meetings")
        .select("*")
        .eq("granicus_clip_id", meeting.clipId)
        .maybeSingle();

      // 4. Determine which documents are newly detected
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

      // Set URLs and detection timestamps for new documents
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

      // 6. Extract PDF content and trigger stories for new documents
      for (const doc of newDocs) {
        documentsDetected++;
        console.log(`📄 New ${doc.type} detected for ${meeting.meetingType} (${meeting.meetingDate.toLocaleDateString()}): ${doc.url}`);

        // Extract PDF text
        let content: string | null = null;
        try {
          content = await extractPdfText(doc.url);
          console.log(`  ✅ Extracted ${content.length} chars from ${doc.type} PDF`);
        } catch (err) {
          console.warn(`  ⚠️ PDF extraction failed for ${doc.type}:`, err instanceof Error ? err.message : String(err));
        }

        // Store extracted content
        if (content) {
          await supabase
            .from("council_meetings")
            .update({ [`${doc.type}_content`]: content })
            .eq("id", upserted.id);
        }

        // Determine which story type to generate
        const storyTypeMap: Record<DocumentType, { storyType: string; storyIdCol: string }> = {
          agenda: { storyType: "preview", storyIdCol: "preview_story_id" },
          packet: { storyType: "update", storyIdCol: "update_story_id" },
          minutes: { storyType: "recap", storyIdCol: "recap_story_id" },
        };

        const { storyType, storyIdCol } = storyTypeMap[doc.type];

        // Only trigger if the story hasn't been generated yet
        if (!upserted[storyIdCol]) {
          try {
            console.log(`  🖊️ Triggering ${storyType} story generation...`);
            supabase.functions.invoke("generate-council-story", {
              body: { meetingId: upserted.id, storyType },
            }); // fire-and-forget
            storiesTriggered++;
          } catch (err) {
            console.warn(`  ⚠️ Failed to trigger ${storyType} generation:`, err instanceof Error ? err.message : String(err));
          }
        }
      }
    }

    const duration = Date.now() - startTime;
    const summary = {
      success: true,
      meetingsParsed: meetings.length,
      meetingsUpserted,
      documentsDetected,
      storiesTriggered,
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
