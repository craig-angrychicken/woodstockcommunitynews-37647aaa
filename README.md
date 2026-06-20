# Woodstock Community News

AI-generated local news for Woodstock, Georgia and Cherokee County, running entirely on **Cloudflare**.

An automated pipeline fetches local sources, clusters related items, drafts stories with an LLM, runs
them through an editorial review (fact-check → rewrite → edit), and publishes them to the public site and
Facebook.

## Stack

- **Data:** Cloudflare **D1** (SQLite), database `wcn`.
- **Images:** Cloudflare **R2** (`artifact-images` bucket), served at `/images/<key>`.
- **API + pipeline:** a Cloudflare **Worker** (`wcn-api`, Hono) in `workers/` — serves the admin API and
  image route, runs the AI journalism pipeline on **Cron Triggers**, and consumes a Cloudflare **Queue**
  (`wcn-journalism`) for serial story processing.
- **Public site:** Next.js built and deployed with **OpenNext on Cloudflare Workers** (`site/`), reading
  from D1.
- **Admin dashboard:** a Vite + React + TypeScript + Tailwind + shadcn/ui SPA (`src/`) on **Cloudflare
  Pages**, gated by **Cloudflare Access**.

External services: **OpenRouter** (LLM access) and the **Facebook Graph API** (social publishing).

## Repo layout

| Path | What it is |
|---|---|
| `src/` | Admin SPA (pages in `src/pages/`, API client in `src/lib/api.ts`) |
| `site/` | Public Next.js site (pages in `site/app/`, components in `site/components/`, D1 access in `site/lib/db.ts`) |
| `workers/` | `wcn-api` Worker — `src/index.ts`, `pipeline/*`, `routes/*`, `cron.ts`, `queue.ts`, `_shared/*`; schema in `workers/schema.sql` |
| `.github/workflows/` | CI/CD |

## Domains

- Public site: `woodstockcommunity.news` (+ `www`).
- Admin: `admin.woodstockcommunity.news` (the Worker serves `/api/*` and `/images/*` same-origin under
  this host).

## Development & deploy

Local development runs via **wrangler**. Deploys are automatic via GitHub Actions
(`.github/workflows/ci.yml`): PRs run build/lint/test/typecheck, and pushes to `main` deploy the Worker
(`wrangler deploy`), the public site (`opennextjs-cloudflare deploy`), and the admin SPA
(`wrangler pages deploy dist --project-name=wcn-admin`).

All database SQL is SQLite dialect.

See [CLAUDE.md](CLAUDE.md) for the full architecture, D1 schema, pipeline details, and developer gotchas.
