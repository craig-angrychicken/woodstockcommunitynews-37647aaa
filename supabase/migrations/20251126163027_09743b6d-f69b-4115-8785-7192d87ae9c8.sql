-- Step 1: Delete duplicate artifacts, keeping only the oldest (first fetched) per source+title
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY source_id, LOWER(TRIM(REGEXP_REPLACE(title, '\s+', ' ', 'g')))
      ORDER BY created_at ASC
    ) as rn
  FROM artifacts
  WHERE title IS NOT NULL AND source_id IS NOT NULL
)
DELETE FROM artifacts
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Add unique constraint on guid to prevent future duplicates
ALTER TABLE artifacts ADD CONSTRAINT artifacts_guid_unique UNIQUE (guid);