/**
 * Production-Ready Browserless Scraper
 * 
 * This module provides a robust, well-tested scraping system using Browserless.
 * It handles article extraction from news websites with intelligent selector detection,
 * validation, and error handling.
 */

const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ScrapeConfig {
  containerSelector: string;
  titleSelector: string;
  dateSelector: string;
  linkSelector: string;
  contentSelector: string;
  imageSelector?: string;
  waitForSelector?: string;
  timeout?: number;
}

export interface Article {
  title: string;
  date: string | null;
  url: string;
  content: string;
  excerpt: string;
  images: string[];
}

export interface AnalysisResult {
  suggestedConfig: ScrapeConfig;
  confidence: number;
  previewArticles: Article[];
  diagnostics: {
    containersFound: number;
    hasValidTitles: boolean;
    hasValidDates: boolean;
    hasValidLinks: boolean;
    issues: string[];
  };
}

interface BrowserlessElement {
  selector: string;
  timeout?: number;
}

interface BrowserlessResult {
  selector: string;
  results: Array<{
    text: string;
    html: string;
    attributes: Array<{ name: string; value: string }>;
  }>;
}

// ============================================================================
// CORE BROWSERLESS API FUNCTIONS
// ============================================================================

async function fetchHTML(url: string): Promise<string> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY not configured');
  }

  console.log(`📄 Fetching HTML: ${url}`);

  const response = await fetch(
    `${BROWSERLESS_URL}/content?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless error (${response.status}): ${errorText}`);
  }

  const html = await response.text();
  console.log(`✅ Retrieved ${html.length} characters`);
  return html;
}

