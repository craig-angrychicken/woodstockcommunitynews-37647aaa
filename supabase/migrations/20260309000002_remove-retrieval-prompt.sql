-- Delete the retrieval prompt version
DELETE FROM public.prompt_versions WHERE prompt_type = 'retrieval';

-- Drop the existing check constraint and replace with journalism-only
ALTER TABLE public.prompt_versions
  DROP CONSTRAINT IF EXISTS prompt_versions_prompt_type_check;

ALTER TABLE public.prompt_versions
  ADD CONSTRAINT prompt_versions_prompt_type_check
  CHECK (prompt_type IN ('journalism'));
