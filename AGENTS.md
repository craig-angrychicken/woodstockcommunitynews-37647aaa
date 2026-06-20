# Project: Woodstock Community News — Agent Notes

See **[CLAUDE.md](CLAUDE.md)** for the full project guide: architecture, the three parts (admin `src/`,
public `site/`, worker `workers/`), D1 tables, the pipeline + schedules, deploy process, and key file
paths. That document is the source of truth — this file only adds agent-specific notes.

## Quick orientation

- All-Cloudflare stack: **D1** (SQLite) for data, **R2** for images, **Workers** for the API + AI
  pipeline (`workers/`), **OpenNext** on Workers for the public site (`site/`), and **Pages** for the
  admin SPA (`src/`). Admin is gated by **Cloudflare Access**; the public site is open.
- Public site: `woodstockcommunity.news`. Admin: `admin.woodstockcommunity.news` (the `wcn-api` Worker
  serves `/api/*` and `/images/*` same-origin under that host).

## Working in this repo

- **All SQL is SQLite dialect.** Use `datetime('now')`, positional `?` params, integer booleans (`0`/`1`),
  ISO-8601 TEXT timestamps, and TEXT columns for JSON (serialize/parse yourself). Schema lives in
  `workers/schema.sql`.
- **Deploy is automatic** on push to `main` via `.github/workflows/ci.yml` (Worker via `wrangler deploy`,
  site via `opennextjs-cloudflare deploy`, admin via `wrangler pages deploy`). PRs run
  build/lint/test/typecheck. Local dev runs via wrangler.
- **Never commit `.env`** — it contains secrets. Worker secrets are managed with `wrangler secret put`.
- The stories column holding a published story's public URL is `published_url`.
