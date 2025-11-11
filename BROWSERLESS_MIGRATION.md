# Browserless Scraping System - Complete Implementation

## Overview

This is a production-ready, comprehensive web scraping system built with Browserless. It intelligently analyzes news websites, detects article patterns, and extracts structured content for artifact storage and story generation.

## Architecture

### Core Components

1. **browserless-scraper.ts** - Shared scraping library
   - Smart selector detection using HTML pattern analysis
   - Robust article extraction with validation
   - Confidence scoring based on detection quality
   - Error handling and diagnostics

2. **analyze-source-v2** - Analysis edge function
   - Analyzes website structure
   - Suggests optimal selectors
   - Returns preview articles
   - Calculates confidence scores

3. **scrape-articles** - Production scraping function
   - Uses saved configurations to extract articles
   - Filters by date range
   - Creates artifacts in database
   - Handles hero image selection

### Frontend Components

- **AddSourceForm** - Source creation with analysis
- **SourceAnalysisModalV2** - Displays analysis results
- **ManualQuery** - Manual scraping interface

## How It Works

### 1. Analysis Phase

When a user adds a new source:

```typescript
// User enters URL in AddSourceForm
const { data } = await supabase.functions.invoke('analyze-source-v2', {
  body: { sourceUrl: 'https://example.com/news' }
});

// Response includes:
{
  success: true,
  analysis: {
    suggestedConfig: {
      containerSelector: "article",
      titleSelector: "h2",
      dateSelector: "time",
      linkSelector: "a[href]",
      contentSelector: "p"
    },
    confidence: 85,
    previewArticles: [...],
    diagnostics: {
      containersFound: 12,
      hasValidTitles: true,
      issues: []
    }
  }
}
```

### 2. Configuration Storage

Approved configuration is saved to the `sources` table:

```json
{
  "scrapeConfig": {
    "containerSelector": "article",
    "titleSelector": "h2",
    ...
  },
  "confidence": 85,
  "diagnostics": {...}
}
```

### 3. Article Extraction

When running a manual query or scheduled job:

```typescript
const { data } = await supabase.functions.invoke('scrape-articles', {
  body: {
    dateFrom: '2025-01-01',
    dateTo: '2025-01-31',
    sourceIds: ['uuid-1', 'uuid-2'],
    environment: 'production'
  }
});

// Creates artifacts in database
```

## Selector Detection Algorithm

The system uses intelligent pattern matching:

1. **Container Detection**
   - Looks for semantic HTML (`<article>`, `<section>`)
   - Checks common class patterns (`.news-item`, `.post`)
   - Scores based on frequency (3-20 = ideal for news)

2. **Child Selector Detection**
   - Finds best title selector (`h1`, `h2`, `.title`)
   - Detects date patterns (`time`, `.date`, `[datetime]`)
   - Identifies content selectors

3. **Validation**
   - Tests selectors against actual page
   - Verifies data extraction works
   - Calculates confidence score

## Data Flow

```
User Input (URL)
    ↓
analyze-source-v2 Edge Function
    ↓
browserless-scraper.ts (analyzeSource)
    ↓
1. Fetch HTML
2. Detect selectors
3. Test configuration
4. Calculate confidence
    ↓
Return analysis to frontend
    ↓
User reviews & saves config
    ↓
Configuration stored in sources table
    ↓
Manual Query / Scheduled Run
    ↓
scrape-articles Edge Function
    ↓
browserless-scraper.ts (scrapeArticles)
    ↓
Extract articles → Create artifacts
```

## Database Integration

### Sources Table
- `parser_config.scrapeConfig` - Browserless configuration
- `parser_config.confidence` - Analysis confidence score
- `parser_config.diagnostics` - Detection diagnostics

### Artifacts Table
Created from extracted articles:
- `title` - Article title
- `content` - Full text content
- `date` - Publication date
- `hero_image_url` - Selected hero image
- `images` - Array of image URLs
- `source_id` - Reference to source
- `is_test` - Test vs production environment

