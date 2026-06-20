# Admin API spec — endpoints the SPA hooks need

Conventions: Hono sub-routers under /api/admin (parent applies Cloudflare Access gate — do NOT re-gate).
Use ../../_shared/db helpers (all/first/run/insert/encodeValue/toJson/fromJson), snake_case cols, ? params,
datetime('now') for timestamps, crypto.randomUUID() for ids. Return c.json(...). JSON cols (parser_config,
structured_metadata, images, scheduled_times, value, test_results) are TEXT — fromJson on read where the SPA expects objects.

## Endpoints

### GET /api/admin/sources
- table: sources (select)
- sql: `SELECT * FROM sources WHERE status = ? ORDER BY name`
- request: { status: 'active' | 'testing' | 'all' }
- usedBy: useActiveSources, useTestSources, useAllSources (queryKey: ['sources', 'active/testing/all'])

### GET /api/admin/sources/:id
- table: sources (select)
- sql: `SELECT * FROM sources WHERE id = ?`
- request: { id: string }
- usedBy: useSource (queryKey: ['sources', sourceId])

### GET /api/admin/sources/type/:type
- table: sources (select)
- sql: `SELECT * FROM sources WHERE type = ? ORDER BY name`
- request: { type: string }
- usedBy: useSourcesByType (queryKey: ['sources', 'type', type])

