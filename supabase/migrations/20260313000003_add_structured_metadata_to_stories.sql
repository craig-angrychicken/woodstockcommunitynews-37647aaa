-- Add structured_metadata JSONB column to stories for structured LLM output
-- Stores: subhead, byline, source_name, source_url parsed from JSON LLM response
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS structured_metadata JSONB;

COMMENT ON COLUMN stories.structured_metadata IS 'Structured fields from LLM output: {subhead, byline, source_name, source_url}';
