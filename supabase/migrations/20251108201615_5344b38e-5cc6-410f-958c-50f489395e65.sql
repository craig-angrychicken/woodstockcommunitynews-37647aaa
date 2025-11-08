-- Add is_test flag to artifacts table if it doesn't exist
ALTER TABLE artifacts 
ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- Create index for better query performance on test data
CREATE INDEX IF NOT EXISTS idx_artifacts_is_test ON artifacts(is_test);
CREATE INDEX IF NOT EXISTS idx_stories_is_test ON stories(is_test);

-- Add function to get stories using an artifact
CREATE OR REPLACE FUNCTION get_artifact_story_count(artifact_guid uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::integer
  FROM story_artifacts
  WHERE artifact_id = artifact_guid;
$$;