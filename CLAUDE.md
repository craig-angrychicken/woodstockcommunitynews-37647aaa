# Project: Woodstock Community News

## Supabase Deployment

After making any changes to Supabase (edge functions or migrations), always deploy automatically:

```bash
# Push database migrations
supabase db push

# Deploy all edge functions
supabase functions deploy
```

The project is already linked to `cceprnhnpqnpexmouuig` (Woodstock Community News).

## GitHub

Push changes to `git@github.com:craig-angrychicken/woodstockcommunitynews-37647aaa.git`

Never commit `.env` — it contains secrets.

## App Context

### Overview
Woodstock Community News — private admin tool for AI-generated local news for Woodstock, Georgia and Cherokee County.

**Stack:** React 18 + Vite + TypeScript + Tailwind + shadcn/ui (frontend); Supabase (PostgreSQL + Deno edge functions); Ghost CMS (publishing); OpenRouter (LLM access).

### Supabase Project (public config)
- Project ID: `cceprnhnpqnpexmouuig`
- Supabase URL: `https://cceprnhnpqnpexmouuig.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/cceprnhnpqnpexmouuig

### Frontend Pages (React Router)
| Route | Page | Purpose |
|---|---|---|
| `/` | Dashboard | Overview |
| `/stories` | Stories | View/manage generated stories |
| `/manual-query` | ManualQuery | Manually trigger journalism run |
| `/ai-journalist` | AIJournalist | Monitor AI journalist + queue |
| `/artifacts` | Artifacts | Browse raw RSS artifacts |
| `/prompts` | Prompts | Manage AI prompts |
| `/sources` | Sources | Configure RSS feeds and Web Page sources |
| `/models` | Models | Configure LLM model |

All routes are admin-protected.

### Database Tables
| Table | Purpose |
|---|---|
| `sources` | RSS feed and Web Page sources (url, type, status, last_fetch_at). Type is "RSS Feed" or "Web Page" |
| `artifacts` | Raw content fetched from RSS feeds or Web Pages. Columns include `embedding vector(384)`, `cluster_id UUID` for dedup |
| `artifact_clusters` | Groups of similar artifacts (pgvector cosine similarity > 0.85) |
| `stories` | AI-generated articles (status: pending/fact_checked/edited/draft/published/archived/rejected). Columns include `structured_metadata JSONB`, `word_count`, `source_count`, `reading_level`, `generation_metadata JSONB`, `fact_check_notes TEXT` |
| `story_artifacts` | Many-to-many junction: stories ↔ artifacts |
| `prompt_versions` | AI prompt templates (retrieval + journalism types) |
| `journalism_queue` | Serial processing queue for artifact → story conversion. Includes `retry_count INTEGER` for watchdog recovery |
| `query_history` | Logs of journalism pipeline runs |
| `schedules` | Cron schedule config (artifact_fetch, ai_journalism) |
| `app_settings` | Global config (ai_model_config, etc.) |
| `cron_job_logs` | Audit trail of automated tasks (trigger on error → send-alert) |

### Edge Functions (all verify_jwt = false)
| Function | Trigger | Purpose |
|---|---|---|
| `fetch-rss-feeds` | UI / scheduled | Fetch + normalize RSS feeds → artifacts table |
| `fetch-web-pages` | UI / scheduled | Fetch Web Page sources via Readability → artifacts table |
| `test-readability` | UI | Test a URL with Readability extraction (content, images, videos) |
| `scheduled-fetch-artifacts` | pg_cron (every 30min) | Cron wrapper for fetch-rss-feeds + fetch-web-pages |
| `run-ai-journalist` | UI / scheduled | Orchestrate journalism pipeline run (with cluster dedup) |
| `process-journalism-queue-item` | Internal | Convert single artifact → story via LLM (structured JSON output) |
| `scheduled-run-journalism` | pg_cron (hourly) | Cron wrapper for journalism pipeline |
| `run-ai-fact-checker` | Internal / scheduled | Compare story claims against source artifacts |
| `run-ai-rewriter` | Internal / scheduled | Rewrite stories based on fact-check feedback |
| `run-ai-editor` | Internal / scheduled | Final editorial review (publish/reject) |
| `scheduled-run-editor` | pg_cron | Orchestrates 3-stage editorial pipeline (fact-check → rewrite → edit) |
| `publish-to-ghost` | UI | Publish story to Ghost CMS (reads structured_metadata) |
| `fetch-openrouter-models` | UI | List available LLM models from OpenRouter |
| `manage-schedule` | UI | Enable/disable/update schedule config |
| `backfill-artifact-images` | UI / manual | Extract images from artifact HTML |
| `recover-stuck-queue-items` | Internal | Watchdog: retry stuck queue items (max 3 retries) |
| `scheduled-recover-queue` | pg_cron (every 15min) | Cron wrapper for queue recovery watchdog |
| `cluster-artifacts` | Internal | Generate embeddings + cluster similar artifacts |
| `send-alert` | DB trigger / internal | Send error alerts via Resend email |

### Shared Modules (`supabase/functions/_shared/`)
| Module | Exports |
|---|---|
| `cors.ts` | `corsHeaders`, `handleCorsPrelight(req)` |
| `supabase-client.ts` | `createSupabaseClient()`, `getSupabaseUrl()`, `getServiceRoleKey()` |
| `cron-logger.ts` | `logCronJob(supabase, log)` |
| `ghost-token.ts` | `generateGhostToken(apiKey)` |
| `llm-client.ts` | `callLLM(options)` — OpenRouter/Lovable API wrapper with retry |
| `readability.ts` | `fetchPageHTML(url)`, `extractWithReadability(html)`, `extractImages(html, baseUrl)`, `extractVideos(html)` — Mozilla Readability extraction |

### Key File Paths
- Frontend pages: `src/pages/`
- Supabase client: `src/integrations/supabase/client.ts`
- Ghost API helper: `src/lib/ghost-api.ts`
- Edge functions: `supabase/functions/<name>/index.ts`
- Shared utilities: `supabase/functions/_shared/`
- DB migrations: `supabase/migrations/`
- Supabase config: `supabase/config.toml`
- Tests: `supabase/functions/**/__tests__/`, `vitest.config.ts`
- CI/CD: `.github/workflows/ci.yml`

## MCP

Supabase MCP is configured via `.mcp.json` (project root). It connects to `https://mcp.supabase.com/mcp` using OAuth — on first use, Claude Code will open a browser to authenticate with your Supabase account (one-time).

Once authenticated, Claude can:
- Read edge function logs (e.g., `fetch-rss-feeds`, `run-ai-journalist`)
- Run SQL queries against the database
- Inspect table schemas and row data

No secrets are stored in `.mcp.json` — it is safe to commit.

### Secrets Reference (where they live, not what they are)
Stored in Supabase dashboard secrets:
- `SUPABASE_SERVICE_ROLE_KEY`
- `GHOST_ADMIN_API_KEY` + `GHOST_API_URL`
- `OPENROUTER_API_KEY`
- `QUEUE_PROCESSOR_SECRET`
- `LOVABLE_API_KEY`
- `RESEND_API_KEY` (optional — for email alerts via send-alert)
- `ALERT_EMAIL` (optional — recipient for error alerts)

Stored in GitHub repository secrets (for CI/CD):
- `SUPABASE_PROJECT_ID`
- `SUPABASE_ACCESS_TOKEN`

Stored locally in `.env` (never committed):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
