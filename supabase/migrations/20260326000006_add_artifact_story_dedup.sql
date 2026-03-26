-- RPC: find artifacts behind published/pending stories that are similar to a given embedding.
-- Used by process-journalism-queue-item to prevent creating a story when a similar
-- artifact already produced one (catches cases where clustering missed near-threshold pairs
-- and the LLM generated different-enough titles to bypass story-title dedup).
CREATE OR REPLACE FUNCTION match_published_story_artifacts(
  query_embedding vector(384),
  similarity_threshold float,
  match_count int
)
RETURNS TABLE(artifact_id uuid, story_id uuid, story_title text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT a.id AS artifact_id,
         s.id AS story_id,
         s.title AS story_title,
         (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM story_artifacts sa
  JOIN artifacts a ON a.id = sa.artifact_id
  JOIN stories s ON s.id = sa.story_id
  WHERE a.embedding IS NOT NULL
    AND s.environment = 'production'
    AND s.status NOT IN ('rejected', 'archived')
    AND 1 - (a.embedding <=> query_embedding) > similarity_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
