# Vercel Deployment — Status

**Migration status: COMPLETE as of 2026-04-04.**

The public site is live at https://woodstockcommunity.news, serving stories directly from Supabase via the Next.js App Router on Vercel. Ghost CMS has been retired from the active publish path.

---

## What's deployed

- **Vercel project**: builds from `site/` directory, Next.js 16 + React 19
- **Domain**: `woodstockcommunity.news` (Vercel-managed SSL)
- **Publish path**: admin UI → `publish-story` edge function → slug generated → `/api/revalidate` triggers ISR refresh → `publish-to-facebook` posts link (first publish only)
- **ISR**: story pages, homepage, and feed.xml revalidate every 3600s; on-demand revalidation via `/api/revalidate?secret=...&path=...`

## Completed

- [x] Vercel project created, linked to `craig-angrychicken/woodstockcommunitynews-37647aaa`
- [x] Root directory set to `site`
- [x] Environment variables configured (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `REVALIDATION_SECRET`)
- [x] `VERCEL_REVALIDATION_SECRET` added to Supabase function secrets
- [x] Homepage loads with Featured + Latest sections
- [x] Story detail pages render (title, image, body, byline, source attribution, related stories)
- [x] `/about`, `/feed.xml`, `/sitemap.xml` all working
- [x] DNS pointed to Vercel, SSL active
- [x] Publish flow tested end-to-end from admin UI
- [x] Facebook auto-posting on first publish
- [x] Story slugs backfilled (migration `20260402000001_add_slug_to_stories.sql`)

## Ghost cleanup — remaining

Once fully confident nothing depends on Ghost:

1. Remove Ghost secrets from Supabase dashboard:
   - `GHOST_ADMIN_API_KEY`
   - `GHOST_API_URL`
2. Delete legacy Ghost edge functions:
   - `supabase/functions/publish-to-ghost/`
   - `supabase/functions/publish-about-page/` (if Ghost-specific)
   - `supabase/functions/migrate-ghost-stories/` (one-time tool, already run)
   - `supabase/functions/check-ghost-images/` (debugging tool)
   - `supabase/functions/_shared/ghost-token.ts`
3. Remove Ghost references from the admin UI (any "Publish to Ghost" buttons)
4. Shut down Ghost instance
5. Drop/repurpose the `ghost_url` column on `stories` (currently used as the canonical public URL)
