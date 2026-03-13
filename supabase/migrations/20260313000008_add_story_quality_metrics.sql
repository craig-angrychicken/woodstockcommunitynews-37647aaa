-- Add quality metric columns to stories
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS word_count INTEGER,
  ADD COLUMN IF NOT EXISTS source_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS reading_level TEXT;

COMMENT ON COLUMN stories.word_count IS 'Word count of story content, computed at creation';
COMMENT ON COLUMN stories.source_count IS 'Number of source artifacts used to generate this story';
COMMENT ON COLUMN stories.reading_level IS 'Estimated reading level (e.g., "8th grade", "college")';
