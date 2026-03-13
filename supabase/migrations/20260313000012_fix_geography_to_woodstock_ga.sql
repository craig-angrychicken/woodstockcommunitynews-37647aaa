-- Fix geographic references in active prompts to consistently say "Woodstock, Georgia"
-- (no county, no other state)

-- Fix journalism prompt: "Woodstock, Illinois and the surrounding McHenry County area" → "Woodstock, Georgia"
UPDATE prompt_versions
SET content = replace(replace(
  content,
  'Woodstock, Illinois and the surrounding McHenry County area',
  'Woodstock, Georgia'
), 'Woodstock/McHenry County', 'Woodstock')
WHERE prompt_type = 'journalism' AND is_active = true;

-- Fix editor prompt: remove Cherokee County references
UPDATE prompt_versions
SET content = replace(replace(replace(
  content,
  'Woodstock, Georgia and Cherokee County', 'Woodstock, Georgia'
), 'Woodstock, GA or Cherokee County', 'Woodstock, GA'
), 'Woodstock/Cherokee County community', 'Woodstock community'
)
WHERE prompt_type = 'editor' AND is_active = true;
