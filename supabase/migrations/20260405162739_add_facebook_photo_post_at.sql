-- Track whether a story has been posted to Facebook using the new
-- photo+link-in-comment format (vs. the old link-preview /feed format).
-- Used by bulk-repost-facebook to identify which stories still need to
-- be reposted and by publish-to-facebook to flag freshly-published
-- photo posts.
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS facebook_photo_post_at TIMESTAMPTZ;

COMMENT ON COLUMN stories.facebook_photo_post_at IS
  'Set when the story has been posted to Facebook using the photo+link-in-comment format. NULL = never posted in that format (either no FB post, or posted in legacy link-preview format).';
