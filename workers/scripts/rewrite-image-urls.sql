-- Rewrite Supabase Storage image URLs → stable relative /images/<key> paths.
-- The Worker serves /images/* from the R2 ARTIFACT_IMAGES bucket (key = path after /images/).
-- replace() is a no-op when the prefix is absent, so no LIKE filter is needed
-- (avoids SQLite's "LIKE pattern too complex" limit on the long URL literal).
UPDATE stories
  SET hero_image_url = replace(hero_image_url,
    'https://cceprnhnpqnpexmouuig.supabase.co/storage/v1/object/public/artifact-images/', '/images/')
  WHERE hero_image_url IS NOT NULL;

UPDATE artifacts
  SET hero_image_url = replace(hero_image_url,
    'https://cceprnhnpqnpexmouuig.supabase.co/storage/v1/object/public/artifact-images/', '/images/')
  WHERE hero_image_url IS NOT NULL;

UPDATE artifacts
  SET images = replace(images,
    'https://cceprnhnpqnpexmouuig.supabase.co/storage/v1/object/public/artifact-images/', '/images/')
  WHERE images IS NOT NULL;
