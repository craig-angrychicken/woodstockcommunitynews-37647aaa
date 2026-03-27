-- One-time backfill: copy hero_image_url from cluster mates to imageless Web Page artifacts
UPDATE artifacts a
SET hero_image_url = donor.hero_image_url
FROM (
  SELECT DISTINCT ON (target.id) target.id AS target_id, mate.hero_image_url
  FROM artifacts target
  JOIN artifacts mate ON mate.cluster_id = target.cluster_id
    AND mate.id != target.id
    AND mate.hero_image_url IS NOT NULL
  WHERE target.type = 'Web Page'
    AND target.hero_image_url IS NULL
    AND target.cluster_id IS NOT NULL
  ORDER BY target.id, mate.created_at DESC
) donor
WHERE a.id = donor.target_id;

-- One-time backfill: update stories that lack hero images when their source artifacts
-- (or cluster mates of those artifacts) now have images
UPDATE stories s
SET hero_image_url = donor.hero_image_url
FROM (
  SELECT DISTINCT ON (sa.story_id) sa.story_id, COALESCE(a.hero_image_url, mate.hero_image_url) AS hero_image_url
  FROM story_artifacts sa
  JOIN artifacts a ON a.id = sa.artifact_id
  LEFT JOIN artifacts mate ON mate.cluster_id = a.cluster_id
    AND mate.id != a.id
    AND mate.hero_image_url IS NOT NULL
  WHERE COALESCE(a.hero_image_url, mate.hero_image_url) IS NOT NULL
  ORDER BY sa.story_id, mate.created_at DESC NULLS LAST
) donor
WHERE s.id = donor.story_id
  AND s.hero_image_url IS NULL;