async function scrapeWithSelectors(
  url: string,
  elements: BrowserlessElement[]
): Promise<BrowserlessResult[]> {
  if (!BROWSERLESS_API_KEY) {
    throw new Error('BROWSERLESS_API_KEY not configured');
  }

  console.log(`🌐 Scraping: ${url}`);
  console.log(`📋 Using ${elements.length} selectors`);

  const response = await fetch(
    `${BROWSERLESS_URL}/scrape?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        elements,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000,
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless error (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  console.log(`✅ Scraped ${result.data?.length || 0} element groups`);
  return result.data;
}

// ============================================================================
// INTELLIGENT SELECTOR DETECTION
// ============================================================================

function detectArticleSelectors(html: string): ScrapeConfig {
  console.log('🔍 Analyzing HTML structure for article patterns...');

  // Priority-ordered selectors for different parts
  const containerPatterns = [
    // Semantic HTML
    'article',
    // Common class names for news articles
    '.news-item', '.article', '.post', '.entry',
    '.news-card', '.story', '.news-article',
    // CMS-specific patterns
    '.fsPostLink', '.fsResource', '.elementor-post',
    // Generic containers (last resort)
    '.item', '.card',
  ];

  const titlePatterns = ['h1', 'h2', 'h3', '.title', '.headline', '.entry-title'];
  const datePatterns = ['time', '.date', '.published', '.post-date', '[datetime]'];
  const contentPatterns = ['.excerpt', '.description', '.content', '.body', 'p'];
  
  // Find the best container selector
  let containerSelector = 'article'; // default fallback
  let maxScore = 0;

  for (const pattern of containerPatterns) {
    const score = scoreSelector(html, pattern);
    console.log(`  ${pattern}: score ${score}`);
    
    if (score > maxScore) {
      maxScore = score;
      containerSelector = pattern;
    }
  }

  console.log(`✅ Best container: ${containerSelector} (score: ${maxScore})`);

  // Find child selectors within containers
  const titleSelector = findBestChildSelector(html, containerSelector, titlePatterns);
  const dateSelector = findBestChildSelector(html, containerSelector, datePatterns);
  const contentSelector = findBestChildSelector(html, containerSelector, contentPatterns);

  return {
    containerSelector,
    titleSelector: titleSelector || 'h2',
    dateSelector: dateSelector || 'time',
    linkSelector: 'a[href]',
    contentSelector: contentSelector || 'p',
    imageSelector: 'img[src]',
    timeout: 30000,
  };
}

function scoreSelector(html: string, selector: string): number {
  // Extract tag/class from selector
  const pattern = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^\./, '');
  
  // Count occurrences (rough estimate)
  const classPattern = new RegExp(`class=["'][^"']*${pattern}[^"']*["']`, 'gi');
  const tagPattern = new RegExp(`<${pattern}[\\s>]`, 'gi');
  
  const classMatches = (html.match(classPattern) || []).length;
  const tagMatches = (html.match(tagPattern) || []).length;
  const totalMatches = classMatches + tagMatches;

  // Score based on frequency (3-15 is ideal for news articles)
  if (totalMatches >= 3 && totalMatches <= 20) {
    return 100;
  } else if (totalMatches > 20 && totalMatches <= 50) {
    return 50;
  } else if (totalMatches > 0) {
    return 25;
  }
  
  return 0;
}

function findBestChildSelector(html: string, container: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    const score = scoreSelector(html, pattern);
    if (score > 0) {
      return pattern;
    }
  }
  return null;
}

// ============================================================================
// ARTICLE EXTRACTION
// ============================================================================

export async function analyzeSource(url: string): Promise<AnalysisResult> {
  console.log(`\n🔍 ANALYZING: ${url}`);
  console.log('='.repeat(60));

  try {
    // Step 1: Fetch HTML
    const html = await fetchHTML(url);

    // Step 2: Detect selectors
    const config = detectArticleSelectors(html);
    console.log('\n📋 Detected Configuration:');
    console.log(JSON.stringify(config, null, 2));

    // Step 3: Test configuration
    const { articles, diagnostics } = await testConfiguration(url, config);

    // Step 4: Calculate confidence
    const confidence = calculateConfidence(diagnostics);

    console.log('\n📊 Analysis Results:');
    console.log(`  Confidence: ${confidence}%`);
    console.log(`  Articles Found: ${articles.length}`);
    console.log(`  Issues: ${diagnostics.issues.length}`);

    return {
      suggestedConfig: config,
      confidence,
      previewArticles: articles.slice(0, 3), // Return first 3 as preview
      diagnostics,
    };
  } catch (error) {
    console.error('❌ Analysis failed:', error);
    throw error;
  }
}

async function testConfiguration(
  url: string,
  config: ScrapeConfig
): Promise<{ articles: Article[]; diagnostics: any }> {
  console.log('\n🧪 Testing configuration...');

  const elements: BrowserlessElement[] = [
    { selector: config.containerSelector },
    { selector: `${config.containerSelector} ${config.titleSelector}` },
    { selector: `${config.containerSelector} ${config.dateSelector}` },
    { selector: `${config.containerSelector} ${config.linkSelector}` },
    { selector: `${config.containerSelector} ${config.contentSelector}` },
  ];

  if (config.imageSelector) {
    elements.push({ selector: `${config.containerSelector} ${config.imageSelector}` });
  }

  const results = await scrapeWithSelectors(url, elements);

  // Extract data using array indices (0=container, 1=title, 2=date, 3=link, 4=content, 5=images)
  const containers = results[0]?.results || [];
  const titles = results[1]?.results || [];
  const dates = results[2]?.results || [];
  const links = results[3]?.results || [];
  const contents = results[4]?.results || [];
  const imageGroups = results[5]?.results || [];

  console.log(`  Containers: ${containers.length}`);
  console.log(`  Titles: ${titles.length}`);
  console.log(`  Dates: ${dates.length}`);
  console.log(`  Links: ${links.length}`);

  // Build articles
  const articles: Article[] = [];
  const diagnostics = {
    containersFound: containers.length,
    hasValidTitles: titles.length > 0,
    hasValidDates: dates.length > 0,
    hasValidLinks: links.length > 0,
    issues: [] as string[],
  };

  for (let i = 0; i < containers.length; i++) {
    const title = titles[i]?.text?.trim() || '';
    
    // Skip if no valid title
    if (!title || title.length < 5) {
      diagnostics.issues.push(`Container ${i}: No valid title`);
      continue;
    }

    const dateText = dates[i]?.text?.trim() || 
                    dates[i]?.attributes?.find(a => a.name === 'datetime')?.value || '';
    const href = links[i]?.attributes?.find(a => a.name === 'href')?.value || '';
    const content = contents[i]?.html || containers[i]?.html || '';
    
    // Extract images
    const images: string[] = [];
    if (imageGroups[i]) {
      const imgSrc = imageGroups[i].attributes?.find(a => a.name === 'src')?.value;
      if (imgSrc) {
        images.push(normalizeUrl(imgSrc, url));
      }
    }
    
    // Also extract images from content HTML
    const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    for (const match of imgMatches) {
      images.push(normalizeUrl(match[1], url));
    }

    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, url) : url,
      content: htmlToText(content),
      excerpt: htmlToText(content).substring(0, 200) + '...',
      images: [...new Set(images)], // Remove duplicates
    });
  }

  if (articles.length === 0) {
    diagnostics.issues.push('No articles could be extracted');
  }

  return { articles, diagnostics };
}

