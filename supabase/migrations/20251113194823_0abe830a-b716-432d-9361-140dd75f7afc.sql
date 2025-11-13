-- Add error_message column to query_history table
ALTER TABLE query_history 
ADD COLUMN IF NOT EXISTS error_message TEXT;