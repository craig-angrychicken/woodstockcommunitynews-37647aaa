# Woodstock Community News — Supabase/Vercel → Cloudflare migration history

**Status: LIVE on Cloudflare.** This document is the session handoff — read it to resume work in a fresh session.
Branch: **`migrate/cloudflare`** (not yet merged to `main`). Companion docs: [`CUTOVER.md`](CUTOVER.md) (operator runbook),
[`workers/CONTRACT.md`](workers/CONTRACT.md) (port spec), [`workers/ADMIN_API_SPEC.md`](workers/ADMIN_API_SPEC.md) (admin endpoints),
[`workers/schema.sql`](workers/schema.sql) (D1 schema).

## Why
On 2026-06-18 the Supabase project hit a free-tier `exceed_storage_size_quota` 402 and got restricted — the public site,
admin, and the AI journalism pipeline all went dark (had been down since ~June 11). The owner declined Supabase Pro and
chose to move the whole stack to **Cloudflare** (reusing the existing Cloudflare account/creds from the RISO4 project).

## Architecture: before → after
| Concern | Before (Supabase/Vercel) | After (Cloudflare) |
|---|---|---|
| Database | Supabase Postgres (+ pgvector, pg_cron, pg_net, RLS) | **D1** (SQLite) `wcn` = `7b161ae7-7f3c-42fd-a627-dd3fb1058f14` |
| Vectors | pgvector ivfflat + `match_*_by_embedding` RPCs | embeddings as TEXT(JSON) + **in-worker cosine** (`workers/src/pipeline/cluster-artifacts.ts`) |
| Object storage | Supabase Storage `artifact-images` (public) | **R2** bucket `artifact-images`; served at `/images/<key>` |
| ~28 edge functions (Deno) | `supabase/functions/*` | **Workers** (Hono) in `workers/src/pipeline/*` + `routes/*` |
| Scheduling | `pg_cron` (6 jobs) + `pg_net` | **Cron Triggers** (`workers/src/cron.ts`, 5 schedules) |
| Serial story queue | `journalism_queue` + fire-and-forget chaining | **Cloudflare Queue** `wcn-journalism` (+ `-dlq`), consumer in `workers/src/queue.ts` |
| Auth | Supabase Auth + RLS + `user_roles` | **Cloudflare Access** (admin gated; public open). RLS dropped, authz at app layer. |
| Public site | Next.js 16 on Vercel (ISR) | **OpenNext** on Workers (`site/`), reads D1, images from R2 |
| Admin UI | Vite SPA, `supabase.from()`/`functions.invoke()`/realtime | Vite SPA on **Pages**, `src/lib/api.ts` client, realtime→polling |
| Monitor agent | `scripts/agent.mjs` (Supabase REST) on GitHub Actions | same, repointed to **D1 HTTP API** + Worker endpoints |
| Deploy | `supabase db push` + Vercel | `.github/workflows/ci.yml` → `wrangler deploy` + OpenNext + Pages |

## Cloudflare resources (account `b525c1c1dc3a72e95a5bad3eb28d7ee7`, craig@angrychicken.co)
- **D1** `wcn` `7b161ae7-7f3c-42fd-a627-dd3fb1058f14`
- **R2** `artifact-images`
- **Queues** `wcn-journalism` + `wcn-journalism-dlq`
- **Worker** `wcn-api` — API + admin CRUD + pipeline + Cron Triggers + Queue consumer.
  Routes: `admin.woodstockcommunity.news/api/*` and `/images/*`. (workers.dev disabled.)
- **Worker** `wcn-site` — OpenNext public site. Custom domains: `woodstockcommunity.news` + `www`.
- **Pages** `wcn-admin` — admin SPA. Custom domain: `admin.woodstockcommunity.news`.
- **Access** — team `holy-bar-b3ad.cloudflareaccess.com`; app "WCN Admin" gates `admin.woodstockcommunity.news`
  (covers the SPA + same-origin `/api/*`); AUD `e69f5d02d7d2b9209dd90ea9cf77f3b466da84842110e42736bc8383fb3f3f06`.
  Policy: Allow → email craig@angrychicken.co.

