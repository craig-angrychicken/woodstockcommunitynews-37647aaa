# Woodstock Wire 2.0 — Application Description

## What it is

Woodstock Wire 2.0 is a private admin tool for AI-driven local news generation serving Woodstock, Georgia. It automates the full editorial pipeline — from scraping RSS feeds to publishing finished articles on Ghost CMS — with human review as an optional final gate.

## The Problem It Solves

Local news is labor-intensive. This tool replaces the manual work of monitoring sources, writing drafts, and fact-checking with an automated pipeline driven by LLMs (via OpenRouter), while keeping a human in the loop for final publishing decisions.

---

## End-to-End Pipeline

```
RSS Feeds
  ↓  every 30 min (pg_cron)
fetch-rss-feeds → artifacts table
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
  run-ai-editor        → approves (→ draft) or rejects (→ rejected)
  ↓  manual trigger (UI)
publish-to-ghost → Ghost CMS (Admin API + JWT)
```

**Reliability layer:**
- `recover-stuck-queue-items` watchdog retries failed queue items (max 3 retries, runs every 15 min)
- `send-alert` fires on DB trigger errors → Resend email notification

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Supabase: PostgreSQL + Deno edge functions + pg_cron |
| Vectors | pgvector (384-dim embeddings for artifact deduplication) |
| CMS | Ghost (self-hosted, publish via Admin API) |
| LLM | OpenRouter (model-agnostic routing) |
| Auth | Supabase Auth (admin-only) |
| CI/CD | GitHub Actions |

---

## Admin UI Pages

| Route | Purpose |
|---|---|
| `/` | Dashboard — pipeline overview |
| `/stories` | Browse, review, and manage generated stories |
| `/ai-journalist` | Monitor journalism pipeline + queue status |
| `/ai-editor` | Monitor 3-stage editorial pipeline |
| `/manual-query` | Manually trigger a journalism run |
| `/artifacts` | Browse raw RSS artifacts |
| `/prompts` | Manage AI prompt templates (retrieval + journalism types) |
| `/sources` | Configure RSS feed sources |
| `/models` | Select and configure the LLM model |

---

## Key Database Tables

| Table | Purpose |
|---|---|
| `sources` | RSS feed URLs and fetch status |
| `artifacts` | Raw fetched content with vector embeddings |
| `artifact_clusters` | Groups of similar/duplicate artifacts |
| `stories` | AI-generated articles with status lifecycle |
| `story_artifacts` | Many-to-many: stories ↔ artifacts |
| `prompt_versions` | Versioned AI prompt templates |
| `journalism_queue` | Serial processing queue with retry tracking |
| `app_settings` | Global config (model, schedule settings) |
| `cron_job_logs` | Audit trail for all automated tasks |

---

## Key Design Decisions

- **Queue-based serial processing**: Journalism runs serialize through `journalism_queue` to avoid LLM rate limits and allow retries
- **pgvector cluster deduplication**: Artifacts with cosine similarity > 0.85 are grouped so the AI doesn't write duplicate stories about the same event
- **Structured LLM output**: The journalism prompt requests a JSON schema response (title, body, tags, structured_metadata) for reliable parsing
- **3-stage editorial pipeline**: Separating fact-check, rewrite, and edit stages into discrete edge functions makes each stage independently observable and retryable
- **Shared edge function utilities**: `_shared/` contains cors, supabase-client, ghost-token, cron-logger, and llm-client modules to avoid duplication across 17 edge functions

---

## Architecture State (as of 2026-03-13)

All P0, P1, and P2 improvements from `docs/architecture-review.md` have been implemented (commit `4cd2ad9`), including: queue watchdog, shared modules, structured output, story clustering, multi-stage editorial pipeline, Vitest tests, GitHub Actions CI, and monitoring/alerting.
