-- Add hero_image_url column to stories table
ALTER TABLE public.stories 
ADD COLUMN hero_image_url TEXT;

-- Add index for better query performance
CREATE INDEX idx_stories_hero_image_url ON public.stories(hero_image_url) WHERE hero_image_url IS NOT NULL;