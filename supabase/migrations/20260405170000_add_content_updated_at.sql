-- Add content_updated_at: tracks only material edits to a story's body.
--
-- `updated_at` is touched by any UPDATE (including bulk maintenance scripts),
-- so it cannot be used to show readers a meaningful "last updated" timestamp.
-- This column is only bumped when title, content, or structured_metadata
-- actually changes.

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

-- Seed the new column to published_at for existing stories, so the UI has
-- a baseline and we never show stories as "updated" retroactively from
-- the backfill itself.
UPDATE stories
SET content_updated_at = published_at
WHERE content_updated_at IS NULL
  AND published_at IS NOT NULL;

CREATE OR REPLACE FUNCTION bump_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.structured_metadata IS DISTINCT FROM OLD.structured_metadata
  ) THEN
    NEW.content_updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stories_bump_content_updated_at ON stories;
CREATE TRIGGER stories_bump_content_updated_at
BEFORE UPDATE ON stories
FOR EACH ROW
EXECUTE FUNCTION bump_content_updated_at();
