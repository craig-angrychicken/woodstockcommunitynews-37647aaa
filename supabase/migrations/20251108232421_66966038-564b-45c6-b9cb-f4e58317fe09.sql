-- Create storage bucket for artifact images
INSERT INTO storage.buckets (id, name, public)
VALUES ('artifact-images', 'artifact-images', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for artifact-images bucket
CREATE POLICY "Public Access for artifact-images"
ON storage.objects FOR SELECT
USING (bucket_id = 'artifact-images');

CREATE POLICY "Authenticated users can upload artifact-images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'artifact-images');

CREATE POLICY "Authenticated users can update artifact-images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'artifact-images');

CREATE POLICY "Authenticated users can delete artifact-images"
ON storage.objects FOR DELETE
USING (bucket_id = 'artifact-images');