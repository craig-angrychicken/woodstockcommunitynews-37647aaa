-- Create stories table
CREATE TABLE public.stories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'draft', 'archived')),
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create artifacts table
CREATE TABLE public.artifacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  size_mb DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sources table
CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'error')),
  last_fetch_at TIMESTAMP WITH TIME ZONE,
  items_fetched INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (for now, before auth is added)
CREATE POLICY "Allow public read access to stories"
  ON public.stories
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public read access to artifacts"
  ON public.artifacts
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public read access to sources"
  ON public.sources
  FOR SELECT
  USING (true);

-- Create policies for public write access (for now)
CREATE POLICY "Allow public insert to stories"
  ON public.stories
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to stories"
  ON public.stories
  FOR UPDATE
  USING (true);

CREATE POLICY "Allow public delete to stories"
  ON public.stories
  FOR DELETE
  USING (true);

CREATE POLICY "Allow public insert to artifacts"
  ON public.artifacts
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public insert to sources"
  ON public.sources
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to sources"
  ON public.sources
  FOR UPDATE
  USING (true);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_stories_updated_at
  BEFORE UPDATE ON public.stories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sources_updated_at
  BEFORE UPDATE ON public.sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();