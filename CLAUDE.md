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

## Vercel Deployment

The public site (`site/` directory) is deployed on Vercel at `woodstockcommunity.news`. Vercel auto-deploys from the `main` branch on GitHub. Story pages use ISR (`revalidate = 3600`) and are refreshed on-demand when a story is published via the `/api/revalidate` endpoint.

Do NOT run `vercel deploy` manually — pushes to `main` trigger deployments automatically.

## GitHub

Push changes to `git@github.com:craig-angrychicken/woodstockcommunitynews-37647aaa.git`

Never commit `.env` — it contains secrets.

## App Context

### Overview
Woodstock Community News — AI-generated local news for Woodstock, Georgia and Cherokee County.

Two codebases in one repo:
1. **Admin UI** (root) — React 18 + Vite + TypeScript + Tailwind + shadcn/ui — private dashboard for managing the pipeline
2. **Public site** (`site/`) — Next.js 16 + React 19 + Tailwind 4 — reader-facing site at woodstockcommunity.news, deployed on Vercel

**Backend:** Supabase (PostgreSQL + Deno edge functions + pg_cron); OpenRouter (LLM access); Facebook Graph API (social publishing).

**Publishing:** Stories are published directly from the `stories` table via slug-based URLs on the Vercel site.

### Supabase Project (public config)
- Project ID: `cceprnhnpqnpexmouuig`
- Supabase URL: `https://cceprnhnpqnpexmouuig.supabase.co`
- Dashboard: https://supabase.com/dashboard/project/cceprnhnpqnpexmouuig

### Admin UI Pages (React Router)
| Route | Page | Purpose |
|---|---|---|
| `/` | Dashboard | Pipeline overview + system health |
| `/stories` | Stories | View/manage/publish generated stories |
| `/ai-journalist` | AIJournalist | Monitor journalism pipeline + queue |
| `/ai-editor` | AIEditor | Monitor 3-stage editorial pipeline (fact-check → rewrite → edit) |
| `/manual-query` | ManualQuery | Manually trigger journalism run |
| `/artifacts` | Artifacts | Browse raw RSS/web page artifacts |
| `/prompts` | Prompts | Manage AI prompt templates |
| `/sources` | Sources | Configure RSS Feed and Web Page sources |
| `/models` | Models | Select and configure LLM model |

All routes are admin-protected via Supabase Auth.

### Public Site Pages (Next.js App Router — `site/`)
| Route | Purpose |
|---|---|
| `/` | Homepage — Featured + Latest stories |
| `/[slug]` | Story detail page with hero image, metadata, related stories |
| `/about` | About page |
| `/feed.xml` | RSS feed |
| `/sitemap.xml` | Dynamic sitemap |
| `/api/revalidate` | On-demand ISR revalidation endpoint (secret-protected) |

### Database Tables
| Table | Purpose |
|---|---|
| `sources` | RSS Feed and Web Page sources (url, type, status, last_fetch_at). Type is "RSS Feed" or "Web Page" |
| `artifacts` | Raw content fetched from RSS feeds or Web Pages. Columns include `embedding vector(384)`, `cluster_id UUID` for dedup |
| `artifact_clusters` | Groups of similar artifacts (pgvector cosine similarity > 0.85) |
| `stories` | AI-generated articles. Status: pending/fact_checked/edited/draft/published/archived/rejected. Key columns: `slug TEXT` (unique, for Vercel URLs), `featured BOOLEAN`, `environment TEXT`, `structured_metadata JSONB`, `word_count`, `source_count`, `reading_level`, `generation_metadata JSONB`, `fact_check_notes TEXT`, `hero_image_url TEXT`, `published_at TIMESTAMPTZ` |
| `story_artifacts` | Many-to-many junction: stories ↔ artifacts |
| `prompt_versions` | AI prompt templates (retrieval + journalism types) |
| `journalism_queue` | Serial processing queue for artifact → story conversion. Includes `retry_count INTEGER` for watchdog recovery |
| `query_history` | Logs of journalism pipeline runs |
| `schedules` | Cron schedule config (artifact_fetch, ai_journalism) |
| `app_settings` | Global config (ai_model_config, etc.) |
| `cron_job_logs` | Audit trail of automated tasks (trigger on error → send-alert) |

### Edge Functions (all verify_jwt = false)

**Content ingestion:**
| Function | Trigger | Purpose |
|---|---|---|
| `fetch-rss-feeds` | UI / scheduled | Fetch + normalize RSS feeds → artifacts table |
| `fetch-web-pages` | UI / scheduled | Fetch Web Page sources via Readability → artifacts table |
| `scheduled-fetch-artifacts` | pg_cron (every 30min) | Cron wrapper for fetch-rss-feeds + fetch-web-pages |
| `cluster-artifacts` | Internal | Generate embeddings + cluster similar artifacts (pgvector) |
| `test-readability` | UI | Test a URL with Readability extraction (content, images, videos) |

