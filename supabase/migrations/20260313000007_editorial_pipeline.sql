-- Add new story statuses for multi-stage editorial pipeline
-- Flow: pending → fact_checked → edited → published/rejected

-- Add fact_check_notes column to stories
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS fact_check_notes TEXT;

-- Update the status check constraint to include new statuses
-- First drop existing constraint if it exists, then add the new one
DO $$
BEGIN
  -- Try to drop existing constraint (may not exist or have different name)
  BEGIN
    ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_status_check;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore if constraint doesn't exist
  END;

  -- Add new constraint with all statuses
  ALTER TABLE stories ADD CONSTRAINT stories_status_check
    CHECK (status IN ('pending', 'fact_checked', 'edited', 'draft', 'published', 'archived', 'rejected'));
END $$;

COMMENT ON COLUMN stories.fact_check_notes IS 'Notes from AI fact-checker about claims that could not be verified from source material';
