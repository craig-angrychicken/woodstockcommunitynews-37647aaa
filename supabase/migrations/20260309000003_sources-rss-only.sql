-- Enforce RSS Feed as the only allowed source type
ALTER TABLE public.sources
  DROP CONSTRAINT IF EXISTS sources_type_check;

ALTER TABLE public.sources
  ADD CONSTRAINT sources_type_check
  CHECK (type = 'RSS Feed');

-- Update any stale non-RSS sources to RSS Feed (safety)
UPDATE public.sources SET type = 'RSS Feed' WHERE type != 'RSS Feed';
