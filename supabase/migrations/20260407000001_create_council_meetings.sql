-- Council meetings pipeline: track Woodstock city government meetings and
-- their document availability (agenda, packet, minutes) over time.
-- Each meeting produces up to 3 chained stories: preview, update, recap.

CREATE TABLE public.council_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity (natural key from Granicus)
  granicus_clip_id INTEGER NOT NULL UNIQUE,
  meeting_type TEXT NOT NULL,
  meeting_date TIMESTAMPTZ NOT NULL,

  -- Document availability (NULL = not yet detected)
  agenda_url TEXT,
  agenda_detected_at TIMESTAMPTZ,
  packet_url TEXT,
  packet_detected_at TIMESTAMPTZ,
  minutes_url TEXT,
  minutes_detected_at TIMESTAMPTZ,

  -- Extracted PDF text content (for LLM prompts)
  agenda_content TEXT,
  packet_content TEXT,
  minutes_content TEXT,

  -- Story chain (at most one of each per meeting)
  preview_story_id UUID REFERENCES public.stories(id),
  update_story_id  UUID REFERENCES public.stories(id),
  recap_story_id   UUID REFERENCES public.stories(id),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_council_meetings_date ON council_meetings(meeting_date DESC);

-- Back-reference on stories for easy queries from the story side
ALTER TABLE public.stories ADD COLUMN council_meeting_id UUID REFERENCES public.council_meetings(id);
ALTER TABLE public.stories ADD COLUMN story_type TEXT;

-- Schedule entry for the council scraper cron
INSERT INTO public.schedules (id, schedule_type, is_enabled, active_hour_start, active_hour_end)
VALUES (gen_random_uuid(), 'council_scraper', true, 6, 22)
ON CONFLICT (schedule_type) DO NOTHING;

-- Cron job: scrape Granicus 3x daily at 8am, 2pm, 8pm UTC
SELECT cron.schedule(
  'scrape-council-meetings',
  '0 8,14,20 * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-scrape-council',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
