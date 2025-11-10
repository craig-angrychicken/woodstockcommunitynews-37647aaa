-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- RLS policy for user_roles: admins can view all, users can view their own
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- RLS policy for user_roles: only admins can insert/update/delete
CREATE POLICY "Only admins can manage roles"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- UPDATE RLS POLICIES FOR EXISTING TABLES
-- ============================================

-- DROP all existing public policies
DROP POLICY IF EXISTS "Allow public read access to stories" ON public.stories;
DROP POLICY IF EXISTS "Allow public insert to stories" ON public.stories;
DROP POLICY IF EXISTS "Allow public update to stories" ON public.stories;
DROP POLICY IF EXISTS "Allow public delete to stories" ON public.stories;

DROP POLICY IF EXISTS "Allow public read access to artifacts" ON public.artifacts;
DROP POLICY IF EXISTS "Allow public insert to artifacts" ON public.artifacts;
DROP POLICY IF EXISTS "Allow public delete from artifacts" ON public.artifacts;

DROP POLICY IF EXISTS "Allow public read access to sources" ON public.sources;
DROP POLICY IF EXISTS "Allow public insert to sources" ON public.sources;
DROP POLICY IF EXISTS "Allow public update to sources" ON public.sources;
DROP POLICY IF EXISTS "Allow public delete from sources" ON public.sources;

DROP POLICY IF EXISTS "Allow public read access to prompt_versions" ON public.prompt_versions;
DROP POLICY IF EXISTS "Allow public insert to prompt_versions" ON public.prompt_versions;
DROP POLICY IF EXISTS "Allow public update to prompt_versions" ON public.prompt_versions;
DROP POLICY IF EXISTS "Allow public delete from prompt_versions" ON public.prompt_versions;

DROP POLICY IF EXISTS "Allow public read access to query_history" ON public.query_history;
DROP POLICY IF EXISTS "Allow public insert to query_history" ON public.query_history;
DROP POLICY IF EXISTS "Allow public update to query_history" ON public.query_history;

DROP POLICY IF EXISTS "Allow public read access to story_artifacts" ON public.story_artifacts;
DROP POLICY IF EXISTS "Allow public insert to story_artifacts" ON public.story_artifacts;
DROP POLICY IF EXISTS "Allow public delete from story_artifacts" ON public.story_artifacts;

-- ============================================
-- STORIES TABLE: Public read, admin write
-- ============================================
CREATE POLICY "Anyone can view stories"
ON public.stories
FOR SELECT
TO public
USING (true);

CREATE POLICY "Only admins can insert stories"
ON public.stories
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update stories"
ON public.stories
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete stories"
ON public.stories
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- ARTIFACTS TABLE: Public read, admin write
-- ============================================
CREATE POLICY "Anyone can view artifacts"
ON public.artifacts
FOR SELECT
TO public
USING (true);

CREATE POLICY "Only admins can insert artifacts"
ON public.artifacts
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete artifacts"
ON public.artifacts
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- SOURCES TABLE: Admin only
-- ============================================
CREATE POLICY "Only admins can view sources"
ON public.sources
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert sources"
ON public.sources
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update sources"
ON public.sources
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete sources"
ON public.sources
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- PROMPT_VERSIONS TABLE: Admin only
-- ============================================
CREATE POLICY "Only admins can view prompts"
ON public.prompt_versions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert prompts"
ON public.prompt_versions
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update prompts"
ON public.prompt_versions
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete prompts"
ON public.prompt_versions
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- QUERY_HISTORY TABLE: Admin only
-- ============================================
CREATE POLICY "Only admins can view query history"
ON public.query_history
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert query history"
ON public.query_history
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update query history"
ON public.query_history
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- STORY_ARTIFACTS TABLE: Admin only
-- ============================================
CREATE POLICY "Only admins can view story_artifacts"
ON public.story_artifacts
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert story_artifacts"
ON public.story_artifacts
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete story_artifacts"
ON public.story_artifacts
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- ============================================
-- STORAGE POLICIES FOR artifact-images BUCKET
-- ============================================

-- Allow public read access to images (for published articles)
CREATE POLICY "Anyone can view artifact images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'artifact-images');

-- Only admins can upload images
CREATE POLICY "Only admins can upload artifact images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'artifact-images' 
  AND public.has_role(auth.uid(), 'admin')
);

-- Only admins can update images
CREATE POLICY "Only admins can update artifact images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'artifact-images' 
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'artifact-images' 
  AND public.has_role(auth.uid(), 'admin')
);

-- Only admins can delete images
CREATE POLICY "Only admins can delete artifact images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'artifact-images' 
  AND public.has_role(auth.uid(), 'admin')
);