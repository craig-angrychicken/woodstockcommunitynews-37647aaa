-- Remove old conflicting storage policies that allow any authenticated user to bypass admin restrictions
DROP POLICY IF EXISTS "Authenticated users can upload artifact-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update artifact-images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete artifact-images" ON storage.objects;