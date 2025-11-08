-- Add new fields to prompt_versions table for better prompt management
ALTER TABLE prompt_versions 
ADD COLUMN IF NOT EXISTS prompt_type text NOT NULL DEFAULT 'retrieval',
ADD COLUMN IF NOT EXISTS is_test_draft boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS update_notes text,
ADD COLUMN IF NOT EXISTS based_on_version_id uuid REFERENCES prompt_versions(id),
ADD COLUMN IF NOT EXISTS test_status text DEFAULT 'not_tested',
ADD COLUMN IF NOT EXISTS test_results jsonb,
ADD COLUMN IF NOT EXISTS author text DEFAULT 'System';

-- Add check constraint for prompt_type
ALTER TABLE prompt_versions 
ADD CONSTRAINT prompt_type_check 
CHECK (prompt_type IN ('retrieval', 'journalism'));

-- Add check constraint for test_status
ALTER TABLE prompt_versions 
ADD CONSTRAINT test_status_check 
CHECK (test_status IN ('not_tested', 'tested', 'ready_to_activate'));

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_prompt_versions_type_active 
ON prompt_versions(prompt_type, is_active);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_test_draft 
ON prompt_versions(is_test_draft);

-- Insert sample active prompts if none exist
INSERT INTO prompt_versions (version_name, content, is_active, prompt_type, author, update_notes)
SELECT 'Retrieval v1.0', 'Default retrieval prompt for fetching and organizing source content.', true, 'retrieval', 'System', 'Initial active version'
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions WHERE prompt_type = 'retrieval' AND is_active = true
);

INSERT INTO prompt_versions (version_name, content, is_active, prompt_type, author, update_notes)
SELECT 'Journalism v1.0', 'Default journalism prompt for generating news stories from artifacts.', true, 'journalism', 'System', 'Initial active version'
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions WHERE prompt_type = 'journalism' AND is_active = true
);