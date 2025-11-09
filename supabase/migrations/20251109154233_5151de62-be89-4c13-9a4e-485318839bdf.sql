-- Add model configuration to prompt_versions
ALTER TABLE public.prompt_versions 
ADD COLUMN IF NOT EXISTS model_provider TEXT DEFAULT 'openrouter',
ADD COLUMN IF NOT EXISTS model_name TEXT DEFAULT 'google/gemini-2.0-flash-exp:free';