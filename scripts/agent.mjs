/**
 * Woodstock Community News Pipeline Monitor Agent
 *
 * Runs 4x/day via GitHub Actions. Queries the database, diagnoses pipeline
 * health, takes corrective actions, and sends a daily executive briefing.
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_PROJECT_ID = process.env.SUPABASE_PROJECT_ID;
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const QUEUE_PROCESSOR_SECRET = process.env.QUEUE_PROCESSOR_SECRET;
const SUPABASE_FUNCTIONS_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1`;
const MAX_TOOL_CALLS = 20;
const IS_DAILY_REPORT = process.env.FORCE_REPORT === "true";

const ALERT_EMAIL = "craig@angrychicken.co";
const FROM_EMAIL = "Woodstock Community News Monitor <alerts@woodstockcommunity.news>";

// ─── Validate required env vars ──────────────────────────────────────────────

const REQUIRED_VARS = [
  "SUPABASE_PROJECT_ID",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const v of REQUIRED_VARS) {
  if (!process.env[v]) {
    console.error(`[agent] Missing required environment variable: ${v}`);
    process.exit(1);
  }
}

if (!RESEND_API_KEY) {
  console.warn(
    "[agent] RESEND_API_KEY not set — send_executive_briefing will fail"
  );
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const tools = [
  {
    name: "query_database",
    description:
      "Execute a read-only SQL query against the Woodstock Community News production database. Returns an array of rows or an error object.",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "The SQL query to execute (SELECT only).",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "call_edge_function",
    description:
      "Invoke a Supabase edge function to perform a corrective action on the pipeline. Only call each function once per session. Whitelisted functions: recover-stuck-queue-items, run-ai-fact-checker, run-ai-rewriter, run-ai-editor, scheduled-fetch-artifacts, cluster-artifacts, scheduled-scrape-council.",
    input_schema: {
      type: "object",
      properties: {
        function_name: {
          type: "string",
          enum: [
            "recover-stuck-queue-items",
            "run-ai-fact-checker",
            "run-ai-rewriter",
            "run-ai-editor",
            "scheduled-fetch-artifacts",
            "cluster-artifacts",
            "scheduled-scrape-council",
          ],
          description: "The edge function to invoke.",
        },
        reason: {
          type: "string",
          description:
            "Brief explanation of why this function is being called.",
        },
      },
      required: ["function_name", "reason"],
    },
  },
  {
    name: "send_executive_briefing",
    description:
      "Send the daily executive briefing email to craig@angrychicken.co. On non-daily-report runs, only sends if is_critical_alert is true. Always call this tool at the end of a daily report run.",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        html_body: {
          type: "string",
          description:
            "Full HTML email body with inline CSS. Must include: pipeline status badges (green/yellow/red), today's numbers, published stories (if any), issues & corrective actions (if any), and a footer with UTC timestamp.",
        },
        is_critical_alert: {
          type: "boolean",
          description:
            "Set true only when the pipeline is critically broken and this is NOT a daily report run. This overrides the daily-report guard and sends an alert immediately.",
        },
      },
      required: ["subject", "html_body", "is_critical_alert"],
    },
  },
];

// ─── Tool implementations ────────────────────────────────────────────────────

async function queryDatabase({ sql }) {
  const url = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_ID}/database/query`;
  console.log(`[db] ${sql.trim().slice(0, 120).replace(/\s+/g, " ")}...`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[db] HTTP ${res.status}: ${text}`);
      return { error: `HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();
    console.log(`[db] ${Array.isArray(data) ? data.length : 1} row(s)`);
    return data;
  } catch (err) {
    console.error(`[db] Fetch error: ${err.message}`);
    return { error: err.message };
  }
}

// Track which functions have been called this session
const calledFunctions = new Set();

async function callEdgeFunction({ function_name, reason }) {
  if (calledFunctions.has(function_name)) {
    console.warn(`[edge] ${function_name} already called this session — skipping`);
    return { skipped: true, reason: "Already called this session" };
  }
  calledFunctions.add(function_name);

  const url = `${SUPABASE_FUNCTIONS_URL}/${function_name}`;
  console.log(`[edge] Calling ${function_name}: ${reason}`);
  try {
    const headers = {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };
    if (function_name === "recover-stuck-queue-items" && QUEUE_PROCESSOR_SECRET) {
      headers["x-internal-secret"] = QUEUE_PROCESSOR_SECRET;
    }
    const bodyPayload = {};
    if (function_name === "scheduled-fetch-artifacts") {
      bodyPayload.force = true;
    }
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    console.log(`[edge] ${function_name} → HTTP ${res.status}`, body);
    return { status: res.status, ok: res.ok, body };
  } catch (err) {
    console.error(`[edge] ${function_name} error: ${err.message}`);
    return { error: err.message };
  }
}

async function sendExecutiveBriefing({ subject, html_body, is_critical_alert }) {
  if (!IS_DAILY_REPORT && !is_critical_alert) {
    console.log("[email] Skipping — not a daily report run and not a critical alert");
    return { sent: false, reason: "Not a daily report run" };
  }
  if (!RESEND_API_KEY) {
    console.error("[email] RESEND_API_KEY not set — cannot send email");
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }

  console.log(`[email] Sending: "${subject}" → ${ALERT_EMAIL}`);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ALERT_EMAIL],
        subject,
        html: html_body,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(`[email] Send failed HTTP ${res.status}:`, data);
      return { sent: false, error: data };
    }
    console.log("[email] Sent successfully:", data.id);
    return { sent: true, id: data.id };
  } catch (err) {
    console.error(`[email] Fetch error: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

async function dispatchTool(name, input) {
  switch (name) {
    case "query_database":
      return await queryDatabase(input);
    case "call_edge_function":
      return await callEdgeFunction(input);
    case "send_executive_briefing":
      return await sendExecutiveBriefing(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const now = new Date();
const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
const etTimeStr = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
  hour12: false,
}).format(now);

const SYSTEM_PROMPT = `You are the autonomous operations lead for Woodstock Community News, a private AI-generated local news service for Woodstock, Georgia and Cherokee County. Your job is to keep every scheduled pipeline running (journalism, editorial, and council coverage), repair what you can within the authorized toolset, surface anything you cannot repair, and give the project owner a single-pane leadership view that includes growth and coverage trends.

Today is ${dateStr}. Current ET time: ${etTimeStr}. UTC hour: ${now.getUTCHours()}.
This is a ${IS_DAILY_REPORT ? "DAILY REPORT run" : "MONITORING run"}.

## Your Mission
Check pipeline health across every stage (including council coverage), diagnose issues, take corrective actions within your authorized toolset, and${IS_DAILY_REPORT ? " send the executive briefing email" : " send an email only for CRITICAL issues (pipeline fully stopped or an entire coverage area gone dark)"}.

## Pipeline Architecture (7 Stages)

| Stage | Tables | Stuck threshold | Critical threshold | Repair function |
|-------|--------|----------------|-------------------|-----------------|
| Artifact Fetching | artifacts, query_history | No fetch in 8h | No fetch in 16h | scheduled-fetch-artifacts |
| Clustering | artifacts (cluster_id) | No run in 2h | No run in 4h | cluster-artifacts |
| Story Generation | journalism_queue | processing > 10min | > 30min or >20% failed | recover-stuck-queue-items |
| Fact-checking | stories (pending) | >4h in pending | >8h in pending | run-ai-fact-checker |
| Rewriting | stories (fact_checked) | >4h | >8h | run-ai-rewriter |
| Editorial/Publish | stories (edited) | >4h | >8h | run-ai-editor |
| Council Coverage | council_meetings, stories (story_type preview/update/recap) | Scraper not run in 12h | Scraper not run in 24h, or ≥10 missing stages | scheduled-scrape-council |

## Mandatory Health Check Queries (run ALL 17 before deciding anything)

IMPORTANT: There are exactly SEVENTEEN (17) queries below, numbered 1–17. You MUST run every single one. A common mistake is stopping early. Do not do this.

1. Artifact volume (24h / 8h):
SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS artifacts_24h,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '8 hours') AS artifacts_8h,
       MAX(created_at) AS latest_artifact
FROM artifacts WHERE is_test = false LIMIT 1;

2. Recent fetch runs:
SELECT status, completed_at, error_message, artifacts_count
FROM query_history WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC LIMIT 10;

3. Queue status breakdown:
SELECT status, COUNT(*) AS count, MAX(retry_count) AS max_retries, MIN(started_at) AS oldest_started
FROM journalism_queue WHERE created_at > NOW() - INTERVAL '24 hours' GROUP BY status;

4. Stuck processing items:
SELECT id, status, retry_count, started_at, error_message
FROM journalism_queue WHERE status = 'processing' AND started_at < NOW() - INTERVAL '10 minutes'
ORDER BY started_at ASC LIMIT 20;

5. Stories pipeline backlog:
SELECT status, COUNT(*) AS count, MIN(created_at) AS oldest, MAX(created_at) AS newest
FROM stories WHERE is_test = false AND environment = 'production'
  AND status IN ('pending', 'fact_checked', 'edited')
GROUP BY status ORDER BY status;

6. Recently published stories:
SELECT title, ghost_url, published_at FROM stories
WHERE is_test = false AND environment = 'production' AND status = 'published'
ORDER BY published_at DESC NULLS LAST LIMIT 5;

7. Cron job errors (last 24h):
SELECT job_name, triggered_at, error_message, execution_duration_ms
FROM cron_job_logs WHERE triggered_at > NOW() - INTERVAL '24 hours' AND error_message IS NOT NULL
ORDER BY triggered_at DESC LIMIT 20;

8. Source health:
SELECT name, status, last_fetch_at, items_fetched FROM sources
WHERE status = 'active' ORDER BY last_fetch_at DESC NULLS LAST LIMIT 20;

9. Clustering health:
SELECT
  COUNT(*) FILTER (WHERE cluster_id IS NULL AND is_test = false) AS unclustered,
  COUNT(*) FILTER (WHERE cluster_id IS NOT NULL AND is_test = false) AS clustered,
  COUNT(*) FILTER (WHERE is_test = false) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cluster_id IS NOT NULL AND is_test = false)
    / NULLIF(COUNT(*) FILTER (WHERE is_test = false), 0), 1) AS pct_clustered,
  (SELECT MAX(triggered_at) FROM cron_job_logs
   WHERE job_name = 'cluster-artifacts' AND error_message IS NULL) AS last_successful_cluster_run
FROM artifacts;

10. Skipped artifacts (24h):
SELECT jq.error_message AS skip_reason, a.title AS artifact_title, a.url, jq.completed_at
FROM journalism_queue jq
JOIN artifacts a ON a.id = jq.artifact_id
WHERE jq.status = 'skipped' AND jq.completed_at > NOW() - INTERVAL '24 hours'
ORDER BY jq.completed_at DESC;

11. Rejected stories (24h):
SELECT s.title, s.editor_notes AS rejection_reason, s.updated_at
FROM stories s
WHERE s.status = 'rejected' AND s.is_test = false AND s.environment = 'production'
  AND s.updated_at > NOW() - INTERVAL '24 hours'
ORDER BY s.updated_at DESC;

12. pg_cron job recency inventory — catches the silent-stop case where a wrapper hasn't run at all:
SELECT job_name,
       MAX(triggered_at) AS last_run,
       COUNT(*) FILTER (WHERE triggered_at > NOW() - INTERVAL '24 hours') AS runs_24h,
       COUNT(*) FILTER (WHERE error_message IS NOT NULL AND triggered_at > NOW() - INTERVAL '24 hours') AS errors_24h
FROM cron_job_logs
WHERE job_name IN (
  'scheduled-fetch-artifacts',
  'cluster-artifacts',
  'scheduled-run-journalism',
  'scheduled-run-editor',
  'scheduled-recover-queue',
  'scheduled-scrape-council'
)
GROUP BY job_name
ORDER BY job_name;

13. Council meeting coverage matrix (last 90 days + upcoming):
SELECT id, meeting_type, meeting_date, granicus_clip_id, granicus_event_id,
       agenda_url IS NOT NULL AS has_agenda, preview_story_id IS NOT NULL AS has_preview,
       packet_url IS NOT NULL AS has_packet, update_story_id IS NOT NULL AS has_update,
       minutes_url IS NOT NULL AS has_minutes, recap_story_id IS NOT NULL AS has_recap
FROM council_meetings
WHERE meeting_date > NOW() - INTERVAL '90 days'
ORDER BY meeting_date DESC;

14. Missing-stage backlog (PDF exists but story missing):
SELECT
  SUM(CASE WHEN agenda_url IS NOT NULL AND preview_story_id IS NULL THEN 1 ELSE 0 END) AS missing_previews,
  SUM(CASE WHEN packet_url IS NOT NULL AND update_story_id IS NULL THEN 1 ELSE 0 END) AS missing_updates,
  SUM(CASE WHEN minutes_url IS NOT NULL AND recap_story_id IS NULL THEN 1 ELSE 0 END) AS missing_recaps
FROM council_meetings
WHERE meeting_date > NOW() - INTERVAL '90 days';

15. Council story funnel (24h):
SELECT status, story_type, COUNT(*) AS count
FROM stories
WHERE is_test = false AND environment = 'production'
  AND council_meeting_id IS NOT NULL
  AND updated_at > NOW() - INTERVAL '24 hours'
GROUP BY status, story_type
ORDER BY story_type, status;

16. Weekly growth trend (this week vs last week):
SELECT
  COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '7 days') AS published_this_week,
  COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '14 days' AND published_at <= NOW() - INTERVAL '7 days') AS published_prev_week,
  COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '7 days' AND council_meeting_id IS NOT NULL) AS council_stories_this_week,
  (SELECT COUNT(*) FROM artifacts WHERE created_at > NOW() - INTERVAL '7 days' AND is_test = false) AS artifacts_this_week,
  (SELECT COUNT(*) FROM artifacts WHERE created_at > NOW() - INTERVAL '14 days' AND created_at <= NOW() - INTERVAL '7 days' AND is_test = false) AS artifacts_prev_week
FROM stories
WHERE is_test = false AND environment = 'production' AND status = 'published';

17. Schedule gate state — surfaces operator-disabled pipelines:
SELECT schedule_type, is_enabled, scheduled_times, active_hours_start_et, active_hours_end_et, updated_at
FROM schedules
ORDER BY schedule_type;

## Behavioral Rules
- Run ALL 17 queries before making any decision or taking action.
- Call each repair function at most ONCE per session (enforced by the tool).
- Be conservative — prefer "the pg_cron watchdog will handle minor issues" over unnecessary function calls.
- Clustering warning: last_successful_cluster_run > 2h ago.
- Clustering critical: last_successful_cluster_run > 4h ago → call cluster-artifacts.
- Note: high unclustered count alone is NOT alarming (unique content stays unclustered by design); focus on whether the cron job is running.
- Council warning: last successful scheduled-scrape-council run > 12h ago, OR (missing_previews + missing_updates + missing_recaps) > 5.
- Council critical: last successful run > 24h ago, OR total missing stages > 10 → call scheduled-scrape-council (it reruns the scraper, which retries missing-stage story generation up to 5 per call).
- Cron recency rule: for every job in the query-12 inventory, compare last_run against expected cadence:
  • scheduled-fetch-artifacts: 30min  • cluster-artifacts: 1h  • scheduled-run-journalism: 1h
  • scheduled-run-editor: 1h  • scheduled-recover-queue: 15min  • scheduled-scrape-council: 8h
  Warning: last_run older than 2x cadence. Critical: older than 4x cadence.
- If a pipeline is disabled in the schedules table (query 17), do NOT flag its downstream queues as stuck. Instead, report the disabled state in the email.
- On MONITORING runs: only send email if the pipeline is CRITICALLY broken (all artifact fetching stopped, all story generation stopped for >8h, or a coverage area — including council — has gone fully dark for 24h+).
- On DAILY REPORT runs: ALWAYS send the briefing email, even if everything is healthy.
- Never call run-ai-journalist — it requires complex parameters that must be set manually.

## Executive Briefing Email Format
Build a polished HTML email with inline CSS using this structure:
1. Header — "Woodstock Community News Daily Briefing" + date ET, background #1a1a2e, white text
2. Pipeline Status — green/yellow/red badge for each of the 7 stages:
   • Healthy = #4caf50  • Warning = #f5a623  • Critical = #e94560
   Stages: Artifact Fetching, Clustering, Story Generation, Fact-checking, Rewriting, Editorial/Publish, Council Coverage
3. Today's Numbers — 7 stat boxes: Artifacts Fetched (24h), Cluster Rate (pct_clustered of total), Stories Generated (24h), Published (24h), Rejected (24h), Council Stories (24h), Missing Stages
4. Council Coverage — compact table with columns "Meeting date · Type · Agenda · Packet · Minutes". Show the next upcoming meeting (if any) plus the 5 most recent past meetings. Each stage cell renders as "✓ story" (green #4caf50), "PDF only" (amber #f5a623), or "—" (neutral gray).
5. Cron Pulse — single-row grid showing each of the 6 pg_cron wrappers with its last_run timestamp and a green/amber/red dot based on the 2x/4x cadence rule.
6. Weekly Trendline — two stat rows:
   • "Stories published: X this week vs Y last week (Δ)"
   • "Artifacts ingested: X this week vs Y last week (Δ)"
   Plus the council-stories-this-week count as a sub-line. Use neutral background, not the alert colors.
7. Published Stories — list with titles and URLs (only if published today)
8. Skips & Rejections — two sub-sections:
   - "Skipped Artifacts" — table with artifact title and AI's skip justification (show "None in the last 24 hours" if empty)
   - "Rejected Stories" — table with story title and AI's rejection justification (show "None in the last 24 hours" if empty)
   Use a neutral/informational background (#2a2a3e or similar).
9. Issues & Corrective Actions — amber (#f5a623) callout block (only if issues found/actions taken)
10. Growth Nudges — neutral-background callout with 1-3 short factual bullets (only if you have something product-relevant to say). Examples: "Planning Commission coverage is complete for the last 4 meetings, but DDA has no scraper yet." or "Source X has returned 0 items for 7 straight days — consider dropping it." Keep it bounded and observable; no speculation.
11. Footer — UTC timestamp + "Generated by Woodstock Community News Pipeline Monitor"

Keep the email clean, readable on mobile, and free of external image dependencies.`;

// ─── Agentic loop ─────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `[agent] Starting pipeline monitor — ${IS_DAILY_REPORT ? "DAILY REPORT" : "MONITORING"} run`
  );
  console.log(`[agent] UTC hour: ${now.getUTCHours()}, max tool calls: ${MAX_TOOL_CALLS}`);

  const client = new Anthropic();

  const messages = [
    {
      role: "user",
      content: IS_DAILY_REPORT
        ? "Run the full pipeline health check, take any needed corrective actions, and send the daily executive briefing email to craig@angrychicken.co."
        : "Run the full pipeline health check. Take corrective actions if warranted. Send an email only if there is a critical failure.",
    },
  ];

  let toolCallCount = 0;

  while (toolCallCount < MAX_TOOL_CALLS) {
    const stream = client.messages.stream({
      model: IS_DAILY_REPORT ? "claude-opus-4-6" : "claude-sonnet-4-6",
      max_tokens: 50000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
    const response = await stream.finalMessage();

    // Log any text or thinking blocks
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        console.log(`[claude] ${block.text.trim().slice(0, 500)}`);
      }
    }

    // Append assistant turn
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      console.log("[agent] Claude finished — end_turn");
      break;
    }

    if (response.stop_reason !== "tool_use") {
      console.log(`[agent] Unexpected stop_reason: ${response.stop_reason}`);
      break;
    }

    // Execute all tool calls
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const toolResults = [];

    for (const block of toolUseBlocks) {
      toolCallCount++;
      console.log(`\n[tool_call ${toolCallCount}] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`);

      const result = await dispatchTool(block.name, block.input);
      const resultStr = JSON.stringify(result);
      console.log(`[tool_result ${toolCallCount}] ${resultStr.slice(0, 500)}`);

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultStr,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (toolCallCount >= MAX_TOOL_CALLS) {
    console.warn(`[agent] Reached max tool calls (${MAX_TOOL_CALLS})`);
  }

  console.log(`[agent] Done. ${toolCallCount} tool call(s) made.`);
}

main().catch((err) => {
  console.error("[agent] Fatal error:", err);
  process.exit(1);
});
