-- Granicus has two distinct identifiers: clip_id (assigned once a meeting is
-- recorded/archived) and event_id (assigned while the meeting is still
-- upcoming). The scraper was only matching clip_id, which silently dropped
-- every upcoming meeting that had an agenda/packet already posted.
--
-- This migration lets us track meetings from the upcoming phase onward.

ALTER TABLE public.council_meetings
  ALTER COLUMN granicus_clip_id DROP NOT NULL;

ALTER TABLE public.council_meetings
  DROP CONSTRAINT IF EXISTS council_meetings_granicus_clip_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS council_meetings_clip_id_key
  ON public.council_meetings (granicus_clip_id)
  WHERE granicus_clip_id IS NOT NULL;

ALTER TABLE public.council_meetings
  ADD COLUMN IF NOT EXISTS granicus_event_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS council_meetings_event_id_key
  ON public.council_meetings (granicus_event_id)
  WHERE granicus_event_id IS NOT NULL;

ALTER TABLE public.council_meetings
  DROP CONSTRAINT IF EXISTS council_meetings_has_identity;

ALTER TABLE public.council_meetings
  ADD CONSTRAINT council_meetings_has_identity
  CHECK (granicus_clip_id IS NOT NULL OR granicus_event_id IS NOT NULL);
