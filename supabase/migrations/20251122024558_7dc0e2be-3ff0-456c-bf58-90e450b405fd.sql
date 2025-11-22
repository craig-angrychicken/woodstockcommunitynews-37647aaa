-- Create app_settings table for global configuration
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Only admins can view settings"
  ON public.app_settings
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can insert settings"
  ON public.app_settings
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update settings"
  ON public.app_settings
  FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Migrate current active prompt's model to app_settings
INSERT INTO public.app_settings (key, value)
SELECT 
  'ai_model_config',
  jsonb_build_object(
    'model_name', COALESCE(model_name, 'google/gemini-2.5-flash'),
    'model_provider', COALESCE(model_provider, 'openrouter')
  )
FROM public.prompt_versions
WHERE is_active = true AND prompt_type = 'journalism'
LIMIT 1
ON CONFLICT (key) DO NOTHING;

-- If no active prompt found, insert default
INSERT INTO public.app_settings (key, value)
SELECT 'ai_model_config', '{"model_name": "google/gemini-2.5-flash", "model_provider": "openrouter"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'ai_model_config');

-- Remove model columns from prompt_versions
ALTER TABLE public.prompt_versions DROP COLUMN IF EXISTS model_name;
ALTER TABLE public.prompt_versions DROP COLUMN IF EXISTS model_provider;

-- Add trigger for updated_at on app_settings
CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();