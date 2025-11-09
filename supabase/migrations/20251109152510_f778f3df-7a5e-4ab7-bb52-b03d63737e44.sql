-- Drop existing self-referencing foreign key constraint
ALTER TABLE public.prompt_versions 
  DROP CONSTRAINT IF EXISTS prompt_versions_based_on_version_id_fkey;

-- Add new foreign key constraint with ON DELETE SET NULL
ALTER TABLE public.prompt_versions 
  ADD CONSTRAINT prompt_versions_based_on_version_id_fkey 
  FOREIGN KEY (based_on_version_id) 
  REFERENCES public.prompt_versions(id) 
  ON DELETE SET NULL;