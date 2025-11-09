-- Add images column to artifacts table to store array of image URLs
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;