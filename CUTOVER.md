# Cloudflare cutover runbook

The app has been migrated off Supabase/Vercel to Cloudflare (D1 + R2 + Workers + Pages + OpenNext +
Cron Triggers + Queues + Access). All code + data + images are migrated and verified locally. The steps
below are the **operator actions** (Cloudflare/GitHub dashboards) needed to go live, plus the final DNS flip
and decommission. Account: craig@angrychicken.co (`b525c1c1dc3a72e95a5bad3eb28d7ee7`).

## LIVE NOW (deployed to test URLs — no custom domain yet)
- **Public site:** https://wcn-site.craig-b52.workers.dev — ✅ fully working (renders stories + R2 images from D1).
- **API/pipeline Worker:** https://wcn-api.craig-b52.workers.dev — ✅ public endpoints work; admin routes 401 (fail-closed,
  awaiting Access); cron + queue registered; **schedules DISABLED** (re-enable after setting OPENROUTER_API_KEY).
- **Admin SPA:** https://wcn-admin.pages.dev — deployed; data calls 401 until Access + secrets are set.

Remaining steps below are the ones that need you (secret values, Access, DNS, decommission).

## Already done (in this repo, branch `migrate/cloudflare`)
- D1 `wcn` (`7b161ae7-7f3c-42fd-a627-dd3fb1058f14`) — schema + data loaded (657 stories, 614 artifacts, …).
- R2 `artifact-images` — 663 objects copied; image URLs rewritten to `/images/<key>`.
- `workers/` — API + pipeline (22 functions), Cron Triggers, Queue consumer. Type-checks, bundles, boots.
- `site/` — Next.js 16 on OpenNext, reads D1, serves `/images/*` from R2. Builds + renders.
- `src/` (admin SPA) — Supabase removed; uses `/api/admin` + Cloudflare Access. Builds.
- `scripts/agent.mjs` + workflows — repointed to D1 HTTP API + Worker endpoints.
- `ci.yml` — deploys Worker + site + Pages on push to main.

## 1. Create resources (one-time)
- **Pages project** for the admin SPA: `npx wrangler pages project create wcn-admin`.
- **Cloudflare Access** (Zero Trust):
  - Add an Access **application** covering `admin.woodstockcommunity.news` and `api.woodstockcommunity.news`
    with a policy allowing your email (craig@angrychicken.co).
  - Note the application **AUD** tag and your team domain (`<team>.cloudflareaccess.com`).
  - Create an Access **service token** (for the monitor agent) → note Client ID + Client Secret.
- Put the real Access values into `workers/wrangler.jsonc` vars: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.

## 2. Secrets
**Worker (`cd workers && npx wrangler secret put <NAME>`):** `OPENROUTER_API_KEY` (reuse RISO4's),
`LOVABLE_API_KEY` (optional), `RESEND_API_KEY`, `ALERT_EMAIL`, `FACEBOOK_PAGE_ACCESS_TOKEN`,
`FACEBOOK_PAGE_ID`, `FACEBOOK_PLACE_ID` (optional), `QUEUE_PROCESSOR_SECRET`, `REVALIDATION_SECRET`,
`GHOST_API_URL` + `GHOST_ADMIN_API_KEY` (optional), `R2_PUBLIC_URL` (optional — leave unset to serve images
via the site at `/images/*`).
**Site (`cd site && npx wrangler secret put REVALIDATION_SECRET`)** — must match the Worker's.
**GitHub Actions repo secrets:** `CLOUDFLARE_API_TOKEN` (Workers+Pages+D1 edit), `CF_ACCOUNT_ID`,
`D1_DATABASE_ID` = `7b161ae7-7f3c-42fd-a627-dd3fb1058f14`, `WORKER_BASE_URL` = `https://api.woodstockcommunity.news`,
`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, plus existing `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.
Set `VITE_API_BASE_URL=https://api.woodstockcommunity.news` for the Pages build (admin SPA → API).

## 3. First deploy (from the branch, before DNS)
- `cd workers && npx wrangler deploy` → wcn-api (gets a `*.workers.dev` URL; cron + queue auto-registered).
- `cd site && npx opennextjs-cloudflare build && npx opennextjs-cloudflare deploy` → wcn-site.
- `npm run build && npx wrangler pages deploy dist --project-name=wcn-admin` → admin SPA.
- Verify each on its `*.workers.dev` / `*.pages.dev` URL (see checklist) before pointing DNS.

## 4. DNS + custom domains (the cutover)
- Move `woodstockcommunity.news` to Cloudflare (nameservers) if not already.
- Custom domains/routes: apex `woodstockcommunity.news` → **wcn-site**; `api.` → **wcn-api**;
  `admin.` → **wcn-admin** (Pages). Put the Access app in front of `api.` and `admin.`.
- Keep the old Vercel deployment live until the checklist passes, then flip the apex record.

## 5. Verification checklist
1. `https://woodstockcommunity.news/` and a `/<slug>` story render with images (served from R2). `cf-ray` header present.
2. `/feed.xml`, `/sitemap.xml` return 200.
3. `admin.woodstockcommunity.news` → Access login → dashboard loads, sources/stories/prompts CRUD works.
4. Trigger a manual run from the admin (or `POST api…/api/admin/pipeline/fetch-artifacts`) → new artifacts appear.
5. Cron: confirm scheduled invocations in the Worker logs; `cron_job_logs` getting rows.
6. `publish-story` on a test story revalidates the site page.
7. Monitor: run the `Pipeline Monitor Agent` GitHub Action manually → reads D1, sends the Resend briefing.

## 6. Decommission (after the checklist passes)
- Pause/delete the Vercel project(s) (`prj_fAfxifRgx2eWBLnPla2gRvm7Uye8`).
- Downgrade/delete the Supabase project `cceprnhnpqnpexmouuig` (this is what triggered the migration).
- Remove `.vercel/` dirs, the `supabase/` dir (originals — kept as reference), unused `@supabase/supabase-js`
  deps, and `VITE_SUPABASE_*` from `.env`. Merge `migrate/cloudflare` → `main`.

## Architecture (after)
public site → **wcn-site** (OpenNext/Workers) → D1 + R2 · admin → **wcn-admin** (Pages, Access) → **wcn-api** →
D1 + R2 · pipeline → **wcn-api** Cron Triggers + Queue → D1/R2/OpenRouter/Facebook/Resend · monitor →
GitHub Actions → D1 HTTP API + wcn-api.
