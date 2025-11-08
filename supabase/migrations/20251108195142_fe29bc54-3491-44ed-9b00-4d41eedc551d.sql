-- Create prompt_versions table
CREATE TABLE IF NOT EXISTS public.prompt_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_name TEXT NOT NULL,
  content TEXT NOT NULL,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create query_history table
CREATE TABLE IF NOT EXISTS public.query_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date_from TIMESTAMP WITH TIME ZONE NOT NULL,
  date_to TIMESTAMP WITH TIME ZONE NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'test')),
  prompt_version_id UUID REFERENCES public.prompt_versions(id),
  source_ids UUID[] NOT NULL,
  run_stages TEXT NOT NULL CHECK (run_stages IN ('stage1', 'both')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  artifacts_count INTEGER DEFAULT 0,
  stories_count INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.query_history ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow public read access to prompt_versions"
  ON public.prompt_versions
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to prompt_versions"
  ON public.prompt_versions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to prompt_versions"
  ON public.prompt_versions
  FOR UPDATE
  USING (true);

CREATE POLICY "Allow public read access to query_history"
  ON public.query_history
  FOR SELECT
  USING (true);

CREATE POLICY "Allow public insert to query_history"
  ON public.query_history
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Allow public update to query_history"
  ON public.query_history
  FOR UPDATE
  USING (true);

-- Create trigger for prompt_versions updated_at
CREATE TRIGGER update_prompt_versions_updated_at
  BEFORE UPDATE ON public.prompt_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert a default active prompt version
INSERT INTO public.prompt_versions (version_name, content, is_active)
VALUES (
  'v1.0-default',
  'You are a news article generator. Create engaging, factual news articles based on the source material provided. Keep articles concise and informative.',
  true
);