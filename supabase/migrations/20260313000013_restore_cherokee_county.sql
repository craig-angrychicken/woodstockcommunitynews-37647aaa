-- Restore Cherokee County to coverage area in active prompts
-- Migration 20260313000012 incorrectly stripped Cherokee County from both journalism and editor prompts.
-- The correct coverage identity is "Woodstock, Georgia and Cherokee County".

-- Restore Cherokee County to journalism prompt
UPDATE prompt_versions
SET content = replace(replace(replace(
  content,
  'covering Woodstock, Georgia.',
  'covering Woodstock, Georgia and Cherokee County.'
), 'where in Woodstock, who is affected',
   'where in Woodstock/Cherokee County, who is affected'
), 'the Woodstock area,',
   'the Woodstock/Cherokee County area,'
)
WHERE prompt_type = 'journalism' AND is_active = true;

-- Restore Cherokee County to editor prompt
UPDATE prompt_versions
SET content = replace(replace(replace(
  content,
  'serving Woodstock, Georgia.',
  'serving Woodstock, Georgia and Cherokee County.'
), 'about Woodstock, GA —',
   'about Woodstock, GA or Cherokee County —'
), 'relevant to the Woodstock community',
   'relevant to the Woodstock/Cherokee County community'
)
WHERE prompt_type = 'editor' AND is_active = true;
