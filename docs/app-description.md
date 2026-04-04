# Woodstock Community News — Application Description

## What it is

Woodstock Community News is an automated local news platform serving Woodstock, Georgia and Cherokee County. It automates the full editorial pipeline — from scraping primary sources to publishing finished articles — with AI handling the drafting, fact-checking, and editing, and human review available as a final gate.

The public site lives at **woodstockcommunity.news**. Admins manage the pipeline through a private React dashboard.

## The Problem It Solves

Local news is disappearing. This tool replaces the manual work of monitoring primary sources, writing drafts, and fact-checking with an automated pipeline driven by LLMs (via OpenRouter), while keeping humans in the loop for final publishing decisions. Stories come exclusively from primary sources — government RSS feeds, official press releases, public records, and municipal websites.

---

## End-to-End Pipeline

```
RSS Feeds + Web Pages (primary sources)
  ↓  every 30 min (pg_cron)
fetch-rss-feeds / fetch-web-pages → artifacts table
  ↓  on run
cluster-artifacts → artifact_clusters (pgvector cosine sim > 0.85)
  ↓
run-ai-journalist → journalism_queue → process-journalism-queue-item
  ↓  (LLM generates structured JSON: title, body, metadata)
stories table (status: pending)
  ↓  hourly (pg_cron)
scheduled-run-editor:
  run-ai-fact-checker  → verifies claims against source artifacts
  run-ai-rewriter      → revises story based on fact-check notes
  run-ai-editor        → approves (→ edited) or rejects (→ rejected)
  ↓  (auto-publish on approval, or manual via admin UI)
publish-story → stories.status=published, generates slug
  ↓  (non-fatal side effects)
  ├→ Vercel /api/revalidate → refreshes Next.js ISR cache
  └→ publish-to-facebook → posts to Facebook Page (first publish only)
  ↓
woodstockcommunity.news/<slug> (live on Vercel)
```

**Reliability layer:**
- `recover-stuck-queue-items` watchdog retries failed queue items (max 3 retries, runs every 15 min)
- `send-alert` fires on DB trigger errors → Resend email notification
- `scheduled-run-*` functions honor an active-hours schedule gate (shared module)

---

## Stack

| Layer | Technology |
|---|---|
| Admin UI | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| Public site | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| Hosting (public site) | Vercel (ISR + on-demand revalidation) |
| Backend | Supabase: PostgreSQL + Deno edge functions + pg_cron |
| Vectors | pgvector (384-dim embeddings for artifact deduplication) |
| LLM | OpenRouter (model-agnostic routing) |
| Auth | Supabase Auth (admin-only) |
| Social | Facebook Graph API (v21.0) |
| CI/CD | GitHub Actions + Vercel auto-deploy on push to main |

---

## Admin UI Pages (private, admin-only)

| Route | Purpose |
|---|---|
| `/` | Dashboard — pipeline overview + system health |
| `/stories` | Browse, review, publish, and manage generated stories |
| `/ai-journalist` | Monitor journalism pipeline + queue status |
| `/ai-editor` | Monitor 3-stage editorial pipeline |
| `/manual-query` | Manually trigger a journalism run |
| `/artifacts` | Browse raw RSS/Web Page artifacts |
| `/prompts` | Manage AI prompt templates |
| `/sources` | Configure RSS Feed and Web Page sources |
| `/models` | Select and configure the LLM model |

## Public Site Pages (woodstockcommunity.news)

| Route | Purpose |
|---|---|
| `/` | Homepage — Featured + Latest stories |
| `/[slug]` | Story detail page with hero image, byline, related stories |
| `/about` | About page |
| `/feed.xml` | RSS feed of published stories |
| `/sitemap.xml` | Dynamic XML sitemap |

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `sources` | RSS Feed and Web Page source URLs with fetch status |
| `artifacts` | Raw fetched content with vector embeddings |
| `artifact_clusters` | Groups of similar/duplicate artifacts |
| `stories` | AI-generated articles with status lifecycle, slug, featured flag, environment |
| `story_artifacts` | Many-to-many: stories ↔ artifacts |
| `prompt_versions` | Versioned AI prompt templates |
| `journalism_queue` | Serial processing queue with retry tracking |
| `app_settings` | Global config (model, schedule settings) |
| `schedules` | Per-pipeline active-hours and cadence config |
| `cron_job_logs` | Audit trail for all automated tasks |

---

## Key Design Decisions

- **Direct-from-database publishing**: Stories render from Supabase directly on the Vercel Next.js site — no CMS layer. Ghost CMS was retired in March 2026.
- **Slug-based URLs**: Each published story gets a unique URL-safe slug; old stories were backfilled via migration.
- **ISR + on-demand revalidation**: Story pages revalidate hourly but are refreshed immediately via `/api/revalidate` when published.
- **Queue-based serial processing**: Journalism runs serialize through `journalism_queue` to avoid LLM rate limits and allow retries.
- **pgvector cluster deduplication**: Artifacts with cosine similarity > 0.85 are grouped so the AI doesn't write duplicate stories about the same event. Additional story-level and artifact-level dedup catches near-threshold duplicates.
- **Structured LLM output**: The journalism prompt requests a JSON schema response (headline, subhead, byline, source_name, source_url, body paragraphs, skip flag).
- **3-stage editorial pipeline**: Fact-check → rewrite → edit as separate edge functions — each independently observable and retryable.
- **Primary sources only**: No secondhand reporting. If a claim isn't in the source artifact, it doesn't get published.
- **Active-hours schedule gate**: Scheduled functions skip runs outside configured daytime ET hours (shared module).

---

## Architecture State (as of 2026-04-04)

**Vercel migration complete.** Public site is live at woodstockcommunity.news serving stories directly from Supabase. Ghost CMS has been retired — the legacy `publish-to-ghost` function is kept for reference but is not in the active publish path.

All P0/P1/P2 improvements from `docs/architecture-review.md` have been implemented, plus:
- Web Page source type with Readability extraction
- Facebook auto-posting on first publish
- Daily report agent (`.github/workflows/agent-daily-report.yml`)
- Image backfill and hero image repair utilities
- Active-hours schedule gate for all scheduled pipelines
