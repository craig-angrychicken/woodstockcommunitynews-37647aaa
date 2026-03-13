-- Enable pgvector extension for embeddings-based deduplication
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to artifacts for similarity search
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS embedding vector(384),
  ADD COLUMN IF NOT EXISTS cluster_id UUID;

-- Create artifact_clusters table to group similar artifacts
CREATE TABLE IF NOT EXISTS artifact_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  representative_title TEXT,
  artifact_count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key from artifacts to clusters
ALTER TABLE artifacts
  ADD CONSTRAINT fk_artifact_cluster
  FOREIGN KEY (cluster_id) REFERENCES artifact_clusters(id)
  ON DELETE SET NULL;

-- Index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_artifacts_embedding
  ON artifacts USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- Index for cluster lookups
CREATE INDEX IF NOT EXISTS idx_artifacts_cluster_id
  ON artifacts (cluster_id);

COMMENT ON TABLE artifact_clusters IS 'Groups of artifacts covering the same event/topic, identified by embedding similarity';
COMMENT ON COLUMN artifacts.embedding IS '384-dimensional embedding vector for title similarity search';
COMMENT ON COLUMN artifacts.cluster_id IS 'FK to artifact_clusters — artifacts in the same cluster cover the same event';
