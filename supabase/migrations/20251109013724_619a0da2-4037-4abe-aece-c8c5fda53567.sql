-- Drop the existing foreign key constraint that blocks source deletion
ALTER TABLE public.artifacts 
DROP CONSTRAINT IF EXISTS artifacts_source_id_fkey;

-- Recreate the constraint with CASCADE delete
-- This allows deleting a source to automatically delete all its related artifacts
ALTER TABLE public.artifacts 
ADD CONSTRAINT artifacts_source_id_fkey 
FOREIGN KEY (source_id) 
REFERENCES public.sources(id) 
ON DELETE CASCADE;