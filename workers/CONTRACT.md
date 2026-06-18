# WCN Workers port contract (implementation spec)

You are porting one Supabase Deno edge function to a Cloudflare Workers module. Follow this contract
EXACTLY so all modules cohere and type-check together. Read your source file(s) under
`supabase/functions/` and preserve behavior; only change what the platform requires.

## Hard rules
- **Do NOT edit** `src/index.ts`, `wrangler.jsonc`, `package.json`, `src/env.ts`, `src/_shared/types.ts`,
  or this file. Write ONLY your assigned target file. The orchestrator wires routes/cron/queue afterward.
- No Deno APIs (`Deno.*`), no `esm.sh`/`npm:` URL imports. Import npm packages normally
  (`linkedom`, `@mozilla/readability`, `fast-xml-parser`, `unpdf`, `hono`, `jose`) and shared modules by relative path.
- TypeScript strict mode; `npx tsc --noEmit` must pass. Import `Env` from `../env`, row types from `../_shared/types`.

## Data layer (`../_shared/db`)
`all<T>(env,sql,...p)`, `first<T>(env,sql,...p)`, `run(env,sql,...p)`, `insert<T>(env,table,row)`,
`encodeValue(v)`, `toJson(v)`, `fromJson<T>(text,fallback)`. SQLite `?` placeholders.
- Rows come back **snake_case** (see `types.ts`). Booleans are INTEGER 0/1. Timestamps ISO-8601 TEXT.
- JSON columns (`images`, `embedding`, `title_embedding`, `structured_metadata`, `generation_metadata`,
  `parser_config`, `source_ids`, `scheduled_times`, `app_settings.value`, `test_results`) are TEXT —
  decode with `fromJson`, encode with `toJson`/`encodeValue` (the `insert` helper already JSON-encodes objects).
- SQLite dialect: `datetime('now')` returns **UTC**; `RETURNING *` works; no `now()`, `::casts`, arrays, or jsonb ops.
  Set `updated_at`/`content_updated_at` in code. Generate ids with `crypto.randomUUID()`.
- No RLS, no pgvector. Similarity = **in-worker cosine** over rows whose `embedding` is decoded from TEXT JSON.

## Shared helpers (import; do not reimplement)
- `../_shared/llm-client`: `callLLM({prompt,modelConfig,keys:{openRouterApiKey,lovableApiKey,refererUrl},maxTokens?,temperature?})`,
  `generateEmbedding(text, env.OPENROUTER_API_KEY)`. `prompt` may be a string OR a multimodal array
  `[{type:'text',text}, {type:'image_url',image_url:{url}}]`. Read `modelConfig` from `app_settings` key `ai_model_config`.
- `../_shared/r2`: `putObject(env,key,body,contentType)→publicUrl`, `getObject`, `deleteObject`, `publicUrl(env,key)`.
- `../_shared/schedule-gate`: `checkScheduleGate(env, scheduleType, jobName, {force?,startTime}) → {passed,reason,schedule,currentTimeET}`.
- `../_shared/cron-logger`: `logCronJob(env, {job_name, schedule_check_passed, ...})`.
- `../_shared/alert`: `sendEmail(env,{subject,html,to?})`. `../_shared/text-cleanup`: `stripEmDashes(text)`.
- `../_shared/auth`: `verifyAccess(req,env)→identity|null`. `../_shared/cors`: `corsHeaders`.
- **New shared helpers written this round (import by these signatures):**
  - `../_shared/readability`: `fetchPageHTML(url,timeoutMs?)`, `extractWithReadability(html)→{success,title,content,textContent,charCount,error?}`,
    `extractImages(html,baseUrl)→{url,alt}[]`, `extractImagesFromMeta(rawHtml,baseUrl)→{url,alt}[]`,
    `extractVideos(html)→{type,url}[]`, `extractLinks(html,baseUrl,selector)→{url,text}[]`.
  - `../_shared/ghost-token`: `generateGhostToken(adminApiKey)→Promise<string>` (JWT via jose/Web Crypto).
  - `../_shared/pdf`: `extractPdfText(url)→Promise<string>` (fetch w/ redirect, ≤10MB, `unpdf` extractText, ≤20k chars; throw on <50 chars).

## Platform corrections (IMPORTANT — design notes were partly stale)
- **Images live on R2**, referenced as relative `/images/<key>` paths (NOT Supabase Storage URLs). The old
  "only include `supabase.co/storage` images" filters become "include images whose `stored_url` starts with
  `/images/` and `!download_failed`". For **LLM vision** calls, convert to absolute:
  `new URL(storedUrl, env.PUBLIC_SITE_URL).toString()` (vision needs absolute HTTPS).
