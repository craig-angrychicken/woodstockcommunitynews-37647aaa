-- Fix geographic references in active journalism prompt to say "Woodstock, Georgia and Cherokee County"
-- (correct state + correct county — was incorrectly set to "Woodstock, Illinois and the surrounding McHenry County area")

-- Fix journalism prompt: "Woodstock, Illinois and the surrounding McHenry County area" → "Woodstock, Georgia and Cherokee County"
UPDATE prompt_versions
SET content = replace(replace(
  content,
  'Woodstock, Illinois and the surrounding McHenry County area',
  'Woodstock, Georgia and Cherokee County'
), 'Woodstock/McHenry County', 'Woodstock/Cherokee County')
WHERE prompt_type = 'journalism' AND is_active = true;
