# Project: Woodstock Community News

Woodstock Community News — AI-generated local news for Woodstock, Georgia and Cherokee County.
The entire app runs on **Cloudflare**: D1 (SQLite) for data, R2 for images, Workers for the API +
pipeline, OpenNext on Workers for the public site, and Pages for the admin SPA.

## Architecture

Three parts in one repo, plus one shared Cloudflare Worker:

1. **Admin SPA** (`src/`) — Vite + React + TypeScript + Tailwind + shadcn/ui. Private dashboard for
   managing the pipeline. Deployed to **Cloudflare Pages** (project `wcn-admin`) at
   `admin.woodstockcommunity.news`. Talks to the worker admin API via `src/lib/api.ts`. Gated by
   **Cloudflare Access**.
2. **Public site** (`site/`) — Next.js, built and deployed with **OpenNext on Cloudflare Workers** at
   `woodstockcommunity.news` (+ www). Reads stories from D1 (`site/lib/db.ts`); serves hero images from
   R2. Open to the public (no auth).
3. **Worker** (`workers/`) — a single Cloudflare Worker named `wcn-api` (Hono). It serves the admin API
   and the `/images/*` route, runs the AI journalism pipeline on **Cron Triggers**, and consumes a
   Cloudflare **Queue** (`wcn-journalism`) for serial story processing.

**External services:** OpenRouter (LLM access) and the Facebook Graph API (social publishing).

### Domains & routing
- Public site: `woodstockcommunity.news` (+ `www`) — served by the OpenNext site Worker.
- Admin: `admin.woodstockcommunity.news` — the Pages SPA. The `wcn-api` Worker is routed on the same
  host for `admin.woodstockcommunity.news/api/*` and `/images/*`, so the SPA is same-origin and a single
  Cloudflare Access login covers both.

### Cloudflare resources
- **D1** database `wcn`, id `7b161ae7-7f3c-42fd-a627-dd3fb1058f14` (binding `DB`).
- **R2** bucket `artifact-images` (binding `ARTIFACT_IMAGES`), served at `/images/<key>`.
- **Queue** `wcn-journalism` (binding `JOURNALISM_QUEUE`), DLQ `wcn-journalism-dlq`, batch size 1 /
  concurrency 1 for serial processing.

## Pipeline & schedules

The pipeline lives in `workers/src/pipeline/*` and is dispatched by `workers/src/cron.ts`:

1. **fetch** — pull RSS feeds + web pages → `artifacts`.
2. **cluster** — in-worker cosine similarity over JSON embeddings to group near-duplicate artifacts.
3. **journalism-queue** — convert an artifact (or cluster) into a draft story via the LLM. Serial, via
   the `wcn-journalism` Queue (`workers/src/queue.ts`).
4. **editorial-pipeline** — fact-check → rewrite → edit → publish.
5. **publish-story** — set `status='published'`, generate a `slug`, trigger public-site revalidation, and
   post to Facebook.

Schedules are **rows in the D1 `schedules` table** (`schedule_type` one of `artifact_fetch`,
`ai_journalism`, `ai_editor`, `council_scraper`), each with `scheduled_times`, `is_enabled`, and an
`active_hour_start`/`active_hour_end` gate. The Worker's **Cron Triggers** (5 cron expressions in
`workers/wrangler.jsonc`) wake `cron.ts`, which checks the table to decide what to run: fetch + queue
recovery (~15m), cluster, journalism, editorial, and the council scraper.

## D1 tables

All SQL is **SQLite dialect**. Schema lives in `workers/schema.sql`.

