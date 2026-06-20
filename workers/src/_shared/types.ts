/**
 * Canonical D1 row types — keys are snake_case to match the SQLite columns
 * returned by the D1 client (see workers/schema.sql). Booleans are INTEGER 0/1;
 * timestamps are ISO-8601 TEXT; JSON/array/embedding columns are TEXT (decode
 * with fromJson). All ported modules import these instead of redefining shapes.
 */

export interface SourceRow {
  id: string;
  name: string;
  url: string | null;
  type: "RSS Feed" | "Web Page";
  status: "active" | "testing" | "paused" | "error";
  last_fetch_at: string | null;
  items_fetched: number | null;
  created_at: string;
  updated_at: string;
  parser_config: string | null; // JSON
}

export interface ArtifactRow {
  id: string;
  name: string;
  type: string;
  size_mb: number;
  created_at: string;
  title: string | null;
  content: string | null;
  guid: string | null;
  source_id: string | null;
  date: string | null;
  is_test: number;
  images: string | null; // JSON StoredImage[]
  hero_image_url: string | null;
  url: string | null;
  embedding: string | null; // JSON number[] (384)
  cluster_id: string | null;
}

export interface StoryRow {
  id: string;
  title: string;
  content: string | null;
  status: "pending" | "fact_checked" | "edited" | "draft" | "published" | "archived" | "rejected";
  published_at: string | null;
  created_at: string;
  updated_at: string;
  is_test: number | null;
  environment: "production" | "test" | null;
  article_type: "brief" | "full" | null;
  prompt_version_id: string | null;
  guid: string | null;
  source_id: string | null;
  ghost_url: string | null;
  hero_image_url: string | null;
  editor_notes: string | null;
  featured: number;
  structured_metadata: string | null; // JSON { subhead?, byline?, source_name?, source_url? }
  fact_check_notes: string | null;
  word_count: number | null;
  source_count: number | null;
  reading_level: string | null;
  generation_metadata: string | null; // JSON
  facebook_post_id: string | null;
  facebook_post_url: string | null;
  facebook_posted_at: string | null;
  publish_attempts: number | null;
  title_embedding: string | null; // JSON number[] (384)
  slug: string | null;
  facebook_photo_post_at: string | null;
  content_updated_at: string | null;
  council_meeting_id: string | null;
  story_type: string | null;
}

export interface ArtifactClusterRow {
  id: string;
  representative_title: string | null;
  artifact_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface StoryArtifactRow {
  id: string;
  story_id: string;
  artifact_id: string;
  created_at: string;
}

export interface JournalismQueueRow {
  id: string;
  query_history_id: string;
  artifact_id: string;
  status: "pending" | "processing" | "completed" | "failed" | "skipped";
  position: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  story_id: string | null;
  error_message: string | null;
  retry_count: number | null;
}

export interface QueryHistoryRow {
  id: string;
  date_from: string;
  date_to: string;
  environment: "production" | "test";
  prompt_version_id: string | null;
  source_ids: string; // JSON string[]
  run_stages: "manual" | "automated";
  status: "running" | "completed" | "failed";
  artifacts_count: number | null;
  stories_count: number | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
  skipped_count: number | null;
  sources_total: number | null;
  sources_processed: number | null;
  sources_failed: number | null;
  current_source_id: string | null;
  current_source_name: string | null;
}

export interface PromptVersionRow {
  id: string;
  version_name: string;
  content: string;
  is_active: number | null;
  created_at: string;
  updated_at: string;
  prompt_type: "retrieval" | "journalism" | "editor";
  is_test_draft: number;
  update_notes: string | null;
  based_on_version_id: string | null;
  test_status: string | null;
  test_results: string | null; // JSON
  author: string | null;
}

export interface ScheduleRow {
  id: string;
  schedule_type: "artifact_fetch" | "ai_journalism" | "ai_editor" | "council_scraper";
  scheduled_times: string; // JSON string[]
  is_enabled: number | null;
  created_at: string | null;
  updated_at: string | null;
  active_hour_start: number | null;
  active_hour_end: number | null;
}

export interface AppSettingRow {
  id: string;
  key: string;
  value: string; // JSON
  created_at: string;
  updated_at: string;
}

export interface CouncilMeetingRow {
  id: string;
  granicus_clip_id: number | null;
  meeting_type: string;
  meeting_date: string;
  agenda_url: string | null;
  agenda_detected_at: string | null;
  packet_url: string | null;
  packet_detected_at: string | null;
  minutes_url: string | null;
  minutes_detected_at: string | null;
  agenda_content: string | null;
  packet_content: string | null;
  minutes_content: string | null;
  preview_story_id: string | null;
  update_story_id: string | null;
  recap_story_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  granicus_event_id: number | null;
}

/** An image stored in R2, recorded in artifacts.images (JSON). */
export interface StoredImage {
  original_url?: string;
  stored_url?: string; // now a /images/<key> path (R2-served)
  download_failed?: boolean;
  type?: "image" | "video";
  embed_type?: string;
}

/** app_settings.value for key='ai_model_config'. */
export interface LLMModelConfig {
  model_name: string;
  model_provider: string;
}
