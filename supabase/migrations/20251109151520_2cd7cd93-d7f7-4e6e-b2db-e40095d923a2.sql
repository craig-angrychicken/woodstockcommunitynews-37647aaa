-- Update default value for prompt_type column to journalism
ALTER TABLE public.prompt_versions 
ALTER COLUMN prompt_type SET DEFAULT 'journalism'::text;