### POST /api/admin/sources
- table: sources (insert)
- sql: `INSERT INTO sources (name, url, type, status, items_fetched, parser_config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
- request: { name: string; url: string; type: 'RSS Feed' | 'Web Page'; status: 'testing'; items_fetched: 0; parser_config: Record<string, unknown> }
- usedBy: AddSourceForm (onSuccess invalidates ['sources'])

### PATCH /api/admin/sources/:id
- table: sources (update)
- sql: `UPDATE sources SET name = ?, url = ?, updated_at = ? WHERE id = ?`
- request: { id: string; name: string; url: string | null }
- usedBy: EditSourceModal (onSuccess invalidates ['sources'])

### PATCH /api/admin/sources/:id/status
- table: sources (update)
- sql: `UPDATE sources SET status = ?, updated_at = ? WHERE id = ?`
- request: { id: string; status: string }
- usedBy: Sources.tsx updateStatusMutation (onSuccess invalidates ['sources'])

### DELETE /api/admin/sources/:id
- table: sources (delete)
- sql: `DELETE FROM sources WHERE id = ?`
- request: { id: string }
- usedBy: Sources.tsx deleteMutation (onSuccess invalidates ['sources'])

### GET /api/admin/stories
- table: stories (select)
- sql: `SELECT stories.*, sources.name, sources.type FROM stories LEFT JOIN sources ON stories.source_id = sources.id ORDER BY stories.created_at DESC`
- request: { environment?: 'production' | 'test' | 'all'; status?: string; sourceId?: string; dateFrom?: string; dateTo?: string; searchQuery?: string }
- usedBy: useStories (queryKey: ['stories', filters])

### GET /api/admin/stories/:id
- table: stories (select)
- sql: `SELECT stories.*, sources.name, sources.type FROM stories LEFT JOIN sources ON stories.source_id = sources.id WHERE stories.id = ?`
- request: { id: string }
- usedBy: useStory (queryKey: ['stories', storyId])

### DELETE /api/admin/stories/:id
- table: stories (delete)
- sql: `DELETE FROM stories WHERE id = ?`
- request: { id: string }
- usedBy: Stories.tsx deleteStoryMutation (onSuccess invalidates ['stories'])

### GET /api/admin/artifacts
- table: artifacts (select)
- sql: `SELECT artifacts.*, sources.name, sources.type FROM artifacts LEFT JOIN sources ON artifacts.source_id = sources.id ORDER BY artifacts.date DESC`
- request: { sourceId?: string; dateFrom?: string; dateTo?: string; searchQuery?: string; usageStatus?: 'all' | 'used' | 'unused' }
- usedBy: useArtifacts (queryKey: ['artifacts', filters])

### GET /api/admin/artifacts/:id
- table: artifacts (select)
- sql: `SELECT artifacts.*, sources.name, sources.type FROM artifacts LEFT JOIN sources ON artifacts.source_id = sources.id WHERE artifacts.id = ?`
- request: { id: string }
- usedBy: useArtifact (queryKey: ['artifacts', artifactId])

### DELETE /api/admin/artifacts/:id
- table: artifacts (delete)
- sql: `DELETE FROM artifacts WHERE id = ?`
- request: { id: string }
- usedBy: Artifacts.tsx deleteArtifactMutation (onSuccess invalidates ['artifacts', 'all-story-artifacts'])

### GET /api/admin/query-history
- table: query_history (select)
- sql: `SELECT * FROM query_history WHERE (environment = ? OR ? = 'all') AND (status = ? OR ? IS NULL) AND (created_at >= ? OR ? IS NULL) AND (created_at <= ? OR ? IS NULL) ORDER BY created_at DESC`
- request: { environment?: 'production' | 'test' | 'all'; status?: 'running' | 'completed' | 'failed'; dateFrom?: string; dateTo?: string }
- usedBy: useQueryHistory (queryKey: ['query-history', filters])

### GET /api/admin/query-history/:id
- table: query_history (select)
- sql: `SELECT * FROM query_history WHERE id = ?`
- request: { id: string }
- usedBy: useQueryRun (queryKey: ['query-history', queryId])

### GET /api/admin/query-history/recent
- table: query_history (select)
- sql: `SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?`
- request: { limit?: number }
- usedBy: useRecentQueryHistory (queryKey: ['query-history', 'recent', limit])

### GET /api/admin/journalism-queue
- table: journalism_queue (select)
- sql: `SELECT journalism_queue.*, artifacts.title, artifacts.name FROM journalism_queue LEFT JOIN artifacts ON journalism_queue.artifact_id = artifacts.id WHERE journalism_queue.query_history_id = ? ORDER BY journalism_queue.position ASC`
- request: { historyId: string }
- usedBy: QueueProcessor (realtime subscribe + polling)

### GET /api/admin/prompt-versions
- table: prompt_versions (select)
- sql: `SELECT * FROM prompt_versions WHERE is_active = ? AND is_test_draft = ? ORDER BY prompt_type`
- request: { activeOnly?: boolean; excludeTestDrafts?: boolean }
- usedBy: useActivePrompts (queryKey: ['prompts', 'active'])

### GET /api/admin/prompt-versions/drafts
- table: prompt_versions (select)
- sql: `SELECT * FROM prompt_versions WHERE is_test_draft = ? ORDER BY created_at DESC`
- request: { testDraftsOnly: boolean }
- usedBy: useTestDrafts (queryKey: ['prompts', 'test-drafts'])

### GET /api/admin/prompt-versions/history
- table: prompt_versions (select)
- sql: `SELECT * FROM prompt_versions WHERE is_test_draft = ? ORDER BY created_at DESC`
- request: {}
- usedBy: usePromptHistory (queryKey: ['prompts', 'history'])

### GET /api/admin/prompt-versions/:id
- table: prompt_versions (select)
- sql: `SELECT * FROM prompt_versions WHERE id = ?`
- request: { id: string }
- usedBy: usePromptVersion (queryKey: ['prompts', promptId])

### POST /api/admin/prompt-versions
- table: prompt_versions (insert)
- sql: `INSERT INTO prompt_versions (version_name, content, prompt_type, is_active, is_test_draft, update_notes, test_status, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
- request: { version_name: string; content: string; prompt_type: string; is_active?: boolean; is_test_draft?: boolean; update_notes?: string; test_status?: string; author?: string }
- usedBy: EditPromptModal (onSuccess invalidates ['prompts'])

### PATCH /api/admin/prompt-versions/:id
- table: prompt_versions (update)
- sql: `UPDATE prompt_versions SET content = ?, version_name = ?, update_notes = ?, updated_at = ? WHERE id = ?`
- request: { id: string; content: string; version_name: string; update_notes: string }
- usedBy: EditPromptModal (onSuccess invalidates ['prompts'])

### PATCH /api/admin/prompt-versions/:id/activate
- table: prompt_versions (update)
- sql: `UPDATE prompt_versions SET is_active = ? WHERE prompt_type = ?; UPDATE prompt_versions SET is_active = ?, is_test_draft = ? WHERE id = ?`
- request: { id: string; promptType: string }
- usedBy: ActivatePromptModal, Prompts.tsx makeActiveMutation (onSuccess invalidates ['prompts'])

### DELETE /api/admin/prompt-versions/:id
- table: prompt_versions (delete)
- sql: `DELETE FROM prompt_versions WHERE id = ?`
- request: { id: string }
- usedBy: Prompts.tsx deleteMutation (onSuccess invalidates ['prompts'])

### GET /api/admin/schedules/:type
- table: schedules (select)
- sql: `SELECT * FROM schedules WHERE schedule_type = ?`
- request: { type: 'artifact_fetch' | 'ai_journalism' | 'ai_editor' }
- usedBy: useSchedule (queryKey: ['schedule', scheduleType])

### POST /api/admin/schedules
- table: schedules (upsert)
- sql: `INSERT INTO schedules (schedule_type, scheduled_times, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (schedule_type) DO UPDATE SET scheduled_times = ?, is_enabled = ?, updated_at = ?`
- request: { scheduleType: 'artifact_fetch' | 'ai_journalism' | 'ai_editor'; scheduledTimes: string[]; isEnabled: boolean }
- usedBy: useSaveSchedule (calls manage-schedule function, invalidates ['schedule', scheduleType])

### GET /api/admin/cron-job-logs
- table: cron_job_logs (select)
- sql: `SELECT * FROM cron_job_logs ORDER BY triggered_at DESC LIMIT ?`
- request: { limit?: number }
- usedBy: useCronJobLogs (queryKey: ['cron-job-logs', limit])

### GET /api/admin/cron-job-logs/:jobName
- table: cron_job_logs (select)
- sql: `SELECT * FROM cron_job_logs WHERE job_name = ? ORDER BY triggered_at DESC LIMIT ?`
- request: { jobName: string; limit?: number }
- usedBy: useCronJobLogsByName (queryKey: ['cron-job-logs', jobName, limit])

### GET /api/admin/cron-job-logs/stats
- table: cron_job_logs (select)
- sql: `SELECT * FROM cron_job_logs WHERE triggered_at >= ? AND triggered_at <= datetime('now', '+24 hours')`
- request: {}
- usedBy: useCronJobStats (queryKey: ['cron-job-stats'])

### GET /api/admin/skipped-artifacts
- table: journalism_queue (select)
- sql: `SELECT journalism_queue.error_message, journalism_queue.completed_at, artifacts.title, artifacts.url FROM journalism_queue LEFT JOIN artifacts ON journalism_queue.artifact_id = artifacts.id WHERE journalism_queue.status = ? AND journalism_queue.completed_at >= ? ORDER BY journalism_queue.completed_at DESC`
- request: { days?: number }
- usedBy: useSkippedArtifacts (queryKey: ['skipped-artifacts', days])

### GET /api/admin/rejected-stories
- table: stories (select)
- sql: `SELECT title, editor_notes, updated_at FROM stories WHERE status = ? AND is_test = ? AND environment = ? AND updated_at >= ? ORDER BY updated_at DESC`
- request: { days?: number }
- usedBy: useRejectedStories (queryKey: ['rejected-stories', days])

### GET /api/admin/skip-reject-counts
- table: journalism_queue,stories (select)
- sql: `SELECT COUNT(journalism_queue.id) as skipped_count, COUNT(stories.id) as rejected_count FROM journalism_queue, stories WHERE journalism_queue.status = ? AND journalism_queue.completed_at >= ? AND stories.status = ? AND stories.is_test = ? AND stories.environment = ? AND stories.updated_at >= ?`
- request: {}
- usedBy: useSkipRejectCounts (queryKey: ['skip-reject-counts'])

### GET /api/admin/story-artifacts/:storyId
- table: story_artifacts (select)
- sql: `SELECT story_artifacts.*, stories.id, stories.title FROM story_artifacts LEFT JOIN stories ON story_artifacts.story_id = stories.id WHERE story_artifacts.artifact_id = ?`
- request: { artifactId: string }
- usedBy: Artifacts.tsx artifactStories (queryKey: ['artifact-stories', artifactId])

### GET /api/admin/story-artifacts/count
- table: story_artifacts (select)
- sql: `SELECT artifact_id, story_id FROM story_artifacts`
- request: {}
- usedBy: AIJournalist.tsx availableArtifacts query (queryKey: ['available-artifacts', ...])

### GET /api/admin/app-settings/:key
- table: app_settings (select)
- sql: `SELECT value FROM app_settings WHERE key = ?`
- request: { key: string }
- usedBy: Models.tsx modelConfig (queryKey: ['ai-model-config'])

### POST /api/admin/app-settings
- table: app_settings (insert)
- sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)`
- request: { key: string; value: Record<string, unknown> }
- usedBy: Models.tsx updateModelMutation (onSuccess invalidates ['ai-model-config'])

### PATCH /api/admin/app-settings/:key
- table: app_settings (update)
- sql: `UPDATE app_settings SET value = ? WHERE key = ?`
- request: { key: string; value: Record<string, unknown> }
- usedBy: Models.tsx updateModelMutation (onSuccess invalidates ['ai-model-config'])

## Notes
- All SELECT queries support filtering via query parameters. Apply WHERE clauses based on provided filters (environment, status, dateFrom, dateTo, searchQuery, etc)
- Pagination not explicitly shown but should be supported via limit/offset query params for large result sets
- journalism_queue updates are delivered by polling GET /api/admin/journalism-queue (no realtime channel)
- QueueProcessor.tsx polls filtered by query_history_id — passed as a query param
- useStories applies client-side search filter with ilike on title/content/name fields — implement server-side in SQL WHERE (title ILIKE ? OR content ILIKE ? OR name ILIKE ?)
- useArtifacts filters by usageStatus client-side by checking story_artifacts length — implement server-side join and GROUP BY to count related stories
- useCronJobStats computes aggregations client-side (artifact_fetch/journalism/editor run counts, success/fail/skip rates) — implement aggregations server-side with conditional SUM/COUNT
- Prompt activation requires transaction: UPDATE all prompts of type to is_active=false, then UPDATE target to is_active=true — ensure atomicity in endpoint
- Source deletion must cascade: nullify source_id in stories table first, then delete source — implement as transaction
- Story deletion relationships: check story_artifacts, then delete story — implement cascade or pre-delete check
- QueryKey patterns establish cache invalidation: [table], [table, filters], [table, id] — use these for React Query key matching in polling/mutations
- ManualQuery.tsx triggers fetch-rss / fetch-web-pages — these are orchestration endpoints, not direct DB queries
- AIJournalist.tsx triggers the journalism run with historyId creation — maintains a query_history record, queries journalism_queue via polling
- Dashboard.tsx counts use COUNT(*) in SQL for performance
- Story joins artifacts via story_artifacts junction table — always LEFT JOIN to handle unused artifacts
- Artifact joins sources — LEFT JOIN to handle orphaned artifacts (source_id = null)
- All timestamps should use UTC (created_at, updated_at columns) — convert to EST in frontend if needed (formatUTCtoEST utility)
- schedule_enabled/scheduled_times are nullable in response but required for mutations — handle null defaults
- Prompt types: 'journalism', 'editor', others — filter by prompt_type in queries as needed
