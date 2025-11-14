/**
 * Production-Ready Browserless Scraper
 * 
 * This module provides a robust, well-tested scraping system using Browserless.
 * It handles article extraction from news websites with intelligent selector detection,
 * validation, and error handling.
 */

import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

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
  markdown?: string; // Full article in markdown format
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
          timeout: 45000,
        },
        waitForTimeout: 15000,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Browserless error (${response.status}): ${errorText}`);
  }

  const html = await response.text();
  console.log(`✅ Retrieved ${html.length} characters`);
  
  // Debug: Verify JavaScript executed and rendered the elements
  const hasNewsItems = html.includes('news-list-item');
  const hasClassAttributes = html.includes('class=');
  console.log(`🔍 HTML contains "news-list-item": ${hasNewsItems}`);
  console.log(`🔍 HTML contains class attributes: ${hasClassAttributes}`);
  console.log(`📋 First 2000 characters of HTML:`, html.substring(0, 2000));
  
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
      timeout: 30000, // Increased to 30s for pages with heavy JS
    },
    waitForTimeout: 5000,
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
 * Determines if a selector/element looks like navigation rather than article content.
 * Uses heuristics to filter out menus, headers, footers, etc.
 * IMPORTANT: Class names alone are not enough - we need to check actual content!
 */
function isNavigationElement(selector: string, className: string, html: string, text: string): boolean {
  // First, check if it has article-like content indicators
  const hasDate = /\b\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i.test(text);
  const hasParagraphs = /<p[^>]*>/i.test(html);
  const hasSubstantialText = text.length > 80; // More than 80 chars suggests real content
  const hasMultipleWords = text.split(/\s+/).filter(w => w.length > 2).length > 8; // More than 8 words
  
  // If it has strong article indicators, it's NOT navigation (even if class suggests it)
  const strongArticleIndicators = (hasDate || hasParagraphs) && hasSubstantialText;
  if (strongArticleIndicators) {
    return false; // Definitely an article, not navigation
  }
  
  // Check for explicit navigation keywords ONLY if content is weak
  const strongNavKeywords = /\bnavbar\b|\bnavigation\b|\bsidebar\b|\bbreadcrumb\b|\btopbar\b|\bbottombar\b/i;
  if (strongNavKeywords.test(selector) || strongNavKeywords.test(className)) {
    return true;
  }
  
  // Check if element is actually inside nav/header/footer tags in the HTML context
  // (not just checking the class name)
  const htmlContext = html.substring(0, Math.min(200, html.length));
  if (/<\/(nav|header|footer)>/i.test(htmlContext)) {
    return true;
  }
  
  // Navigation items typically have very short text (just link labels) with no dates
  if (text.length < 40 && !hasDate && !hasParagraphs) {
    return true;
  }
  
  // If text is too short and lacks article indicators, probably navigation
  if (!hasSubstantialText && !hasMultipleWords && !hasDate) {
    return true;
  }
  
  return false; // Default to accepting it
}

/**
 * Scores a structure group for article-likeness.
 * Higher scores = more likely to be article content.
 */
function scoreArticleLikeness(group: StructureGroup): number {
  let score = 0;
  
  // Base score from article indicators
  score += group.hasLinks * 3;
  score += group.hasTitles * 2;
  score += group.hasDates * 10; // Dates are VERY strong article indicators
  
  // Average text length is a strong signal
  const avgTextLength = group.items.reduce((sum, item) => sum + item.text.length, 0) / group.items.length;
  if (avgTextLength > 80) score += 8;   // Substantial content
  if (avgTextLength > 150) score += 8;  // Rich content
  if (avgTextLength > 300) score += 5;  // Very rich content
  
  // Bonus for being in article-friendly containers
  if (/article|post|entry|item|card|story|news/i.test(group.selector)) {
    score += 15;
  }
  
  // Compute link-based signals
  const totalAnchors = group.items.reduce((sum, item) => sum + ((item.html.match(/<a\b[^>]*href=["'][^"']+["']/gi) || []).length), 0);
  const newsAnchors = group.items.reduce((sum, item) => sum + ((item.html.match(/<a\b[^>]*href=["'][^"']*(news|newsroom|press|article|stories?)[^"']*["']/gi) || []).length), 0);
  const newsRatio = totalAnchors > 0 ? newsAnchors / totalAnchors : 0;
  const avgAnchorsPerItem = totalAnchors / Math.max(1, group.items.length);

  // Check if items have paragraph tags (strong article signal)
  const itemsWithParagraphs = group.items.filter(item => /<p[^>]*>/i.test(item.html)).length;
  const paragraphRatio = itemsWithParagraphs / Math.max(1, group.items.length);

  // Heuristics: reward news-like links
  if (newsRatio >= 0.5) score += 20;
  if (newsRatio >= 0.8) score += 10;

  // Heuristics: penalize obvious menu lists
  if ((group.tagName === 'ul' || group.tagName === 'ol') && paragraphRatio < 0.2 && group.hasTitles === 0) {
    score -= 25; // list menus with few/no paragraphs and no headings
    if (newsRatio <= 0.1) score -= 15; // and links are not news-like
    if (avgAnchorsPerItem > 6) score -= 10; // lots of links per item
  }

  // Small penalty for navigation-like patterns in selector, but don't disqualify
  if (/\bnavbar\b|\bnavigation\b|\bsidebar\b|\bmenu\b/i.test(group.selector)) {
    score -= 8; // reduced; content checks dominate
  }

  // Paragraph-heavy groups are likely article lists
  if (paragraphRatio > 0.5) {
    score += 10; // More than half have paragraphs
  }
  
  return score;
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
      const text = htmlToText(fullHtml);
      
      // Must contain a link
      if (!/<a[^>]*href=/i.test(fullHtml)) continue;
      
      // Filter out navigation elements
      if (isNavigationElement(key, className, fullHtml, text)) continue;
      
      validCount++;
      items.push({ html: fullHtml, text });
      
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
  
  // Sort by article-likeness score: prefer groups with article indicators, penalize navigation
  validGroups.sort((a, b) => {
    const scoreA = scoreArticleLikeness(a);
    const scoreB = scoreArticleLikeness(b);
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

export async function testConfiguration(
  url: string,
  config: ScrapeConfig,
  html?: string,
  containersHtml?: string[]
): Promise<{ articles: Article[]; diagnostics: any }> {
  console.log('\n🧪 Testing configuration...');
  const testStartTime = Date.now();

  // Priority 1: If containersHtml provided, validate pattern then apply to full page
  if (containersHtml && containersHtml.length > 0) {
    console.log(`✅ Validating pattern with ${containersHtml.length} selected container(s)...`);
    
    // Validate the pattern works with selected containers
    let validationPassed = false;
    for (const containerHtml of containersHtml) {
      const { title, href } = extractTitleAndLink(containerHtml);
      if (title && title.length >= 5) {
        validationPassed = true;
        break;
      }
    }
    
    if (!validationPassed) {
      return {
        articles: [],
        diagnostics: {
          containersFound: containersHtml.length,
          articlesExtracted: 0,
          hasValidTitles: false,
          hasValidLinks: false,
          issues: ['Selected containers do not contain expected article elements (title/link)'],
        }
      };
    }
    
    console.log('✅ Pattern validated, now applying to full page...');
    
    // Fetch full HTML if not provided
    if (!html) {
      html = await fetchHTML(url);
    }
  }

  // Priority 2: Use provided HTML or fetch it
  if (!html) {
    html = await fetchHTML(url);
  }

  let chosenSelector = config.containerSelector;
  let containers: Array<{ html: string; text: string }> = [];

  // If we have HTML (from the client-rendered proxy), honor the user's selector FIRST
  // and avoid any additional Browserless calls. Only fall back to local discovery if
  // the selector yields no matches.
  if (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      if (doc) {
        const els = doc.querySelectorAll(config.containerSelector);
        console.log(`  🔎 Strict match for '${config.containerSelector}': ${els.length} matches`);
        if (els.length > 0) {
          containers = Array.from(els).slice(0, 20).map((el) => ({
            html: (el as Element).outerHTML || '',
            text: (el as Element).textContent || '',
          }));
        }
      } else {
        console.warn('  ⚠️ DOMParser returned null document; skipping strict match');
      }
    } catch (err) {
      console.warn('  ⚠️ Strict match failed:', err);
    }
  }

  // If strict user-provided selector found nothing, return error
  if (containers.length === 0) {
    console.log(`  ❌ Selector "${config.containerSelector}" found 0 matches`);
    return {
      articles: [],
      diagnostics: {
        error: `Selector "${config.containerSelector}" found 0 matches in provided HTML`,
        containersFound: 0,
        chosenSelector: config.containerSelector,
        issues: ['User-provided selector did not match any elements. Please try selecting different containers.'],
        testTime: Date.now() - testStartTime,
      }
    };
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
// MARKDOWN CONVERSION
// ============================================================================

function htmlToMarkdown(html: string): string {
  if (!html) return '';
  
  let markdown = html;
  
  // Headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  
  // Links
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Images
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)\n\n');
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![]($1)\n\n');
  
  // Lists
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  markdown = markdown.replace(/<\/?[uo]l[^>]*>/gi, '\n');
  
  // Paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Line breaks
  markdown = markdown.replace(/<br[^>]*>/gi, '\n');
  
  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]*>/g, '');
  
  // Decode HTML entities
  markdown = markdown
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();
  
  return markdown;
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

  try {
    // Use Browserless /function endpoint with custom Puppeteer code
    console.log(`🌐 Using Browserless /function to extract: ${config.containerSelector}`);
    
    const puppeteerCode = `
      export default async ({ page, context }) => {
        // Sleep helper function
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Set realistic user agent and viewport
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to the page
        await page.goto('${url}', { 
          waitUntil: 'networkidle2',
          timeout: 60000 
        });
        
        // Wait for selector across all frames with timeout
        const selector = '${config.containerSelector}';
        const maxWaitTime = 15000;
        const startTime = Date.now();
        
        let elementsFound = false;
        while (Date.now() - startTime < maxWaitTime && !elementsFound) {
          // Check main frame
          const mainFrameElements = await page.$$(selector);
          if (mainFrameElements.length > 0) {
            elementsFound = true;
            break;
          }
          
          // Check all frames
          const frames = page.frames();
          for (const frame of frames) {
            try {
              const frameElements = await frame.$$(selector);
              if (frameElements.length > 0) {
                elementsFound = true;
                break;
              }
            } catch (e) {
              // Frame might not be ready, continue
            }
          }
          
          if (!elementsFound) {
            await sleep(500);
          }
        }
        
        // Extract elements from all frames
        const containers = [];
        const frames = [page.mainFrame(), ...page.frames()];
        
        for (const frame of frames) {
          try {
            const elements = await frame.$$(selector);
            
            for (const element of elements) {
              const html = await frame.evaluate(el => el.outerHTML, element);
              const text = await frame.evaluate(el => el.textContent || '', element);
              
              containers.push({ html, text });
            }
          } catch (e) {
            // Frame might not be accessible
          }
        }
        
        return { containers };
      };
    `;
    
    const response = await fetch(
      `${BROWSERLESS_URL}/function?token=${BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: puppeteerCode,
          context: {}
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Browserless /function error: ${response.statusText}`);
      console.error(`Response: ${errorText}`);
      throw new Error(`Browserless /function error: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    const containers = result.containers || [];
    
    console.log(`📦 Browserless found ${containers.length} elements matching "${config.containerSelector}"`);
    
    if (containers.length === 0) {
      console.log('⚠️ No articles found with configured selector');
      return [];
    }
    
    console.log(`✅ Processing ${containers.length} containers`);
    
    // Process containers using existing function
    return await processContainers(containers, url, config);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ Scraping failed: ${errorMessage}`);
    throw error;
  }
}

async function processContainers(
  containers: Array<{ html: string; text: string }>,
  baseUrl: string,
  config: ScrapeConfig
): Promise<Article[]> {
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
    const images = extractImages(contentHtml, baseUrl);
    
    const plainTextContent = htmlToText(contentHtml) || containerText;
    const markdownContent = htmlToMarkdown(contentHtml);

    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, baseUrl) : baseUrl,
      content: plainTextContent,
      excerpt: plainTextContent.substring(0, 200) + '...',
      images,
      markdown: formatArticleMarkdown(title, dateText, markdownContent, images, href ? normalizeUrl(href, baseUrl) : baseUrl),
    });

    console.log(`✅ Article ${i + 1}: "${title}"`);
  }

  console.log(`\n✅ Extracted ${articles.length} articles`);
  return articles;
}

async function parseArticlesFromElements(
  elements: Element[],
  baseUrl: string,
  config: ScrapeConfig
): Promise<Article[]> {
  const articles: Article[] = [];
  
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const html = el.innerHTML;
    const text = el.textContent || '';
    
    // Extract title and link
    const titleEl = el.querySelector(config.titleSelector);
    const linkEl = el.querySelector(config.linkSelector);
    
    let title = titleEl?.textContent?.trim() || '';
    let href = linkEl?.getAttribute('href') || '';
    
    if (!title || title.length < 5) {
      continue;
    }
    
    // Extract date
    const dateEl = el.querySelector(config.dateSelector);
    const dateText = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '';
    
    // Extract content
    const contentEl = el.querySelector(config.contentSelector);
    const contentHtml = contentEl?.innerHTML || html;
    
    // Extract images
    const imageEls = el.querySelectorAll(config.imageSelector || 'img');
    const images = Array.from(imageEls)
      .filter((img): img is Element => img instanceof Element)
      .map(img => img.getAttribute('src'))
      .filter((src): src is string => src !== null && src.length > 0)
      .map(src => normalizeUrl(src, baseUrl));
    
    const plainTextContent = htmlToText(contentHtml);
    const markdownContent = htmlToMarkdown(contentHtml);
    
    articles.push({
      title,
      date: dateText || null,
      url: href ? normalizeUrl(href, baseUrl) : baseUrl,
      content: plainTextContent,
      excerpt: plainTextContent.substring(0, 200) + '...',
      images,
      markdown: formatArticleMarkdown(title, dateText, markdownContent, images, href ? normalizeUrl(href, baseUrl) : baseUrl),
    });
    
    console.log(`✅ Article ${i + 1}: "${title}"`);
  }
  
  console.log(`\n✅ Extracted ${articles.length} articles from local parsing`);
  return articles;
}

function formatArticleMarkdown(
  title: string,
  date: string | null,
  content: string,
  images: string[],
  url: string
): string {
  let markdown = `# ${title}\n\n`;
  
  if (date) {
    markdown += `**Date:** ${date}\n\n`;
  }
  
  markdown += `**Source:** [View Original](${url})\n\n`;
  
  if (images.length > 0) {
    markdown += `![Article Image](${images[0]})\n\n`;
  }
  
  markdown += `---\n\n${content}`;
  
  return markdown;
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
  // Standard <img src="...">
  const imgTagRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = imgTagRe.exec(html)) !== null) {
    imgs.add(normalizeUrl(match[1], baseUrl));
  }
  // Background images in inline styles: background or background-image url(...)
  const bgRe = /style=["'][^"']*background(?:-image)?\s*:\s*url\((['"]?)([^)'"]+)\1\)[^"']*["']/gi;
  while ((match = bgRe.exec(html)) !== null) {
    imgs.add(normalizeUrl(match[2], baseUrl));
  }
  // Also check for CSS inline like background:url('...') without explicit property name
  const bgGenericRe = /url\((['"]?)([^)'"]+)\1\)/gi;
  let genericMatch: RegExpExecArray | null;
  while ((genericMatch = bgGenericRe.exec(html)) !== null) {
    // Only add if it's within a style attribute nearby to reduce false positives
    const snippetStart = Math.max(0, bgGenericRe.lastIndex - 100);
    const snippet = html.slice(snippetStart, bgGenericRe.lastIndex);
    if (/style=/.test(snippet)) {
      imgs.add(normalizeUrl(genericMatch[2], baseUrl));
    }
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

