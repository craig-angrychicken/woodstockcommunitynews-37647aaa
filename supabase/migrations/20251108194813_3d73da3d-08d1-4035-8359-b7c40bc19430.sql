-- Add new columns to stories table
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT false;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS environment TEXT DEFAULT 'production' CHECK (environment IN ('production', 'test'));
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS article_type TEXT DEFAULT 'full' CHECK (article_type IN ('brief', 'full'));
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS prompt_version_id TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS guid UUID DEFAULT gen_random_uuid();
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES public.sources(id);

-- Update status check constraint to include 'rejected'
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_status_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_status_check 
  CHECK (status IN ('pending', 'published', 'draft', 'archived', 'rejected'));

-- Create story_artifacts junction table
CREATE TABLE IF NOT EXISTS public.story_artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  story_id UUID NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(story_id, artifact_id)
);

-- Enable RLS on story_artifacts
ALTER TABLE public.story_artifacts ENABLE ROW LEVEL SECURITY;

-- Create policies for story_artifacts
CREATE POLICY "Allow public read access to story_artifacts"
  ON public.story_artifacts
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to story_artifacts"
  ON public.story_artifacts
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public delete from story_artifacts"
  ON public.story_artifacts
  FOR DELETE
  USING (true);

-- Add title and content fields to artifacts
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS content TEXT;
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS guid UUID DEFAULT gen_random_uuid();
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES public.sources(id);
ALTER TABLE public.artifacts ADD COLUMN IF NOT EXISTS date TIMESTAMP WITH TIME ZONE DEFAULT now();