**Journalism pipeline:**
| Function | Trigger | Purpose |
|---|---|---|
| `run-ai-journalist` | UI / scheduled | Orchestrate journalism pipeline run (with cluster dedup) |
| `process-journalism-queue-item` | Internal | Convert single artifact → story via LLM (structured JSON output) |
| `scheduled-run-journalism` | pg_cron (hourly) | Cron wrapper for journalism pipeline |
| `regenerate-stories` | UI | Re-run LLM generation for selected stories |

**Editorial pipeline:**
| Function | Trigger | Purpose |
|---|---|---|
| `run-ai-fact-checker` | Internal / scheduled | Compare story claims against source artifacts |
| `run-ai-rewriter` | Internal / scheduled | Rewrite stories based on fact-check feedback |
| `run-ai-editor` | Internal / scheduled | Final editorial review (publish/reject/feature) |
| `scheduled-run-editor` | pg_cron | Orchestrates 3-stage editorial pipeline (fact-check → rewrite → edit) |

**Publishing:**
| Function | Trigger | Purpose |
|---|---|---|
| `publish-story` | UI / editorial pipeline | Set status=published, generate slug, trigger Vercel revalidation + Facebook post |
| `publish-to-facebook` | Internal (called by publish-story) | Post story link to Facebook Page via Graph API |
| `publish-about-page` | Manual | Publish about page content |

**Infrastructure:**
| Function | Trigger | Purpose |
|---|---|---|
| `fetch-openrouter-models` | UI | List available LLM models from OpenRouter |
| `manage-schedule` | UI | Enable/disable/update schedule config |
| `recover-stuck-queue-items` | Internal | Watchdog: retry stuck queue items (max 3 retries) |
| `scheduled-recover-queue` | pg_cron (every 15min) | Cron wrapper for queue recovery watchdog |
| `send-alert` | DB trigger / internal | Send error alerts via Resend email |

**Image maintenance:**
| Function | Trigger | Purpose |
|---|---|---|
| `backfill-artifact-images` | UI / manual | Extract images from artifact HTML |
| `backfill-story-images` | Manual | Fix missing hero images on stories |

### Shared Modules (`supabase/functions/_shared/`)
| Module | Exports |
|---|---|
| `cors.ts` | `corsHeaders`, `handleCorsPrelight(req)` |
| `supabase-client.ts` | `createSupabaseClient()`, `getSupabaseUrl()`, `getServiceRoleKey()` |
| `cron-logger.ts` | `logCronJob(supabase, log)` |
| `llm-client.ts` | `callLLM(options)` — OpenRouter API wrapper with retry |
| `readability.ts` | `fetchPageHTML(url)`, `extractWithReadability(html)`, `extractImages(html, baseUrl)`, `extractVideos(html)` — Mozilla Readability extraction |
| `schedule-gate.ts` | `checkScheduleGate(supabase, type, name, req, start)` — shared active-hours gate for scheduled functions |
| `ghost-token.ts` | `generateGhostToken(apiKey)` — legacy, used by backfill-story-images and publish-about-page |

### Key File Paths
- Admin UI pages: `src/pages/`
- Admin Supabase client: `src/integrations/supabase/client.ts`
- Public site (Next.js): `site/`
- Public site pages: `site/app/`
- Public site components: `site/components/`
- Public site Supabase client: `site/lib/supabase.ts`
- Edge functions: `supabase/functions/<name>/index.ts`
- Shared utilities: `supabase/functions/_shared/`
- DB migrations: `supabase/migrations/`
- Supabase config: `supabase/config.toml`
- Tests: `supabase/functions/**/__tests__/`, `vitest.config.ts`
- CI/CD: `.github/workflows/ci.yml`, `.github/workflows/agent.yml`, `.github/workflows/agent-daily-report.yml`

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
- `OPENROUTER_API_KEY`
- `QUEUE_PROCESSOR_SECRET`
- `LOVABLE_API_KEY`
- `VERCEL_REVALIDATION_SECRET` — shared with Vercel for on-demand ISR
- `FACEBOOK_PAGE_ACCESS_TOKEN` + `FACEBOOK_PAGE_ID` — Facebook Graph API publishing
- `RESEND_API_KEY` (optional — for email alerts via send-alert)
- `ALERT_EMAIL` (optional — recipient for error alerts)
- `GHOST_ADMIN_API_KEY` + `GHOST_API_URL` — legacy, used by backfill-story-images and publish-about-page

Stored in Vercel environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `REVALIDATION_SECRET` — must match `VERCEL_REVALIDATION_SECRET` in Supabase

Stored in GitHub repository secrets (for CI/CD):
- `SUPABASE_PROJECT_ID`
- `SUPABASE_ACCESS_TOKEN`

Stored locally in `.env` (never committed):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
