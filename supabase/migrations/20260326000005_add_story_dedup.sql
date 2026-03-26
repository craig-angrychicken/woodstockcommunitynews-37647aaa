-- Add title embedding to stories for dedup similarity search
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS title_embedding vector(384);

-- IVFFlat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_stories_title_embedding
  ON stories USING ivfflat (title_embedding vector_cosine_ops)
  WITH (lists = 50);

-- RPC: find published/pending stories similar to a given title embedding
CREATE OR REPLACE FUNCTION match_stories_by_embedding(
  query_embedding vector(384),
  similarity_threshold float,
  match_count int
)
RETURNS TABLE(id uuid, title text, status text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.title, s.status,
         (1 - (s.title_embedding <=> query_embedding))::float AS similarity
  FROM stories s
  WHERE s.title_embedding IS NOT NULL
    AND s.environment = 'production'
    AND 1 - (s.title_embedding <=> query_embedding) > similarity_threshold
  ORDER BY s.title_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RPC: find similar artifacts that have hero images (for image fallback)
CREATE OR REPLACE FUNCTION match_artifacts_with_images(
  query_embedding vector(384),
  similarity_threshold float,
  match_count int
)
RETURNS TABLE(id uuid, hero_image_url text, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.hero_image_url,
         (1 - (a.embedding <=> query_embedding))::float AS similarity
  FROM artifacts a
  WHERE a.embedding IS NOT NULL
    AND a.hero_image_url IS NOT NULL
    AND 1 - (a.embedding <=> query_embedding) > similarity_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
