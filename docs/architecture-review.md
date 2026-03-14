# Woodstock Community News — Architecture Review & Improvement Plan

## Context

You built a local AI journalism pipeline with Lovable and migrated/cleaned it with Claude Code. The current system fetches RSS artifacts, generates stories via LLM, and publishes to Ghost CMS through an AI editor gate. You want to assess the stack, improve quality, and expand into social media.

**What you have today:** A working 7-stage pipeline (RSS fetch → artifacts → journalism queue → LLM story generation → AI editor gate → Ghost publish) with scheduling, audit logging, and an admin dashboard. 13 edge functions, 8 frontend pages, 11 database tables.

---

## 1. Stack Assessment

| Layer | Current | Verdict |
|---|---|---|
| **Git + GitHub** | git, manual push | **Keep.** Add CI/CD (see below). |
| **Supabase** | Postgres + Edge Functions + Storage + Auth | **Keep.** Right choice for this scale. Fix usage patterns (shared code, queue reliability, security). |
| **Vercel** | Mentioned but not configured — no `vercel.json` exists | **Add.** Connect GitHub repo, set build command to `npm run build`, output dir `dist`. Zero config for Vite. |
| **Ghost CMS** | Managed/self-hosted, publishing via Admin API | **Keep for now, replace later.** See below. |
| **RSS** | Only source type supported | **Expand.** Add source abstraction layer for social media, municipal websites. |
| **OpenRouter** | LLM access, model-agnostic | **Keep.** Flexibility to swap models is a strength. |

### Ghost: The Biggest Architectural Question

Ghost is the most expensive piece of complexity in the system:

- **Operational burden**: Separate Node.js service with its own DB, theme system, update cycle
- **Two one-shot fix functions** already built (`fix-ghost-dates`, `fix-ghost-source-styles`) to patch Ghost formatting
- **Image double-handling**: Downloaded to Supabase Storage, then re-downloaded and re-uploaded to Ghost during publish
- **Brittle content parsing**: `publish-to-ghost` parses SUBHEAD/BYLINE/SOURCE markers from LLM output into `kg-card` HTML — a prompt change breaks publishing
- **JWT hand-rolling**: HMAC-SHA256 token generation maintained manually in edge function code

**Recommendation**: Ghost works today. Keep it. But when you're ready for a V2 public site, replace it with a Next.js or Astro static site rendering directly from your `stories` table in Supabase. Your stories are already in Postgres — Ghost is just a rendering layer you're paying complexity tax on.

**Near-term mitigation**: Have the LLM output structured JSON (title, subhead, byline, source_name, source_url, body_paragraphs[]) instead of freeform markdown. Parse once at story creation, store structured data, and the Ghost publish function becomes a simple template renderer.

---

## 2. Architecture Improvements

### P0 — Do Now (Critical Reliability)

#### P0.1: Queue Recovery Watchdog
The fire-and-forget HTTP chain in `process-journalism-queue-item` can leave items stuck in `processing` forever if an edge function crashes mid-chain.

- New edge function: `recover-stuck-queue-items` on 15-min pg_cron
- Finds items with `status = 'processing'` and `started_at > 10 minutes ago`
- Resets to `pending`, increments retry count, re-triggers processing
- After 3 retries → mark `failed`
- Add `retry_count INTEGER DEFAULT 0` column to `journalism_queue`

#### P0.2: Shared Utilities Module
Every edge function duplicates CORS headers, Supabase client init, error handling, and cron logging. Create `supabase/functions/_shared/`:
- `cors.ts` — CORS headers constant
- `supabase-client.ts` — authenticated client factory
- `ghost-token.ts` — JWT generation (duplicated in `publish-to-ghost` and `fix-ghost-source-styles`)
- `cron-logger.ts` — `logCronJob` utility (duplicated in 3 scheduled functions)
- `llm-client.ts` — OpenRouter API call wrapper with retry logic


#### P0.4: Structured LLM Output
The current headline extraction (`lines[0].replace(/^#+\s*/, "").replace(/^HEADLINE:\s*/i, "")`) is fragile. Switch to structured JSON output from the LLM:

```json
{
  "headline": "...",
  "subhead": "...",
  "byline": "Woodstock Community News Staff",
  "source_name": "...",
  "source_url": "...",
  "body": ["paragraph 1", "paragraph 2", "..."],
  "skip": false,
  "skip_reason": null
}
```

This eliminates brittle parsing in both `process-journalism-queue-item` and `publish-to-ghost`.


### P1 — Do Next (Architecture Quality)


#### P1.2: Story Clustering / Deduplication
Same town meeting reported by 3 sources = 3 separate stories today. Fix this:

**Option A (LLM-based):** New `cluster-artifacts` step before journalism. Send artifact titles/summaries to LLM, get back topic groups. Generate one multi-sourced story per cluster.

**Option B (Embeddings-based, recommended):** Use pgvector in Supabase. Store title embeddings, cluster artifacts with cosine similarity > 0.85. No extra LLM call needed.

New table:
```sql
CREATE TABLE artifact_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_label TEXT,
  artifact_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE artifacts ADD COLUMN cluster_id UUID REFERENCES artifact_clusters(id);
```

Modified journalism pipeline: one story per cluster, prompt receives ALL artifacts in cluster for multi-source reporting.

#### P1.3: Multi-Stage Editorial Pipeline
The AI editor only does pass/reject (`max_tokens: 200`, `temperature: 0.2` — it's a classifier, not an editor). Expand to three stages:

1. **Fact Check** (new): Reviews story against source artifacts. Flags claims not verifiable from source material.
2. **Edit** (new): Takes story + fact-check feedback. Rewrites weak sections, improves headlines, tightens prose. Full generation call (`max_tokens: 5000`, `temperature: 0.4`).
3. **Gate** (current editor, refactored): Final PUBLISH/REJECT decision on the edited version.

Story status flow: `pending` → `fact_checked` → `edited` → `published`/`rejected`

#### P1.4: Testing
Zero tests today. Add Vitest (native Vite test runner):

Priority test targets:
- Pure functions in `fetch-rss-feeds`: `cleanText`, `parseRSSFeed`, `extractTag`, `extractAllImages`, `normalizeToUUID`, `parseDate`
- Content parsing in `publish-to-ghost`: SUBHEAD/BYLINE/SOURCE extraction (most fragile code)
- Edge function integration tests using `supabase start` (local Postgres)

Skip React component tests for now — focus on the data pipeline.

#### P1.5: CI/CD
Create `.github/workflows/ci.yml`:
- On PR: `npm install` → `npm run build` → `npm run lint` → `npm run test`
- On merge to main: Deploy to Vercel + `supabase db push` (if migrations changed) + `supabase functions deploy` (if functions changed)

#### P1.6: Monitoring & Alerting
`cron_job_logs` records failures but nobody reads them proactively.

- New `send-alert` edge function using Resend/Postmark for email alerts on pipeline failures
- Database webhook on `cron_job_logs` INSERT where `error_message IS NOT NULL`
- Dashboard "System Health" widget: last successful run per stage, stuck items count, Ghost connectivity

### P2 — Do When Expanding

- **TypeScript strict mode**: Enable incrementally (`noUnusedLocals` → `noImplicitAny` → `strictNullChecks`)
- **Remove Lovable artifacts**: Delete `lovable-tagger` from `package.json` and `vite.config.ts`
- **Remove dead code**: Commented-out `ghost-api.ts` implementation, one-shot fix functions
- **Story quality metrics**: Word count, reading level, source count, headline score — computed at creation, used by editor
- **AI generation metadata**: Model used, prompt version, confidence score — stored on stories for transparency

---

