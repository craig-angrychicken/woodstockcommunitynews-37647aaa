-- Drop the old constraint that was blocking new sources
ALTER TABLE sources DROP CONSTRAINT IF EXISTS sources_status_check;

-- Add the updated constraint with all status values the app uses
ALTER TABLE sources ADD CONSTRAINT sources_status_check 
CHECK (status IN ('active', 'testing', 'paused', 'error'));