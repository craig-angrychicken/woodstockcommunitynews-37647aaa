-- Add content filter patterns to CCSD Web Page source
-- Filters out low-impact press-release content (teacher/student profiles for committees,
-- board member appreciation spotlights) while keeping achievements, budget, infrastructure
UPDATE sources
SET parser_config = parser_config || '{
  "exclude_title_patterns": [
    "Meet the Teacher Advisory",
    "Meet the Student Delegate",
    "Meet the Parent Advisory",
    "Celebrating School Board Appreciation"
  ]
}'::jsonb
WHERE id = '25dba7df-3b34-4ddb-9da9-adf2b337fde6';
