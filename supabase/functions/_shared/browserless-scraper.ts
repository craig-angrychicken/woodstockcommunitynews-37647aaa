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


  const requestBody = {
    url,
    elements,
    gotoOptions: {
      waitUntil: 'networkidle2',
      timeout: 30000,
    },
  };

  const response = await fetch(
    `${BROWSERLESS_URL}/scrape?token=${BROWSERLESS_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Browserless request failed:', {
      status: response.status,
      url,
      elements: elements.map((e) => e.selector),
      error: errorText
    });
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

  // Fast path for Civic/Granicus/FS-style sites
  const hasFsPostLink = /class=["'][^"']*\bfsPostLink\b[^"']*["']/i.test(html);
  const hasFsPostDate = /class=["'][^"']*\bfsPostDate\b[^"']*["']/i.test(html);
  const hasFsTimeStamp = /class=["'][^"']*\bfsTimeStamp\b[^"']*["']/i.test(html);
  const hasFsResourceContent = /class=["'][^"']*\bfsResourceContent\b[^"']*["']/i.test(html);

  if (hasFsPostLink) {
    console.log('✅ Detected fsPostLink pattern - using anchor-based selectors');
    return {
      containerSelector: 'a.fsPostLink',
      titleSelector: 'a.fsPostLink',
      dateSelector: hasFsPostDate ? '.fsPostDate' : (hasFsTimeStamp ? '.fsTimeStamp' : 'time'),
      linkSelector: 'a.fsPostLink',
      contentSelector: hasFsResourceContent ? '.fsResourceContent' : 'p',
      imageSelector: 'img[src]',
      timeout: 30000,
    };
  }

  // Priority-ordered selectors for different parts
  const containerPatterns = [
    // Semantic HTML
    'article',
    // Common class names for news articles
    '.news-item', '.article', '.post', '.entry',
    '.news-card', '.story', '.news-article',
    // CMS-specific patterns
    'a.fsPostLink', '.fsResource', '.elementor-post',
    // Generic containers (last resort)
    '.item', '.card',
  ];

  // Prefer h2/h3 before h1 to avoid strict headlines under article
  const titlePatterns = ['h2', 'h3', '.entry-title', '.headline', '.title', 'h1', 'a[href]'];
  const datePatterns = ['.fsPostDate', 'time', '.date', '.published', '.post-date', '[datetime]'];
  const contentPatterns = ['.excerpt', '.description', '.content', '.body', 'p'];
  
  // Find the best container selector
  let containerSelector = 'article'; // default fallback
  let maxScore = 0;

  for (const pattern of containerPatterns) {
    const score = scoreSelector(html, pattern);
    console.log(`  ${pattern}: score ${score}`);
    
    const isTag = !pattern.includes('.') && !pattern.includes('#');
    const currentIsTag = !containerSelector.includes('.') && !containerSelector.includes('#');

    if (
      score > maxScore ||
      (score === maxScore && currentIsTag && !isTag) // prefer class/id over plain tag on tie
    ) {
      maxScore = score;
      containerSelector = pattern;
    }
  }

  console.log(`✅ Best container: ${containerSelector} (score: ${maxScore})`);

  // Find child selectors within containers
  const titleSelector = findBestChildSelector(html, containerSelector, titlePatterns) || 'a[href]';
  const dateSelector = findBestChildSelector(html, containerSelector, datePatterns) || 'time';
  const contentSelector = findBestChildSelector(html, containerSelector, contentPatterns) || 'p';

  return {
    containerSelector,
    titleSelector,
    dateSelector,
    linkSelector: 'a[href]',
    contentSelector,
    imageSelector: 'img[src]',
    timeout: 30000,
  };
}

function scoreSelector(html: string, selector: string): number {
  let totalMatches = 0;

  if (selector.includes('.') && !selector.startsWith('.')) {
    // Tag with class e.g., a.fsPostLink
    const [tag, cls] = selector.split('.', 2);
    const re = new RegExp(`<${tag}[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["']`, 'gi');
    totalMatches = (html.match(re) || []).length;
  } else if (selector.startsWith('.')) {
    // Class selector - look for class="...classname..."
    const className = selector.substring(1);
    const classPattern = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["']`, 'gi');
    totalMatches = (html.match(classPattern) || []).length;
  } else {
    // Tag selector - look for <tagname
    const tagPattern = new RegExp(`<${selector}[\\s>]`, 'gi');
    totalMatches = (html.match(tagPattern) || []).length;
  }

  console.log(`  ${selector}: ${totalMatches} matches`);

  // Score based on frequency (3-20 is ideal for news articles)
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

  // 1) Analyze HTML to rank candidate containers (no waiting on Browserless)
  const html = await fetchHTML(url);

  const candidateContainers = Array.from(new Set([
    config.containerSelector,
    'article',
    '.item',
    '.news-item',
    '.entry',
    '.post',
    '.card',
    '.news-card',
    '.story',
    'li'
  ]));

  const ranked = candidateContainers
    .map(sel => ({ selector: sel, score: scoreSelector(html, sel) }))
    .sort((a, b) => b.score - a.score);

  // Prefer class/id over plain tag when scores tie
  const preferClass = (s: string) => (s.includes('.') || s.includes('#')) ? 1 : 0;
  ranked.sort((a, b) => (b.score - a.score) || (preferClass(b.selector) - preferClass(a.selector)));

  // 2) Try candidates one by one with a short per-call timeout to avoid global failures
  let chosenSelector = ranked[0]?.selector || config.containerSelector;
  let containers: Array<{ html: string; text: string }> = [];

  for (const { selector } of ranked) {
    try {
      console.log(`  ▶️ Trying selector: ${selector}`);
      const res = await scrapeWithSelectors(url, [{ selector, timeout: 4000 }]);
      const group = res[0]?.results || [];
      if (group.length > 0) {
        chosenSelector = selector;
        containers = group.map(r => ({ html: r.html, text: r.text }));
        break;
      }
    } catch (err) {
      console.warn(`  ⚠️ Selector failed: ${selector} -> ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
  }

  // 3) Last-resort fallback: scrape <body> and split into <li> items locally
  if (containers.length === 0) {
    try {
      console.log('  ⤵️ Fallback to <body> and local parsing of <li> items');
      const bodyRes = await scrapeWithSelectors(url, [{ selector: 'body', timeout: 4000 }]);
      const bodyHtml = bodyRes[0]?.results?.[0]?.html || '';
      const liMatches = bodyHtml.match(/<li[\s\S]*?<\/li>/gi) || [];
      containers = liMatches.map(html => ({ html, text: htmlToText(html) }));
      chosenSelector = 'body>li*';
    } catch (err) {
      console.warn('  ⚠️ Body fallback failed:', err);
    }
  }

  console.log(`  ✅ Chosen container selector: ${chosenSelector}`);
  console.log(`  Containers found: ${containers.length}`);

  const articles: Article[] = [];
  const diagnostics = {
    containersFound: containers.length,
    hasValidTitles: false,
    hasValidDates: false,
    hasValidLinks: false,
    issues: [] as string[],
  };

  for (let i = 0; i < containers.length; i++) {
    const containerHtml = containers[i]?.html || '';
    const containerText = containers[i]?.text || '';

    const { title, href } = extractTitleAndLink(containerHtml);
    const dateText = extractDate(containerHtml) || '';
    const contentHtml = extractContent(containerHtml) || containerHtml;

    if (!title || title.length < 5) {
      diagnostics.issues.push(`Container ${i}: No valid title`);
      continue;
    }

    const images = extractImages(contentHtml, url);

    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, url) : url,
      content: htmlToText(contentHtml) || containerText,
      excerpt: (htmlToText(contentHtml) || containerText).substring(0, 200) + '...',
      images,
    });
  }

  diagnostics.hasValidTitles = articles.length > 0;
  diagnostics.hasValidLinks = articles.some(a => !!a.url);
  diagnostics.hasValidDates = articles.some(a => !!a.date);

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

  // Scrape only containers; parse inner HTML to extract data
  const elements: BrowserlessElement[] = [
    { selector: config.containerSelector }
  ];

  const results = await scrapeWithSelectors(url, elements);

  const containers = results[0]?.results || [];

  const articles: Article[] = [];

  for (let i = 0; i < containers.length; i++) {
    const containerHtml = containers[i]?.html || '';
    const containerText = containers[i]?.text || '';

    const { title, href } = extractTitleAndLink(containerHtml);
    if (!title || title.length < 5) {
      console.log(`⏭️ Skipping container ${i}: No valid title`);
      continue;
    }

    const dateText = extractDate(containerHtml) || '';
    const contentHtml = extractContent(containerHtml) || containerHtml;
    const images = extractImages(contentHtml, url);

    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, url) : url,
      content: htmlToText(contentHtml) || containerText,
      excerpt: (htmlToText(contentHtml) || containerText).substring(0, 200) + '...',
      images,
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

// === Parsing helpers (operate on container HTML) ===
function extractTitleAndLink(html: string): { title: string | null; href: string | null } {
  // fsPostLink anchor
  let m = html.match(/<a[^>]*class=["'][^"']*\bfsPostLink\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (m) return { href: m[1], title: htmlToText(m[2]) };

  // fsResourceTitle anchor
  m = html.match(/<a[^>]*class=["'][^"']*\bfsResourceTitle\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (m) return { href: m[1], title: htmlToText(m[2]) };

  // Heading with optional inner anchor
  const h = html.match(/<(h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/i);
  if (h) {
    const a = h[0].match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (a) return { href: a[1], title: htmlToText(a[2]) };
    return { href: null, title: htmlToText(h[2]) };
  }

  // Fallback: first anchor anywhere
  const a = html.match(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (a) return { href: a[1], title: htmlToText(a[2]) };

  return { href: null, title: null };
}

function extractDate(html: string): string | null {
  // fsPostDate
  let m = html.match(/<[^>]*class=["'][^"']*\bfsPostDate\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (m) return htmlToText(m[1]);
  // fsTimeStamp
  m = html.match(/<[^>]*class=["'][^"']*\bfsTimeStamp\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
  if (m) return htmlToText(m[1]);
  // <time datetime="...">text</time>
  m = html.match(/<time[^>]*datetime=["']([^"']+)["'][^>]*>([\s\S]*?)<\/time>/i);
  if (m) return m[1] || htmlToText(m[2]);
  m = html.match(/<time[^>]*>([\s\S]*?)<\/time>/i);
  if (m) return htmlToText(m[1]);
  return null;
}

function extractContent(html: string): string | null {
  // fsResourceContent block
  let m = html.match(/<([a-z0-9]+)[^>]*class=["'][^"']*\bfsResourceContent\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (m) return m[2];
  // excerpt/description
  m = html.match(/<([a-z0-9]+)[^>]*class=["'][^"']*(excerpt|description|summary)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (m) return m[3];
  return null;
}

function extractImages(html: string, baseUrl: string): string[] {
  const imgs = new Set<string>();
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    imgs.add(normalizeUrl(match[1], baseUrl));
  }
  return Array.from(imgs);
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