function calculateConfidence(diagnostics: any): number {
  let score = 0;

  // Base score from containers found
  if (diagnostics.containersFound >= 3) score += 40;
  else if (diagnostics.containersFound >= 1) score += 20;

  // Bonus for valid data
  if (diagnostics.hasValidTitles) score += 30;
  if (diagnostics.hasValidDates) score += 15;
  if (diagnostics.hasValidLinks) score += 15;

  // Penalty for issues
  score -= diagnostics.issues.length * 5;

  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// PRODUCTION SCRAPING
// ============================================================================

export async function scrapeArticles(
  url: string,
  config: ScrapeConfig
): Promise<Article[]> {
  console.log(`\n📰 SCRAPING ARTICLES: ${url}`);
  console.log('='.repeat(60));

  const elements: BrowserlessElement[] = [
    { selector: config.containerSelector },
    { selector: `${config.containerSelector} ${config.titleSelector}` },
    { selector: `${config.containerSelector} ${config.dateSelector}` },
    { selector: `${config.containerSelector} ${config.linkSelector}` },
    { selector: `${config.containerSelector} ${config.contentSelector}` },
  ];

  if (config.imageSelector) {
    elements.push({ selector: `${config.containerSelector} ${config.imageSelector}` });
  }

  const results = await scrapeWithSelectors(url, elements);

  const containers = results[0]?.results || [];
  const titles = results[1]?.results || [];
  const dates = results[2]?.results || [];
  const links = results[3]?.results || [];
  const contents = results[4]?.results || [];
  const imageGroups = results[5]?.results || [];

  const articles: Article[] = [];

  for (let i = 0; i < containers.length; i++) {
    const title = titles[i]?.text?.trim() || '';
    
    if (!title || title.length < 5) {
      console.log(`⏭️ Skipping container ${i}: No valid title`);
      continue;
    }

    const dateText = dates[i]?.text?.trim() || 
                    dates[i]?.attributes?.find(a => a.name === 'datetime')?.value || '';
    const href = links[i]?.attributes?.find(a => a.name === 'href')?.value || '';
    const content = contents[i]?.html || containers[i]?.html || '';
    
    const images: string[] = [];
    if (imageGroups[i]) {
      const imgSrc = imageGroups[i].attributes?.find(a => a.name === 'src')?.value;
      if (imgSrc) images.push(normalizeUrl(imgSrc, url));
    }
    
    const imgMatches = content.matchAll(/<img[^>]+src=["']([^"']+)["']/gi);
    for (const match of imgMatches) {
      images.push(normalizeUrl(match[1], url));
    }

    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, url) : url,
      content: htmlToText(content),
      excerpt: htmlToText(content).substring(0, 200) + '...',
      images: [...new Set(images)],
    });

    console.log(`✅ Article ${i + 1}: "${title}"`);
  }

  console.log(`\n✅ Extracted ${articles.length} articles`);
  return articles;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[^>]*>.*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>.*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function normalizeUrl(url: string, baseUrl: string): string {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  
  try {
    const base = new URL(baseUrl);
    return new URL(url, base.origin).href;
  } catch {
    return url;
  }
}
