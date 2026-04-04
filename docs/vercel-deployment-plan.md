# Vercel Deployment Plan

Everything is built, tested, and deployed to Supabase. This is what's left.

## 1. Create Vercel Project

1. Go to https://vercel.com/new
2. Import the GitHub repo `craig-angrychicken/woodstockcommunitynews-37647aaa`
3. Set **Root Directory** to `site`
4. Framework Preset: **Next.js** (should auto-detect)
5. Add environment variables:
   - `SUPABASE_URL` = `https://cceprnhnpqnpexmouuig.supabase.co`
   - `SUPABASE_ANON_KEY` = (copy from `.env` → `VITE_SUPABASE_PUBLISHABLE_KEY`)
   - `REVALIDATION_SECRET` = generate a random string (e.g., `openssl rand -hex 32`)
6. Deploy

## 2. Add Revalidation Secret to Supabase

1. Go to https://supabase.com/dashboard/project/cceprnhnpqnpexmouuig/settings/functions
2. Add secret: `VERCEL_REVALIDATION_SECRET` = same value you used for `REVALIDATION_SECRET` in Vercel

## 3. Verify on Temporary Vercel Domain

Before touching DNS, test on the `*.vercel.app` URL that Vercel assigns:

- [ ] Homepage loads with Featured + Latest sections
- [ ] Click a story — detail page renders with title, image, body, source attribution
- [ ] `/about` page renders
- [ ] `/feed.xml` returns valid RSS
- [ ] `/sitemap.xml` lists all stories
- [ ] `/rss/` redirects to `/feed.xml`

## 4. Test Publish Flow

1. Open admin UI at localhost:5173 (or wherever it's hosted)
2. Find a pending/edited story → click **Publish**
3. Verify the story appears on the Vercel site within a few seconds
4. Check that Facebook post was created (if Facebook credentials are configured)

## 5. Point DNS to Vercel

1. In Vercel project settings → Domains → add `woodstockcommunity.news`
2. Update DNS records for `woodstockcommunity.news`:
   - If using Vercel nameservers: follow their instructions
   - If using external DNS: add CNAME to `cname.vercel-dns.com` (or A records per Vercel docs)
3. Vercel handles SSL automatically
4. Wait for DNS propagation (usually minutes, sometimes up to an hour)

## 6. Verify Live Site

- [ ] https://woodstockcommunity.news loads correctly
- [ ] Story pages work
- [ ] About page works
- [ ] RSS feed works
- [ ] Publish a test story from admin → appears on live site
- [ ] Facebook post links to woodstockcommunity.news (not Ghost)

## 7. Ghost Cleanup (after everything is confirmed working)

Once confident the Vercel site is live and stable:

1. Remove Ghost secrets from Supabase dashboard:
   - `GHOST_ADMIN_API_KEY`
   - `GHOST_API_URL`
2. Delete Ghost edge functions (can do this in a future session with Claude):
   - `supabase/functions/publish-to-ghost/`
   - `supabase/functions/publish-about-page/`
   - `supabase/functions/_shared/ghost-token.ts`
3. Shut down Ghost instance
