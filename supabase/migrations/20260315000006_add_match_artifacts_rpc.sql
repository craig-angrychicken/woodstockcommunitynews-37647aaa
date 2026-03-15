-- RPC function for cosine similarity search on artifact embeddings.
-- Used by cluster-artifacts to find semantically similar articles.
CREATE OR REPLACE FUNCTION match_artifacts_by_embedding(
  query_embedding vector(384),
  similarity_threshold float,
  match_count int
)
RETURNS TABLE(id uuid, title text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.title, (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM artifacts a
  WHERE a.embedding IS NOT NULL
    AND 1 - (a.embedding <=> query_embedding) > similarity_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
