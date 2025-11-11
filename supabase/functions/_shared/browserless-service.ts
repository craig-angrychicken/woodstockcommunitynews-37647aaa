/**
 * Browserless Service
 * Handles all interactions with the Browserless API for web scraping
 */

const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');

export interface BrowserlessElement {
  selector: string;
  name?: string;
  timeout?: number;
}

export interface BrowserlessConfig {
  elements: BrowserlessElement[];
  gotoOptions?: {
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
    timeout?: number;
  };
  waitForSelector?: string;
  waitForTimeout?: number;
}

export interface BrowserlessResult {
  selector: string;
  results: Array<{
    text: string;
    html: string;
    attributes: Array<{ name: string; value: string }>;
    height?: number;
    width?: number;
    left?: number;
    top?: number;
  }>;
}

export interface BrowserlessScrapeResponse {
  data: BrowserlessResult[];
}

/**
 * Scrape a URL using Browserless /scrape API
 */
export async function scrapeWithBrowserless(
  url: string,
  config: BrowserlessConfig
): Promise<BrowserlessScrapeResponse> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY is not configured');
  }

  console.log(`🌐 Scraping with Browserless: ${url}`);
  console.log(`📋 Config:`, JSON.stringify(config, null, 2));

  const requestBody = {
    url,
    elements: config.elements,
    gotoOptions: config.gotoOptions || {
      waitUntil: 'networkidle2',
      timeout: 30000
    },
    waitForSelector: config.waitForSelector,
    waitForTimeout: config.waitForTimeout
  };

  const response = await fetch(
    `${BROWSERLESS_URL}/scrape?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Browserless API error:', errorText);
    throw new Error(`Browserless API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  console.log(`✅ Scraped ${result.data?.length || 0} element groups`);
  
  return result;
}

/**
 * Get the full HTML content of a page using Browserless /content API
 */
export async function getContentWithBrowserless(url: string): Promise<string> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY is not configured');
  }

  console.log(`📄 Fetching content with Browserless: ${url}`);

  const response = await fetch(
    `${BROWSERLESS_URL}/content?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000
        }
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Browserless content API error:', errorText);
    throw new Error(`Browserless content API error: ${response.status} - ${errorText}`);
  }

  const html = await response.text();
  console.log(`✅ Retrieved ${html.length} characters of HTML`);
  
  return html;
}

/**
 * Analyze a website's structure and suggest selectors
 */
export async function analyzeSourceStructure(url: string): Promise<{
  suggestedConfig: BrowserlessConfig;
  confidence: number;
  previewData: BrowserlessScrapeResponse | null;
}> {
  console.log(`🔍 Analyzing source structure: ${url}`);

  // First, get the full HTML to analyze structure
  const html = await getContentWithBrowserless(url);

  // Detect common patterns
  const detectedSelectors = detectCommonSelectors(html);

  // Build suggested config
  const suggestedConfig: BrowserlessConfig = {
    elements: [
      { selector: detectedSelectors.container, name: 'container' },
      { selector: `${detectedSelectors.container} ${detectedSelectors.title}`, name: 'title' },
      { selector: `${detectedSelectors.container} ${detectedSelectors.date}`, name: 'date' },
      { selector: `${detectedSelectors.container} ${detectedSelectors.link}`, name: 'link' },
      { selector: `${detectedSelectors.container} ${detectedSelectors.content}`, name: 'content' }
    ].filter(e => e.selector && e.selector !== `${detectedSelectors.container} undefined`),
    gotoOptions: {
      waitUntil: 'networkidle2',
      timeout: 30000
    }
  };

  // Test the config
  let previewData = null;
  let confidence = 50;

  try {
    previewData = await scrapeWithBrowserless(url, suggestedConfig);
    
    // Calculate confidence based on results
    const totalResults = previewData.data.reduce((sum, group) => sum + group.results.length, 0);
    
    if (totalResults > 0) {
      confidence = Math.min(95, 50 + (totalResults * 10));
    }
    
    console.log(`✅ Analysis complete. Confidence: ${confidence}%, Results: ${totalResults}`);
  } catch (error) {
    console.error('⚠️ Error testing config:', error);
    confidence = 30;
  }

  return {
    suggestedConfig,
    confidence,
    previewData
  };
}

/**
 * Detect common selectors in HTML
 */
function detectCommonSelectors(html: string): {
  container: string;
  title: string;
  date: string;
  link: string;
  content: string;
} {
  const detectors = {
    container: [
      '.article', '.news-item', '.post', '.news-card', 
      'article', '.entry', '.item', '.card',
      '.fsPostLink', '.fsResource'
    ],
    title: [
      'h1', 'h2', 'h3', '.title', '.headline', 
      '.entry-title', '.fsResourceTitle', '.fsTitle'
    ],
    date: [
      'time', '.date', '.published', '.post-date',
      '.entry-date', '.fsTimeStamp', '.fsPostDate',
      '[datetime]', '.elementor-post__date'
    ],
    link: [
      'a[href]', '.more-link', '.read-more'
    ],
    content: [
      '.content', '.body', '.excerpt', '.description',
      'p', '.entry-content', '.fsResourceContent'
    ]
  };

  const result: any = {};

  // Find first matching selector for each category
  for (const [category, selectors] of Object.entries(detectors)) {
    for (const selector of selectors) {
      // Simple check if selector pattern exists in HTML
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        `class=["'][^"']*${escapedSelector.replace(/^\./, '')}[^"']*["']|${escapedSelector}`,
        'i'
      );
      
      if (pattern.test(html)) {
        result[category] = selector;
        break;
      }
    }
    
    // Default fallbacks
    if (!result[category]) {
      result[category] = selectors[0];
    }
  }

  return result;
}

/**
 * Test a Browserless configuration
 */
export async function testBrowserlessConfig(
  url: string,
  config: BrowserlessConfig
): Promise<{
  success: boolean;
  results: BrowserlessScrapeResponse | null;
  error?: string;
}> {
  try {
    const results = await scrapeWithBrowserless(url, config);
    
    return {
      success: true,
      results
    };
  } catch (error) {
    console.error('❌ Config test failed:', error);
    return {
      success: false,
      results: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Normalize relative URLs to absolute
 */
export function normalizeUrl(url: string, baseUrl: string): string {
  // Handle protocol-relative URLs (//example.com)
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  // Handle absolute URLs
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Handle relative URLs
  try {
    const base = new URL(baseUrl);
    return new URL(url, base.origin).href;
  } catch {
    return url;
  }
}