## Live URLs (verified 200)
- Public: **https://woodstockcommunity.news** (+ www) — renders stories + R2 images from D1.
- Admin: **https://admin.woodstockcommunity.news** — behind Access (one-time PIN login), SPA + `/api/*` same-origin.

## Data migrated (Supabase → D1; verified counts)
657 stories (619 published) · 614 artifacts · 376 story_artifacts · 61 artifact_clusters · 22 council_meetings ·
8 sources · 8 prompt_versions · 4 schedules · 1 app_setting. **663 images** copied to R2; image URLs rewritten to `/images/<key>`.
**Deliberately NOT migrated:** `cron_job_logs` (the storage hog), `query_history` + `journalism_queue` (transient; pipeline
rebuilds them), `user_roles` + `auth.*` (Access replaces auth). Migration method: `supabase db dump` (via colima/Docker) →
`workers/scripts/pg-dump-to-d1.mjs` transform → `wrangler d1 execute --file`; images via `workers/scripts/migrate-images.mjs` (R2 S3 API).

## Secrets set on `wcn-api` (verified working via live self-test)
`OPENROUTER_API_KEY`, `RESEND_API_KEY`, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`, `QUEUE_PROCESSOR_SECRET`, `REVALIDATION_SECRET`.
Site `wcn-site` has matching `REVALIDATION_SECRET`. (Ghost dropped — not needed. `ALERT_EMAIL` unset → monitor defaults to craig@. `LOVABLE_API_KEY` optional, unset.)
Loader: `workers/scripts/set-secrets.sh` (+ `.secrets.env.example`). **Note:** the agent cannot run `wrangler secret put` (API-key policy) — secrets were set by the operator.

## Key decisions & gotchas (important for future work)
- **D1 is SQLite** — all SQL is SQLite dialect: `datetime('now',…)` not `NOW()/INTERVAL`, `?` params, booleans 0/1, timestamps ISO-8601 TEXT,
  JSON columns are TEXT (decode with `fromJson`). FK constraints enforced at app layer (schema has none — avoids circular-FK/import issues).
- **Admin must be same-origin with its API.** SPA + `/api/*` both live under `admin.woodstockcommunity.news` so one Access cookie covers
  both (cross-domain pages.dev↔workers.dev does NOT share the Access cookie — this was a real trap that was fixed).
- **Public site stays OPEN** — never put `woodstockcommunity.news` behind Access.
- **Pipeline is LIVE (since 2026-06-19).** `schedules`: `artifact_fetch` / `ai_journalism` / `ai_editor` enabled, `council_scraper` off. Cron auto-generates → fact-checks → rewrites → edits → publishes to the public site + Facebook hourly. First go-live cycle published 9 stories (verified live: homepage + a story page both 200). Five publish-safety guardrails were added at go-live (commit 4f2ce35: quality gate at the publish chokepoint, empty-LLM-response guards in fact-check/rewrite, durable stuck-item re-enqueue). To pause: `UPDATE schedules SET is_enabled=0`.
- Worker runtime libs: `linkedom` + `@mozilla/readability` (HTML), `unpdf` (PDF, replaced the Deno extractor), `fast-xml-parser` (RSS), `hono`, `jose` (Access JWT).
- Credential locations: OpenRouter key in `RISO4/viewer/.env.local`; R2 S3 keys in `RISO4/.env`; wrangler is OAuth-authed.
  Supabase secrets are **digest-only** (not exportable). Tooling installed this session: `colima` (Docker), `ffmpeg`.
- The monitor's GitHub secrets should be: `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID`, `D1_DATABASE_ID`,
  `WORKER_BASE_URL=https://admin.woodstockcommunity.news`, `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` (from a `wcn-monitor` service token), `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.

## Repo layout (branch `migrate/cloudflare`)
- `workers/` — `wcn-api`. `src/index.ts` (Hono `{fetch,scheduled,queue}`), `src/pipeline/*` (22 ported functions),
  `src/routes/admin/*` (CRUD) + `pipeline-admin.ts` (triggers), `src/cron.ts`, `src/queue.ts`, `src/_shared/*`, `schema.sql`.
- `site/` — OpenNext public site (Next 16). `lib/db.ts` (D1), `app/images/[...key]/route.ts` (R2), data routes runtime-rendered.
- `src/` — admin SPA (Vite). `lib/api.ts` client, hooks/pages off Supabase, Access identity in `useAuth.ts`.
- `scripts/agent.mjs` — monitor (D1 HTTP API + Worker endpoints). `.github/workflows/` — ci.yml + agent*.yml.
- `supabase/` — ORIGINAL Deno functions + migrations, kept as reference until decommission.

## What remains (operator)
1. **Add the `CLOUDFLARE_API_TOKEN` GitHub secret, then merge `migrate/cloudflare` → `main`** (clean fast-forward). The CI deploy job needs it; `CF_ACCOUNT_ID` is already set. Token perms: Account → Workers Scripts:Edit + Cloudflare Pages:Edit + D1:Edit, and Access → Apps & Policies:Edit + Service Tokens:Edit. (wrangler's OAuth login lacks the `access` scope and can't mint API tokens, so this must be created in the dashboard.)
2. **Smoke-test admin:** log in at https://admin.woodstockcommunity.news (one-time PIN) → confirm CRUD works. (Or, once the CF API token above exists, create a `wcn-monitor` Access service token to automate it + the monitor.)
3. **Decommission** (after a day or two as fallback): pause/delete Vercel project `prj_fAfxifRgx2eWBLnPla2gRvm7Uye8` (needs `vercel login` — CLI not currently authed); downgrade/delete Supabase `cceprnhnpqnpexmouuig` (supabase CLI is logged in). Remove `.vercel/`, `supabase/`, unused `@supabase/*` deps, `VITE_SUPABASE_*`.

**✅ Done 2026-06-19 (go-live session):** pipeline turned on for full auto-publish; publish-safety hardening deployed; ESLint build-output ignore fixed (lint 0 errors); branch pushed to origin; `CF_ACCOUNT_ID` GitHub secret set.

## Verify quickly
```bash
# Public site
curl -sI https://woodstockcommunity.news/ | head -1
# Admin gated (expect 302 → holy-bar-b3ad.cloudflareaccess.com)
curl -sI https://admin.woodstockcommunity.news/api/db-check | head -1
# D1 row counts
cd workers && npx wrangler d1 execute wcn --remote --command "select count(*) from stories"
# Secrets present
cd workers && npx wrangler secret list
```

## Commits (newest first)
```
776f626 Go-live config: Access AUD/team-domain + custom-domain routes
74d670b Drop Ghost from secret loader
8562350 Add one-command Worker secret loader (set-secrets.sh)
45502ef Deploy worker + site + admin to Cloudflare test URLs
b7f13d3 Add cutover runbook + migration banner (Phase 9 prep)
7fe0f7c Rework CI/CD for Cloudflare (Phase 8)
d4e2022 Repoint monitor agent to D1 + Workers (Phase 7)
7f3bdab Rewrite admin SPA: Supabase → admin API + Cloudflare Access (Phase 6)
16b6696 Build admin CRUD API (38 endpoints) + SPA API client (Phase 6 backend)
f55e3a6 Migrate public site to OpenNext on Cloudflare reading D1 (Phase 5)
2d3ecc6 Port edge functions to Workers + wire cron & queue (Phases 3-4)
17bf224 Add public read API + R2 image route (Phase 3 start)
7823998 Migrate data layer to Cloudflare D1 + R2
```
