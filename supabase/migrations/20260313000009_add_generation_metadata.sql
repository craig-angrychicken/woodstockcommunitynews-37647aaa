-- Add generation_metadata JSONB column to stories
-- Stores: model used, prompt version ID, token count, provider
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS generation_metadata JSONB;

COMMENT ON COLUMN stories.generation_metadata IS 'LLM generation details: {model, provider, prompt_tokens, completion_tokens, total_tokens}';
