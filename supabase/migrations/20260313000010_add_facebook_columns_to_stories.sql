ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS facebook_post_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_post_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_posted_at TIMESTAMPTZ;
