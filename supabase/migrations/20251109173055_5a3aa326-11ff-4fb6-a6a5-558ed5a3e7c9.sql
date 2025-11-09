-- Add ghost_url column to stories table to store the published Ghost post URL
ALTER TABLE stories ADD COLUMN ghost_url TEXT;