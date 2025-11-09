-- Phase 2: Add parser configuration support to sources table
ALTER TABLE sources ADD COLUMN parser_config jsonb DEFAULT NULL;

-- Add comment explaining the structure
COMMENT ON COLUMN sources.parser_config IS 'JSON configuration for parsing source HTML. Schema: { parserType: string, selectors: { container, title, date, link, content }, confidence: number, lastAnalyzed: timestamp, notes: string }';