- **Revalidation / site links** use `env.PUBLIC_SITE_URL` as the base (NOT a hardcoded vercel URL). The site's
  `/api/revalidate?secret=<REVALIDATION_SECRET>` is implemented later (Phase 5) — keep the call, fire-and-forget, non-fatal.
- **Ghost** is optional: guard on `env.GHOST_API_URL` + `env.GHOST_ADMIN_API_KEY`; no-op with a clear return if unset.
- `setTimeout`/`AbortController` work in workerd. Facebook Graph `v21.0`, hashtag logic, photo-vs-link logic: preserve exactly.

## Cross-module calls (import the named export; signatures fixed below)
- `publish-story.ts` `publishStory(env,storyId,featured?)` → imports `publishToFacebook` from `publish-to-facebook.ts`.
- `editorial-pipeline.ts` `runEditor` → imports `publishStory` from `publish-story.ts`.
- `journalism-queue.ts` exports `processJournalismQueueItem(env,queueItemId)`, `createJournalismQueue(env,historyId,dateFrom,dateTo,artifactIds?)`, `updateHistoryProgress(env,historyId)`, and `parseStructuredResponse(text)` (export it; reused by story-regeneration).
- Cron handlers + Queue consumer + route mounting are added by the orchestrator — just export the functions.

## Module assignments (target file ← source ; exported signature)
1. `src/_shared/readability.ts` ← `supabase/functions/_shared/readability.ts` (signatures above).
2. `src/_shared/ghost-token.ts` ← `supabase/functions/_shared/ghost-token.ts` (`generateGhostToken`).
3. `src/_shared/pdf.ts` ← new, replacing `_shared/pdf-extract.ts` using `unpdf` (`extractPdfText`).
4. `src/pipeline/manage-schedule.ts` ← `manage-schedule` : `manageSchedule(env,{scheduleType,scheduledTimes,isEnabled})`.
5. `src/pipeline/fetch-openrouter-models.ts` ← `fetch-openrouter-models` : `fetchOpenRouterModels(env.OPENROUTER_API_KEY)`.
6. `src/pipeline/test-readability.ts` ← `test-readability` : `testReadability(env,{url,link_selector?})`.
7. `src/pipeline/fetch-rss.ts` ← `fetch-rss-feeds` : `fetchRssFeeds(env,{dateFrom,dateTo,sourceIds,environment,queryHistoryId})`.
8. `src/pipeline/fetch-web-pages.ts` ← `fetch-web-pages` : `fetchWebPages(env,{sourceIds,environment,queryHistoryId})`.
9. `src/pipeline/fetch-artifacts.ts` ← `scheduled-fetch-artifacts` : `fetchArtifacts(env,{force?})` (orchestrates 7+8 in parallel, schedule-gates, writes query_history + cron log).
10. `src/pipeline/cluster-artifacts.ts` ← `cluster-artifacts` : `clusterArtifacts(env,{force?,startTime?})` + `cosineSimilarity(a,b)`.
11. `src/pipeline/backfill-artifact-images.ts` ← `backfill-artifact-images` : `backfillArtifactImages(env,sourceId?)`.
12. `src/pipeline/backfill-story-images.ts` ← `backfill-story-images` : `backfillStoryImages(env,mode?)`.
13. `src/pipeline/journalism-queue.ts` ← `process-journalism-queue-item`+`run-ai-journalist` : exports listed in Cross-module above.
14. `src/pipeline/editorial-pipeline.ts` ← `run-ai-fact-checker`+`run-ai-rewriter`+`run-ai-editor` : `runFactChecker(env,o?)`,`runRewriter(env,o?)`,`runEditor(env,o?)`,`runEditorialPipeline(env)`.
15. `src/pipeline/story-regeneration.ts` ← `regenerate-stories` : `regenerateStories(env,{maxStories?})`.
16. `src/pipeline/queue-recovery.ts` ← `recover-stuck-queue-items` : `recoverStuckQueueItems(env,{stuckThresholdMinutes?,maxRetries?})`.
17. `src/pipeline/council.ts` ← `scrape-council-meetings`+`generate-council-story` : `scrapeMeetings(env)`, `generateCouncilStory(env,meetingId,storyType)`.
18. `src/pipeline/publish-story.ts` ← `publish-story` : `publishStory(env,storyId,featured?)`.
19. `src/pipeline/publish-to-facebook.ts` ← `publish-to-facebook` : `publishToFacebook(env,{storyId,ghostUrl,title,excerpt?,heroImageUrl?})`.
20. `src/pipeline/bulk-repost-facebook.ts` ← `bulk-repost-facebook` : `bulkRepostFacebook(env,opts?)`.
21. `src/pipeline/publish-about-page.ts` ← `publish-about-page` : `publishAboutPage(env)`.
22. `src/pipeline/trigger-revalidate.ts` ← `trigger-revalidate` : `triggerRevalidate(env,paths)`.