## Error Handling

1. **Analysis Errors**
   - Invalid URLs
   - Browserless API errors
   - No articles found

2. **Scraping Errors**
   - Missing configuration
   - Network failures
   - Invalid selector patterns

3. **Data Validation**
   - Missing titles (skipped)
   - Invalid dates (included anyway)
   - Broken images (filtered)

## Confidence Scoring

Score calculation:
- Base: 40 points for 3+ containers
- +30 points for valid titles
- +15 points for valid dates
- +15 points for valid links
- -5 points per issue detected

Ranges:
- **70-100%**: High confidence (ready for production)
- **40-69%**: Medium confidence (review recommended)
- **0-39%**: Low confidence (manual adjustment needed)

## Testing Workflow

1. Add source to test queue
2. Run analysis (analyze-source-v2)
3. Review confidence and sample articles
4. Save configuration
5. Test scrape with environment='test'
6. Review test artifacts
7. Activate source when satisfied

## Edge Function Deployment

Functions auto-deploy when code changes:
- `analyze-source-v2` - Analysis
- `scrape-articles` - Production scraping
- `analyze-source` - Legacy (kept for compatibility)
- `run-manual-query` - Legacy (kept for compatibility)

## Configuration Format

```typescript
interface ScrapeConfig {
  containerSelector: string;      // Main article container
  titleSelector: string;           // Article title
  dateSelector: string;            // Publication date
  linkSelector: string;            // Article URL
  contentSelector: string;         // Article content
  imageSelector?: string;          // Article images
  timeout?: number;                // Scrape timeout
  waitForSelector?: string;        // Wait for element
}
```

## Best Practices

1. **Always analyze before adding sources**
   - Verify selectors work correctly
   - Check confidence score
   - Review sample articles

2. **Test sources before activating**
   - Use test environment
   - Check artifact quality
   - Validate date extraction

3. **Monitor confidence scores**
   - High confidence (70%+): Good to go
   - Medium (40-69%): Review carefully
   - Low (<40%): Needs manual adjustment

4. **Handle edge cases**
   - Sites with JavaScript rendering
   - Dynamic content loading
   - Non-standard date formats

## Troubleshooting

### Low Confidence Scores

**Symptom**: Analysis returns <40% confidence

**Causes**:
- Wrong container selector (navigation instead of articles)
- Missing dates or links
- Complex page structure

**Solutions**:
1. Check sample articles in modal
2. Review diagnostics for issues
3. Manually adjust selectors in database if needed
4. Re-run analysis after site changes

### No Articles Found

**Symptom**: 0 containers found

**Causes**:
- JavaScript-heavy site (not rendered)
- Wrong URL (not article listing page)
- Site blocking Browserless

**Solutions**:
1. Verify URL in browser
2. Check if site requires JavaScript
3. Try different page URL
4. Check Browserless logs

### Missing Data

**Symptom**: Articles have missing titles/dates

**Causes**:
- Selectors don't match all articles
- Date format not recognized
- Content inside shadowDOM

**Solutions**:
1. Review selector patterns
2. Check HTML structure
3. Adjust selectors manually
4. Handle missing data gracefully

## Performance

- Analysis: ~3-5 seconds per source
- Scraping: ~2-4 seconds per source
- Concurrent sources: Processed sequentially
- Rate limits: Browserless API limits apply

## Security

- API keys stored in Supabase secrets
- RLS policies on sources table
- Admin-only access to scraping functions
- Test environment for safe testing

## Future Enhancements

1. Manual selector override UI
2. JavaScript-rendered page support
3. Pagination handling
4. Custom extraction rules
5. Performance monitoring
6. Automatic selector healing

## Migration from Old System

Old functions preserved for compatibility:
- `analyze-source` - Old analysis (deprecated)
- `run-manual-query` - Old scraping (deprecated)

New system (`analyze-source-v2`, `scrape-articles`) should be used for all new sources.

Existing sources can be re-analyzed to update configurations.
