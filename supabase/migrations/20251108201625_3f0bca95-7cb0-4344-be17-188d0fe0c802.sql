-- Fix function search path security issue
DROP FUNCTION IF EXISTS get_artifact_story_count(uuid);

CREATE OR REPLACE FUNCTION get_artifact_story_count(artifact_guid uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM story_artifacts
  WHERE artifact_id = artifact_guid;
$$;