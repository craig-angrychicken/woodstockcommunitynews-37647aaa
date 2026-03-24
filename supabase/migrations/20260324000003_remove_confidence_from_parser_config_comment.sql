-- Remove orphaned confidence scoring fields from parser_config column comment.
-- The confidence/health feature was never implemented — nothing sets these values.
COMMENT ON COLUMN public.sources.parser_config IS 'JSON configuration for source parsing. RSS: { feedType, fieldMappings: { titleField, linkField, dateField, contentField, imageField } }. Web Page: { feedType, extractImages, extractVideo }.';