| Table | Purpose |
|---|---|
| `sources` | RSS Feed and Web Page sources (url, type, status, last_fetch_at) |
| `artifacts` | Raw content fetched from RSS feeds / web pages; includes an embedding (JSON-array TEXT) and `cluster_id` for dedup |
| `artifact_clusters` | Groups of similar artifacts (in-worker cosine similarity) |
| `stories` | AI-generated articles. Status: pending/fact_checked/edited/draft/published/archived/rejected. Key columns: `slug` (public URL), `published_url` (public story URL), `featured`, `environment`, `structured_metadata` (TEXT/JSON), `word_count`, `source_count`, `reading_level`, `generation_metadata` (TEXT/JSON), `fact_check_notes`, `hero_image_url`, `published_at`, `facebook_post_id`, `title_embedding` (JSON-array TEXT) |
| `story_artifacts` | Many-to-many junction: stories ↔ artifacts |
| `prompt_versions` | AI prompt templates (retrieval + journalism types) |
| `journalism_queue` | Serial processing queue for artifact → story conversion (with `retry_count` for watchdog recovery) |
| `query_history` | Logs of journalism pipeline runs |
| `schedules` | Cron schedule config (`artifact_fetch`, `ai_journalism`, `ai_editor`, `council_scraper`) |
| `app_settings` | Global config (e.g. `ai_model_config`) |
| `cron_job_logs` | Audit trail of automated tasks |
| `council_meetings` | Scraped city-council meeting records (council scraper) |

### Admin SPA routes (React Router, all gated by Cloudflare Access)
| Route | Purpose |
|---|---|
| `/` | Dashboard — pipeline overview + system health |
| `/stories` | View/manage/publish generated stories |
| `/ai-journalist` | Monitor journalism pipeline + queue |
| `/ai-editor` | Monitor editorial pipeline (fact-check → rewrite → edit) |
| `/manual-query` | Manually trigger a journalism run |
| `/artifacts` | Browse raw RSS/web-page artifacts |
| `/prompts` | Manage AI prompt templates |
| `/sources` | Configure RSS Feed and Web Page sources |
| `/models` | Select and configure the LLM model |

### Public site routes (Next.js App Router — `site/`)
| Route | Purpose |
|---|---|
| `/` | Homepage — Featured + Latest stories |
| `/[slug]` | Story detail page (hero image, metadata, related stories) |
| `/about` | About page |
| `/feed.xml` | RSS feed |
| `/sitemap.xml` | Dynamic sitemap |

## Deploy

CI/CD is **GitHub Actions** (`.github/workflows/ci.yml`):
- **On PRs** — build, lint, test, and typecheck.
- **On push to `main`** — deploy all three:
  - Worker: `cd workers && wrangler deploy`
  - Public site: `cd site && opennextjs-cloudflare build && opennextjs-cloudflare deploy`
  - Admin SPA: `wrangler pages deploy dist --project-name=wcn-admin`

Local dev runs via **wrangler**. Never commit `.env` — it contains secrets.

## Worker secrets

Set with `wrangler secret put` on the `wcn-api` Worker:
- `OPENROUTER_API_KEY` — LLM access
- `RESEND_API_KEY` — email alerts
- `FACEBOOK_PAGE_ACCESS_TOKEN` + `FACEBOOK_PAGE_ID` — Facebook Graph API publishing
- `QUEUE_PROCESSOR_SECRET` — authorizes queue-processing calls
- `REVALIDATION_SECRET` — shared with the public site for on-demand revalidation

## Key file paths
- Admin pages: `src/pages/`
- Admin API client: `src/lib/api.ts`
- Public site: `site/` (pages `site/app/`, components `site/components/`, D1 access `site/lib/db.ts`)
- Worker: `workers/src/` — `index.ts`, `pipeline/*`, `routes/*`, `cron.ts`, `queue.ts`, `_shared/*`
- DB schema: `workers/schema.sql`
- Worker config: `workers/wrangler.jsonc`
- CI/CD: `.github/workflows/`

## Gotchas (D1 = SQLite, not Postgres)
- Use SQLite functions: `datetime('now')` for timestamps, not `now()`.
- Parameter placeholders are positional `?`, not `$1`.
- Booleans are integers: `0` / `1`, not `true` / `false`.
- Timestamps are ISO-8601 strings in TEXT columns.
- "JSON" columns are TEXT — serialize with `JSON.stringify` on write and `JSON.parse` on read.
