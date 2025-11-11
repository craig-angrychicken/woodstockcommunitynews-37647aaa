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
    elements, // Per-element timeouts set in elements array
    gotoOptions: {
      waitUntil: 'networkidle2',
      timeout: 12000, // Reduced from 30s to 12s for faster failures
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
// INTELLIGENT SELECTOR DETECTION (ZERO-ASSUMPTION APPROACH)
// ============================================================================

interface StructureGroup {
  fingerprint: string;
  selector: string;
  className: string;
  tagName: string;
  items: Array<{ html: string; text: string }>;
  count: number;
  hasLinks: number;
  hasDates: number;
  hasTitles: number;
}

/**
 * Finds repeated HTML structures that could be article containers.
 * No assumptions - just looks for patterns that repeat 3-20 times with links.
 */
function findRepeatedStructures(html: string): StructureGroup[] {
  console.log('  🔎 Scanning for repeated structures with links...');
  
  const groups: Map<string, StructureGroup> = new Map();
  
  // Zero-assumption pattern: scan ALL elements with class attributes containing links
  // Match any opening tag with a class attribute
  const elementMatches = html.matchAll(/<(\w+)[^>]*class=["']([^"']+)["'][^>]*>/gi);
  const elementsByClass = new Map<string, { tag: string; positions: number[] }>();
  
  // First pass: identify all elements with classes
  for (const match of elementMatches) {
    const tag = match[1].toLowerCase();
    const classAttr = match[2];
    const position = match.index!;
    
    // Use first significant class as identifier
    const classes = classAttr.split(/\s+/).filter(c => c && c.length > 2);
    if (classes.length === 0) continue;
    
    const primaryClass = classes[0];
    const key = `${tag}.${primaryClass}`;
    
    if (!elementsByClass.has(key)) {
      elementsByClass.set(key, { tag, positions: [] });
    }
    elementsByClass.get(key)!.positions.push(position);
  }
  
  // Second pass: extract full HTML for repeated elements with links
  for (const [key, info] of elementsByClass.entries()) {
    if (info.positions.length < 3) continue; // Need at least 3 repetitions
    
    const [tag, className] = key.split('.');
    const pattern = new RegExp(`<${tag}[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const matches = Array.from(html.matchAll(pattern));
    
    let validCount = 0;
    const items: Array<{ html: string; text: string }> = [];
    let hasLinks = 0;
    let hasDates = 0;
    let hasTitles = 0;
    
    for (const match of matches) {
      const fullHtml = match[0];
      
      // Must contain a link
      if (!/<a[^>]*href=/i.test(fullHtml)) continue;
      
      validCount++;
      items.push({ html: fullHtml, text: htmlToText(fullHtml) });
      
      if (/<a[^>]*href=/i.test(fullHtml)) hasLinks++;
      if (/date|time/i.test(fullHtml)) hasDates++;
      if (/<h[1-6]/i.test(fullHtml)) hasTitles++;
    }
    
    if (validCount >= 3) {
      groups.set(key, {
        fingerprint: key,
        selector: `.${className}`,
        className,
        tagName: tag,
        items,
        count: validCount,
        hasLinks,
        hasDates,
        hasTitles,
      });
    }
  }
  
  // Filter to groups with at least 3 items (NO UPPER LIMIT - true zero-assumption!)
  const validGroups = Array.from(groups.values())
    .filter(g => g.count >= 3);
  
  // Sort by quality score: prefer groups with links, titles, and dates
  validGroups.sort((a, b) => {
    const scoreA = (a.hasLinks * 3) + (a.hasTitles * 2) + (a.hasDates * 1);
    const scoreB = (b.hasLinks * 3) + (b.hasTitles * 2) + (b.hasDates * 1);
    return scoreB - scoreA;
  });
  
  console.log(`  ✅ Found ${validGroups.length} valid patterns:`);
  validGroups.slice(0, 5).forEach(g => {
    console.log(`     ${g.selector}: ${g.count} items (${g.hasLinks} links, ${g.hasTitles} titles, ${g.hasDates} dates)`);
  });
  
  return validGroups;
}

/**
 * Extracts specific selectors from a group of similar HTML items.
 * Analyzes the first few items to find common patterns for title, date, link, etc.
 */
function extractSelectorsFromGroup(group: StructureGroup): ScrapeConfig {
  console.log(`  🔍 Analyzing ${group.selector} items for child selectors...`);
  
  const samples = group.items.slice(0, Math.min(5, group.items.length));
  
  // Extract title selector
  let titleSelector = '';
  const titlePatterns = [
    { pattern: /<h3[^>]*class=["']([^"']*title[^"']*)["']/i, type: 'h3 with title class' },
    { pattern: /<h3/i, type: 'h3' },
    { pattern: /<h2[^>]*class=["']([^"']*title[^"']*)["']/i, type: 'h2 with title class' },
    { pattern: /<h2/i, type: 'h2' },
    { pattern: /<h1/i, type: 'h1' },
    { pattern: /class=["']([^"']*title[^"']*)["']/i, type: 'title class' },
  ];
  
  for (const { pattern, type } of titlePatterns) {
    const matchCount = samples.filter(s => pattern.test(s.html)).length;
    if (matchCount >= samples.length * 0.6) { // 60% of samples
      if (type.includes('class')) {
        const match = samples[0].html.match(pattern);
        titleSelector = match ? `.${match[1].split(/\s+/)[0]}` : type.split(' ')[0];
      } else {
        titleSelector = type;
      }
      console.log(`     Title: ${titleSelector} (${matchCount}/${samples.length})`);
      break;
    }
  }
  
  // Extract date selector
  let dateSelector = '';
  const datePatterns = [
    { pattern: /class=["']([^"']*news-date[^"']*)["']/i, extract: (html: string) => {
      const m = html.match(/class=["']([^"']*news-date[^"']*)["']/i);
      return m ? `.${m[1].split(/\s+/)[0]}` : '';
    }},
    { pattern: /class=["']([^"']*date[^"']*)["']/i, extract: (html: string) => {
      const m = html.match(/class=["']([^"']*\bdate\b[^"']*)["']/i);
      return m ? `.${m[1].split(/\s+/)[0]}` : '';
    }},
    { pattern: /<time/i, extract: () => 'time' },
  ];
  
  for (const { pattern, extract } of datePatterns) {
    const matchCount = samples.filter(s => pattern.test(s.html)).length;
    if (matchCount >= samples.length * 0.5) {
      dateSelector = extract(samples[0].html);
      console.log(`     Date: ${dateSelector} (${matchCount}/${samples.length})`);
      break;
    }
  }
  
  // Extract link pattern
  let linkSelector = 'a[href]';
  const linkMatch = samples[0].html.match(/href=["']([^"']+)["']/i);
  if (linkMatch) {
    const url = linkMatch[1];
    if (url.includes('news_detail')) {
      linkSelector = 'a[href*="news_detail"]';
    } else if (url.includes('/news/')) {
      linkSelector = 'a[href*="/news/"]';
    } else if (url.includes('/article')) {
      linkSelector = 'a[href*="/article"]';
    }
    console.log(`     Link: ${linkSelector}`);
  }
  
  return {
    containerSelector: group.selector,
    titleSelector: titleSelector || 'h3',
    dateSelector: dateSelector || 'time',
    linkSelector,
    contentSelector: 'p',
    imageSelector: 'img[src]',
    timeout: 30000,
  };
}

/**
 * Main detection function - uses zero-assumption pattern discovery.
 */
function detectArticleSelectors(html: string): ScrapeConfig {
  console.log('🔍 Analyzing HTML with zero-assumption approach...');
  
  // Find repeated structures in the HTML
  const structures = findRepeatedStructures(html);
  
  if (structures.length > 0) {
    const bestGroup = structures[0];
    console.log(`  ✅ Best pattern: ${bestGroup.selector} (${bestGroup.count} items)`);
    return extractSelectorsFromGroup(bestGroup);
  }
  
  // Fallback: use body with generic selectors
  console.log('  ⚠️ No repeated patterns found, using generic fallback');
  return {
    containerSelector: 'body',
    titleSelector: 'h1, h2, h3',
    dateSelector: 'time',
    linkSelector: 'a[href]',
    contentSelector: 'p',
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

  const startTime = Date.now();

  try {
    // Step 1: Fetch HTML (only once!)
    const html = await fetchHTML(url);
    console.log(`  ⏱️ HTML fetched in ${Date.now() - startTime}ms`);

    // Step 2: Detect selectors using zero-assumption approach
    const config = detectArticleSelectors(html);
    console.log('\n📋 Detected Configuration:');
    console.log(JSON.stringify(config, null, 2));

    // Step 3: Test configuration (pass HTML to avoid re-fetch)
    const { articles, diagnostics } = await testConfiguration(url, config, html);
    console.log(`  ⏱️ Total analysis time: ${Date.now() - startTime}ms`);

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
    
    // Always return a response, even on error
    return {
      suggestedConfig: {
        containerSelector: 'body',
        titleSelector: 'h1, h2, h3',
        dateSelector: 'time',
        linkSelector: 'a[href]',
        contentSelector: 'p',
        imageSelector: 'img[src]',
        timeout: 30000,
      },
      confidence: 0,
      previewArticles: [],
      diagnostics: {
        containersFound: 0,
        hasValidTitles: false,
        hasValidDates: false,
        hasValidLinks: false,
        issues: [error instanceof Error ? error.message : 'Unknown error'],
      },
    };
  }
}

async function testConfiguration(
  url: string,
  config: ScrapeConfig,
  html?: string
): Promise<{ articles: Article[]; diagnostics: any }> {
  console.log('\n🧪 Testing configuration...');
  const testStartTime = Date.now();

  // Fetch HTML only if not provided
  if (!html) {
    html = await fetchHTML(url);
  }

  // 1) Build candidate list: DISCOVERED PATTERNS FIRST, then small generic set
  const structures = findRepeatedStructures(html);
  const discoveredSelectors = structures.slice(0, 5).map(g => g.selector);
  
  console.log(`  🎯 Using ${discoveredSelectors.length} discovered patterns first`);
  
  const candidateContainers = Array.from(new Set([
    ...discoveredSelectors,           // Discovered patterns FIRST
    config.containerSelector,         // Then detected config
    '.post', '.entry', '.card',      // Small generic set (NO 'li' or 'article' priority)
  ])).slice(0, 6); // Limit to top 6 to stay within budget

  console.log(`  📋 Candidates (in order): ${candidateContainers.join(', ')}`);

  const ranked = candidateContainers.map(sel => ({ 
    selector: sel, 
    score: scoreSelector(html!, sel),
    isDiscovered: discoveredSelectors.includes(sel)
  }));

  // Sort: discovered patterns first, then by score, then prefer classes
  const preferClass = (s: string) => (s.includes('.') || s.includes('#')) ? 1 : 0;
  ranked.sort((a, b) => 
    (b.isDiscovered ? 1 : 0) - (a.isDiscovered ? 1 : 0) || // Discovered first
    b.score - a.score ||                                     // Then score
    preferClass(b.selector) - preferClass(a.selector)       // Then prefer classes
  );

  // 2) Try top 4 candidates with reduced timeout to stay within budget
  let chosenSelector = ranked[0]?.selector || config.containerSelector;
  let containers: Array<{ html: string; text: string }> = [];
  const maxAttempts = Math.min(4, ranked.length);

  for (let i = 0; i < maxAttempts; i++) {
    const { selector } = ranked[i];
    const attemptStart = Date.now();
    
    // Check if we're approaching time limit (20s budget)
    if (Date.now() - testStartTime > 18000) {
      console.log('  ⏱️ Approaching time limit, moving to fallback');
      break;
    }

    try {
      console.log(`  ▶️ [${i+1}/${maxAttempts}] Trying: ${selector}`);
      
      // Use reduced timeout per selector attempt
      const res = await scrapeWithSelectors(url, [{ selector, timeout: 2000 }]);
      console.log(`     ⏱️ Took ${Date.now() - attemptStart}ms`);
      
      const group = res[0]?.results || [];
      
      // Filter to items with links
      const validGroup = group.filter(r => {
        const html = r.html || '';
        return /<a[^>]*href=/i.test(html);
      });
      
      if (validGroup.length > 0) {
        chosenSelector = selector;
        containers = validGroup.map(r => ({ html: r.html, text: r.text }));
        console.log(`     ✅ Found ${containers.length} valid containers`);
        break;
      }
    } catch (err) {
      console.warn(`     ⚠️ Failed in ${Date.now() - attemptStart}ms: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
  }

  // 3) Zero-assumption local fallback using discovered patterns
  if (containers.length === 0) {
    console.log('  🔄 Applying zero-assumption local fallback...');
    
    try {
      // Get body HTML with short timeout
      const bodyRes = await scrapeWithSelectors(url, [{ selector: 'body', timeout: 2000 }]);
      const bodyHtml = bodyRes[0]?.results?.[0]?.html || '';
      
      // Find repeated structures in the body HTML
      const bodyStructures = findRepeatedStructures(bodyHtml);
      
      if (bodyStructures.length > 0) {
        // Use the best discovered pattern
        const best = bodyStructures[0];
        console.log(`     ✅ Using discovered pattern: ${best.selector} (${best.count} items)`);
        
        const pattern = new RegExp(
          `<${best.tagName}[^>]*class=["'][^"']*\\b${best.className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${best.tagName}>`,
          'gi'
        );
        
        const matches = Array.from(bodyHtml.matchAll(pattern)).slice(0, 20);
        containers = matches.map(m => ({ html: m[0], text: htmlToText(m[0]) }));
        chosenSelector = `${best.selector} (local discovery)`;
      } else {
        // Absolute last resort: li filter
        console.log('     ⤵️ No patterns found, using li filter as last resort');
        const liMatches = bodyHtml.match(/<li[\s\S]*?<\/li>/gi) || [];
        const validLis = liMatches.filter(html => /<a[^>]*href=/i.test(html));
        containers = validLis.map(html => ({ html, text: htmlToText(html) }));
        chosenSelector = 'body>li* (last resort)';
      }
    } catch (err) {
      console.warn('  ⚠️ Local fallback failed:', err);
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
  
  // Plain text date: "Nov 7, 2025" or "November 7, 2025"
  const plainText = htmlToText(html);
  const dateMatch = plainText.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\.?\s+\d{1,2},?\s+\d{4}\b/i);
  if (dateMatch) return dateMatch[0];
  
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

