-- Add DELETE policy to artifacts table to allow deletion
CREATE POLICY "Allow public delete from artifacts"
ON public.artifacts
FOR DELETE
USING (true);