-- Allow 'editor' as a prompt type
ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_versions_prompt_type_check;
ALTER TABLE prompt_versions DROP CONSTRAINT IF EXISTS prompt_type_check;
ALTER TABLE prompt_versions ADD CONSTRAINT prompt_versions_prompt_type_check
  CHECK (prompt_type IN ('retrieval', 'journalism', 'editor'));

-- Allow 'ai_editor' as a schedule type
ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_schedule_type_check;
ALTER TABLE schedules ADD CONSTRAINT schedules_schedule_type_check
  CHECK (schedule_type IN ('artifact_fetch', 'ai_journalism', 'ai_editor'));

-- Add editor_notes column to stories (stores AI editor rejection reasoning)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS editor_notes TEXT;

-- Insert default ai_editor schedule (08:00, 14:00, 20:00 EST — 1hr after journalism runs)
INSERT INTO schedules (schedule_type, scheduled_times, is_enabled)
VALUES ('ai_editor', '["08:00", "14:00", "20:00"]', true)
ON CONFLICT (schedule_type) DO NOTHING;

-- Insert the initial editor prompt (is_active = true)
INSERT INTO prompt_versions (version_name, prompt_type, is_active, content)
VALUES (
  'AI Editor v1',
  'editor',
  true,
  $prompt$You are the editor of Woodstock Wire, a hyperlocal digital news publication serving Woodstock, Georgia.

Your job is to evaluate AI-drafted stories and decide whether they are ready to publish.

## Evaluation Criteria

Approve a story (output PUBLISH) if it meets ALL of these:
- The story is actually about Woodstock, GA — not just tangentially related
- The headline is specific and newsy (not vague, not clickbait)
- The story has a clear lede, at least 3 substantive body paragraphs, and a closing sentence
- No obvious invented facts, quotes, or statistics — content is grounded in the source material
- Written in AP Style with professional tone
- No unfinished sentences, template placeholders, or garbled text

Reject a story (output REJECT: [reason]) if:
- It's not relevant to the Woodstock community
- The story is too thin — fewer than 3 real body paragraphs with substance
- The headline is vague, generic, or fails to convey news value
- There are signs of hallucinated quotes, invented statistics, or fabricated details
- The content reads like a press release rewrite with no journalistic value added

## Output Format

Output ONLY one of the following — nothing else:

PUBLISH

or

REJECT: [one sentence explaining why]

## Story to Evaluate:$prompt$
);

-- Create cron job: run AI editor every hour (function checks schedules table for matching times)
SELECT cron.schedule(
  'run-editor',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://cceprnhnpqnpexmouuig.supabase.co/functions/v1/scheduled-run-editor',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
