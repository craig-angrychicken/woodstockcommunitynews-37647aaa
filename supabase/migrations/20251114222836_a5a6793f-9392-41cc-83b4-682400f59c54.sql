-- Add url column to artifacts table to store source URLs
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS url TEXT;

-- Add a comment for documentation
COMMENT ON COLUMN artifacts.url IS 'Source URL of the article or content';