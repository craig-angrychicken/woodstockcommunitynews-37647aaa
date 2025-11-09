-- Drop existing foreign key constraint
ALTER TABLE public.query_history 
  DROP CONSTRAINT IF EXISTS query_history_prompt_version_id_fkey;

-- Add new foreign key constraint with ON DELETE SET NULL
ALTER TABLE public.query_history 
  ADD CONSTRAINT query_history_prompt_version_id_fkey 
  FOREIGN KEY (prompt_version_id) 
  REFERENCES public.prompt_versions(id) 
  ON DELETE SET NULL;