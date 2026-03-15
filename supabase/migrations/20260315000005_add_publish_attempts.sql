-- Add publish_attempts counter to stories for retry limiting
-- When publish-to-ghost fails, the counter increments. After 3 failures,
-- the story is excluded from future editor runs until manually reset.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS publish_attempts INTEGER DEFAULT 0;
