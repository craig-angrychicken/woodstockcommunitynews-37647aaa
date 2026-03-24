-- Allow "Web Page" as a source type alongside "RSS Feed"
ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type IN ('RSS Feed', 'Web Page'));
