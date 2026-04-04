-- Fix CCSD source: add index mode so fetch-web-pages follows article links
-- instead of treating the listing page as a single artifact
UPDATE sources
SET parser_config = parser_config || '{"page_mode": "index", "link_selector": "a[href*=\"/post-detail/\"]"}'::jsonb
WHERE url LIKE '%cherokeek12%'
  AND type = 'Web Page'
  AND (parser_config->>'page_mode') IS NULL;

-- Clean up the single-page test artifact that was created from the listing page
DELETE FROM artifacts
WHERE source_id IN (
  SELECT id FROM sources WHERE url LIKE '%cherokeek12%' AND type = 'Web Page'
)
AND is_test = true;
