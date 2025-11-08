-- Add DELETE policy to sources table to allow deletion
CREATE POLICY "Allow public delete from sources"
ON public.sources
FOR DELETE
USING (true);

-- Add DELETE policy to prompt_versions table to allow deletion
CREATE POLICY "Allow public delete from prompt_versions"
ON public.prompt_versions
FOR DELETE
USING (true);