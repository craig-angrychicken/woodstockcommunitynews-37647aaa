-- Add slug column for Vercel public site URLs
ALTER TABLE stories ADD COLUMN IF NOT EXISTS slug TEXT;

-- Unique index (partial: only non-null slugs must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_slug ON stories(slug) WHERE slug IS NOT NULL;

-- Backfill slugs for existing published stories
DO $$
DECLARE
  r RECORD;
  base_slug TEXT;
  final_slug TEXT;
  suffix INT;
BEGIN
  FOR r IN
    SELECT id, title
    FROM stories
    WHERE status = 'published' AND slug IS NULL
    ORDER BY published_at ASC NULLS LAST
  LOOP
    -- Generate base slug: lowercase, replace non-alnum with hyphens, collapse, trim, truncate
    base_slug := lower(r.title);
    base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
    base_slug := regexp_replace(base_slug, '-+', '-', 'g');
    base_slug := trim(BOTH '-' FROM base_slug);
    -- Truncate at ~80 chars on a hyphen boundary
    IF length(base_slug) > 80 THEN
      base_slug := substring(base_slug FROM 1 FOR 80);
      -- Cut at last hyphen to avoid partial words
      IF position('-' IN base_slug) > 0 THEN
        base_slug := substring(base_slug FROM 1 FOR length(base_slug) - position('-' IN reverse(base_slug)));
      END IF;
      base_slug := trim(BOTH '-' FROM base_slug);
    END IF;

    -- Check uniqueness, append suffix if needed
    final_slug := base_slug;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM stories WHERE slug = final_slug AND id != r.id) LOOP
      final_slug := base_slug || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE stories SET slug = final_slug WHERE id = r.id;
  END LOOP;
END $$;
