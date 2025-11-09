import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay utilities for human-like scraping
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs: number = 2000, maxMs: number = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  console.log(`⏱️ Waiting ${delay}ms before next request...`);
  return sleep(delay);
}

// HTML to Markdown converter
function htmlToMarkdown(html: string): string {
  let markdown = html;
  
  // Convert headers
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  
  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Convert links
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Convert bold and italic
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Convert lists
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  
  // Convert line breaks
  markdown = markdown.replace(/<br[^>]*>/gi, '\n');
  
  // Remove remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");
  
  // Clean up extra whitespace
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  markdown = markdown.trim();
  
  return markdown;
}

// Extract storyID from article elements (for JavaScript-based navigation)
function extractStoryId(titleElement: Element | null, parentElement: Element): string | null {
  if (!titleElement) return null;
  
  // Strategy 1: Parse onclick handler for common patterns
  const onclick = titleElement.getAttribute('onclick') || '';
  if (onclick) {
    console.log(`  🔍 Analyzing onclick: ${onclick}`);
    
    // Look for patterns like:
    // - showStory(504)
    // - loadArticle('504')
    // - window.location='media.php?storyID=504'
    const patterns = [
      /storyID[=:](\d+)/i,           // storyID=504 or storyID:504
      /\([\'\"]?(\d+)[\'\"]?\)/,      // function(504) or function('504')
      /media\.php\?.*?(\d+)/,         // media.php?...504
      /story[\/\-_]?(\d+)/i,          // story/504, story-504, story_504
    ];
    
    for (const pattern of patterns) {
      const match = onclick.match(pattern);
      if (match && match[1]) {
        console.log(`  ✅ Found storyID via onclick pattern: ${match[1]}`);
        return match[1];
      }
    }
  }
  
  // Strategy 2: Check data attributes
  const dataAttrs = ['data-story-id', 'data-id', 'data-article-id', 'data-post-id'];
  for (const attr of dataAttrs) {
    const value = titleElement.getAttribute(attr) || parentElement.getAttribute(attr);
    if (value && /^\d+$/.test(value)) {
      console.log(`  ✅ Found storyID in ${attr}: ${value}`);
      return value;
    }
  }
  
  // Strategy 3: Check element IDs
  const titleId = titleElement.getAttribute('id') || '';
  const parentId = parentElement.getAttribute('id') || '';
  const idMatch = (titleId + ' ' + parentId).match(/(\d+)/);
  if (idMatch) {
    console.log(`  ✅ Found storyID in element ID: ${idMatch[1]}`);
    return idMatch[1];
  }
  
  console.log('  ❌ No storyID found');
  return null;
}

// Helper to extract URLs from CSS background properties
function extractUrlsFromCssBackground(styleString: string): string[] {
  const urls: string[] = [];
  
  // Match url(...) patterns, handling quotes and no quotes
  const urlPattern = /url\s*\(\s*['"]?([^'"()]+)['"]?\s*\)/gi;
  let match;
  
  while ((match = urlPattern.exec(styleString)) !== null) {
    const url = match[1].trim();
    
    // Skip data URIs, gradients, and common non-content images (case-insensitive)
    const urlLower = url.toLowerCase();
    if (url.startsWith('data:') || 
        urlLower.includes('gradient') ||
        urlLower.includes('logo') ||
        urlLower.includes('icon') ||
        urlLower.includes('sprite')) {
      continue;
    }
    
    urls.push(url);
  }
  
  return urls;
}

// Helper to extract best URL from srcset attribute
function pickFromSrcset(srcset: string): string | null {
  const parts = srcset.split(',').map(s => s.trim());
  if (parts.length === 0) return null;
  // Pick last (usually largest resolution)
  const last = parts[parts.length - 1].split(/\s+/)[0];
  return last || null;
}

// Extract full article content from article page HTML
function extractFullArticleContent(html: string, baseUrl: string): { content: string; images: string[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return { content: '', images: [] };
  
  // Try multiple selectors to find main content
  const contentSelectors = [
    '.normalStory',           // Cherokee County specific
    '.story-content',
    '.article-content',
    '.main-content',
    'article',
    '.post-content',
    '#content',
    '.entry-content',
    '[role="main"]'
  ];
  
  let contentElement = null;
  for (const selector of contentSelectors) {
    contentElement = doc.querySelector(selector);
    if (contentElement) {
      console.log(`  ✅ Found content using selector: ${selector}`);
      break;
    }
  }
  
  // If no specific content area, look for the largest text block
  if (!contentElement) {
    const allDivs = doc.querySelectorAll('div, section, article');
    let maxParagraphs = 0;
    for (const div of allDivs) {
      const pCount = (div as Element).querySelectorAll('p').length;
      if (pCount > maxParagraphs) {
        maxParagraphs = pCount;
        contentElement = div as Element;
      }
    }
    if (contentElement) {
      console.log(`  ⚠️ Using fallback: found ${maxParagraphs} paragraphs`);
    }
  }
  
  if (!contentElement) {
    console.error('  ❌ Could not find main content area');
    return { content: '', images: [] };
  }
  
  // Track image sources by type for logging
  let imgTagCount = 0;
  let srcsetCount = 0;
  let cssContentCount = 0;
  let cssHeroCount = 0;
  let metaCount = 0;
  const images: string[] = [];
  
  // 1. Extract from <img> tags with lazy-load support
  const imgElements = contentElement.querySelectorAll('img');
  for (const img of imgElements) {
    const el = img as Element;
    // Try multiple src attributes (lazy-loading)
    const src = el.getAttribute('src') || 
                 el.getAttribute('data-src') || 
                 el.getAttribute('data-original') || 
                 el.getAttribute('data-lazy-src');
    const srcset = el.getAttribute('srcset');
    
    const srcLower = (src || '').toLowerCase();
    if (src && !srcLower.includes('logo') && !srcLower.includes('icon') && !srcLower.includes('sprite')) {
      images.push(src);
      imgTagCount++;
    } else if (srcset) {
      const srcsetUrl = pickFromSrcset(srcset);
      if (srcsetUrl) {
        images.push(srcsetUrl);
        srcsetCount++;
      }
    }
  }
  
  // 2. Extract from <picture> elements
  const pictureElements = contentElement.querySelectorAll('picture source[srcset]');
  for (const source of pictureElements) {
    const srcset = (source as Element).getAttribute('srcset');
    if (srcset) {
      const srcsetUrl = pickFromSrcset(srcset);
      if (srcsetUrl) {
        images.push(srcsetUrl);
        srcsetCount++;
      }
    }
  }
  
  // 3. Extract from CSS backgrounds INSIDE content
  const elementsWithBackground = contentElement.querySelectorAll('[style*="background"]');
  for (const el of elementsWithBackground) {
    const style = (el as Element).getAttribute('style') || '';
    const backgroundUrls = extractUrlsFromCssBackground(style);
    images.push(...backgroundUrls);
    cssContentCount += backgroundUrls.length;
  }
  
  // 4. Extract from CSS backgrounds OUTSIDE content (hero images)
  const heroSelectors = '.hero, [class*="hero"], [class*="featured"], .page-header, .entry-header, .post-thumbnail, .wp-post-image, .featured-image';
  const heroElements = doc.querySelectorAll(heroSelectors);
  for (const el of heroElements) {
    const style = (el as Element).getAttribute('style') || '';
    if (style.includes('background')) {
      const backgroundUrls = extractUrlsFromCssBackground(style);
      images.push(...backgroundUrls);
      cssHeroCount += backgroundUrls.length;
    }
  }
  
  // 5. Extract from meta tags (og:image, twitter:image)
  const metaSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'link[rel="image_src"]'
  ];
  for (const selector of metaSelectors) {
    const metaEl = doc.querySelector(selector);
    if (metaEl) {
      const content = metaEl.getAttribute('content') || metaEl.getAttribute('href');
      if (content && !content.toLowerCase().includes('logo')) {
        images.push(content);
        metaCount++;
      }
    }
  }
  
  // Deduplicate images
  const uniqueImages = Array.from(new Set(images));
  
  // Convert to markdown
  const content = htmlToMarkdown(contentElement.innerHTML);
  
  // Enhanced logging
  console.log(`  📄 Extracted ${content.length} chars, ${imgTagCount} <img> tags, ${srcsetCount} srcset/lazy, ${cssContentCount} CSS (content), ${cssHeroCount} CSS (hero), ${metaCount} meta, ${uniqueImages.length} total unique images`);
  
  return { content, images: uniqueImages };
}

// Download image and store in Supabase
async function downloadAndStoreImage(
  imageUrl: string, 
  artifactId: string, 
  imageIndex: number,
  supabase: any,
  baseUrl: string
): Promise<string | null> {
  try {
    console.log(`📥 Downloading image ${imageIndex}: ${imageUrl}`);
    
    // Handle relative URLs - resolve against base URL
    let fullImageUrl = imageUrl;
    if (imageUrl.startsWith('//')) {
      fullImageUrl = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
      try {
        fullImageUrl = new URL(imageUrl, baseUrl).href;
      } catch (e) {
        console.log('⚠️ Failed to resolve relative URL:', imageUrl);
        return null;
      }
    } else if (!imageUrl.startsWith('http')) {
      try {
        fullImageUrl = new URL(imageUrl, baseUrl).href;
      } catch (e) {
        console.log('⚠️ Failed to resolve relative URL:', imageUrl);
        return null;
      }
    }
    
    // Download image
    const imageResponse = await fetch(fullImageUrl);
    if (!imageResponse.ok) {
      console.error(`Failed to download image: ${imageResponse.status}`);
      return null;
    }
    
    // Get image data
    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Determine file extension
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const extension = contentType.split('/')[1]?.split(';')[0] || 'jpg';
    
    // Generate storage path
    const fileName = `${artifactId}_${imageIndex}.${extension}`;
    const storagePath = `artifacts/${fileName}`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('artifact-images')
      .upload(storagePath, uint8Array, {
        contentType,
        upsert: true
      });
    
    if (error) {
      console.error('Error uploading image to storage:', error);
      return null;
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('artifact-images')
      .getPublicUrl(storagePath);
    
    console.log(`✅ Stored image at: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    console.error('Error processing image:', error);
    return null;
  }
}

// Extract full content and images from article HTML fragment
function extractContentFromHtml(htmlFragment: string): { content: string; images: string[] } {
  const doc = new DOMParser().parseFromString(htmlFragment, 'text/html');
  if (!doc) return { content: '', images: [] };
  
  const images: string[] = [];
  
  // 1. Extract from <img> tags with lazy-load support
  const imgElements = doc.querySelectorAll('img');
  for (const img of imgElements) {
    const el = img as Element;
    // Try multiple src attributes (lazy-loading)
    const src = el.getAttribute('src') || 
                 el.getAttribute('data-src') || 
                 el.getAttribute('data-original') || 
                 el.getAttribute('data-lazy-src');
    const srcset = el.getAttribute('srcset');
    
    const srcLower = (src || '').toLowerCase();
    if (src && !srcLower.includes('logo') && !srcLower.includes('icon') && !srcLower.includes('sprite')) {
      images.push(src);
    } else if (srcset) {
      const srcsetUrl = pickFromSrcset(srcset);
      if (srcsetUrl) {
        images.push(srcsetUrl);
      }
    }
  }
  
  // 2. Extract from <picture> elements
  const pictureElements = doc.querySelectorAll('picture source[srcset]');
  for (const source of pictureElements) {
    const srcset = (source as Element).getAttribute('srcset');
    if (srcset) {
      const srcsetUrl = pickFromSrcset(srcset);
      if (srcsetUrl) {
        images.push(srcsetUrl);
      }
    }
  }
  
  // 3. Extract from CSS background properties
  const elementsWithBackground = doc.querySelectorAll('[style*="background"]');
  for (const el of elementsWithBackground) {
    const style = (el as Element).getAttribute('style') || '';
    const backgroundUrls = extractUrlsFromCssBackground(style);
    images.push(...backgroundUrls);
  }
  
  // Deduplicate images
  const uniqueImages = Array.from(new Set(images));
  
  // Extract content - use the entire fragment
  const htmlContent = doc.body?.innerHTML || htmlFragment;
  const markdownContent = htmlToMarkdown(htmlContent);
  
  return { content: markdownContent, images: uniqueImages };
}

// Helper function to parse Cherokee County style news pages
function parseCherokeeCountyNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const articles = doc.querySelectorAll('.newsContainerSide');
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector('.normalStoryTitle a');
    const dateElement = el.querySelector('[style*="font-size:10px"]');
    
    if (titleElement) {
      const title = titleElement.textContent?.trim() || '';
      const dateText = dateElement?.textContent?.trim() || '';
      
      console.log(`\n🔍 Examining title element for: ${title}`);
      console.log(`  - href: ${titleElement.getAttribute('href')}`);
      console.log(`  - onclick: ${titleElement.getAttribute('onclick')}`);
      console.log(`  - data-id: ${titleElement.getAttribute('data-id')}`);
      console.log(`  - data-story-id: ${titleElement.getAttribute('data-story-id')}`);
      console.log(`  - id: ${titleElement.getAttribute('id')}`);
      console.log(`  Parent element:`);
      console.log(`    - id: ${el.getAttribute('id')}`);
      console.log(`    - data-id: ${el.getAttribute('data-id')}`);
      console.log(`    - onclick: ${el.getAttribute('onclick')}`);
      
      // Extract storyID and build article URL
      const storyId = extractStoryId(titleElement, el);
      const baseUrl = new URL(sourceUrl).origin;
      const articleUrl = storyId 
        ? `${baseUrl}/Communications/media.php?storyID=${storyId}`
        : null;
      
      if (articleUrl) {
        console.log(`  ✅ Article URL: ${articleUrl}`);
      } else {
        console.log(`  ⚠️ No article URL - will use snippet`);
      }
      
      // Extract full content HTML from this article element
      const contentHtml = el.outerHTML;
      
      results.push({
        title,
        date: dateText,
        storyId,
        articleUrl,
        contentHtml,
        sourceUrl
      });
    }
  }

  return results;
}

// Helper function to parse Woodstock style news pages
function parseWoodstockNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const articles = doc.querySelectorAll('.news-list-item');
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector('.news-title');
    const dateElement = el.querySelector('.news-date');

    if (titleElement) {
      const title = titleElement.textContent?.trim() || '';
      const dateText = dateElement?.textContent?.trim() || '';
      
      // Extract full content HTML from this article element
      const contentHtml = el.outerHTML;

      results.push({
        title,
        date: dateText,
        storyId: null,
        articleUrl: null,
        contentHtml,
        sourceUrl
      });
    }
  }

  return results;
}

// Helper function to parse generic news pages (Phase 5: Enhanced)
function parseGenericNews(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  // Phase 1: Try specific selectors
  const specificSelectors = [
    'article', '.article', '.news-item', '.post',
    '[itemtype*="Article"]', '[class*="news"]',
    '[class*="post"]', '[id*="news"]'
  ];

  let articles: any = [];
  let usedSelector = '';
  
  for (const selector of specificSelectors) {
    articles = doc.querySelectorAll(selector);
    if (articles.length > 0) {
      usedSelector = selector;
      console.log(`✅ Found ${articles.length} articles using selector: ${selector}`);
      break;
    }
  }

  // Phase 2: If no articles found, look for repeating patterns
  if (articles.length === 0) {
    console.log('⚠️ No articles found with specific selectors, trying pattern detection...');
    const allDivs = doc.querySelectorAll('div[class], li[class]');
    const classCounts = new Map<string, Element[]>();
    
    for (const div of allDivs) {
      const className = (div as Element).getAttribute('class');
      if (className && typeof className === 'string') {
        const classes = className.split(' ')[0]; // Use first class only
        if (classes && classes.length > 2) {
          if (!classCounts.has(classes)) {
            classCounts.set(classes, []);
          }
          classCounts.get(classes)!.push(div as Element);
        }
      }
    }
    
    // Find classes that appear 3+ times
    for (const [className, elements] of classCounts) {
      if (elements.length >= 3) {
        articles = elements;
        usedSelector = `.${className}`;
        console.log(`✅ Found ${articles.length} repeating elements with class: ${className}`);
        break;
      }
    }
  }

  // Phase 3: Parse each article
  const results = [];

  for (const article of articles) {
    const el = article as Element;
    
    // Try multiple title selectors
    const titleSelectors = ['h1', 'h2', 'h3', '.title', '[class*="title"]', '[class*="headline"]'];
    let titleElement = null;
    for (const selector of titleSelectors) {
      titleElement = el.querySelector(selector);
      if (titleElement) break;
    }
    
    if (titleElement) {
      const title = titleElement.textContent?.trim() || '';
      
      // Try multiple date selectors
      const dateSelectors = ['time', '.date', '[class*="date"]', '[datetime]', '[class*="published"]'];
      let dateElement = null;
      for (const selector of dateSelectors) {
        dateElement = el.querySelector(selector);
        if (dateElement) break;
      }
      const dateText = dateElement?.textContent?.trim() || '';
      
      const contentHtml = el.outerHTML;

      results.push({
        title,
        date: dateText,
        storyId: null,
        articleUrl: null,
        contentHtml,
        sourceUrl
      });
    }
  }

  console.log(`📋 Extracted ${results.length} articles from ${usedSelector || 'unknown selector'}`);
  return results;
}

// Helper function to parse events from calendar pages
function parseEvents(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  // Look for event patterns in the HTML/text
  const results = [];
  const text = doc.body?.textContent || '';
  
  // Try to extract event data from text patterns
  const eventPattern = /([A-Z][^Date:]+)\s+Date:\s+([^Time:]+)\s+Time:\s+([^\n]+)/g;
  let match;
  
  while ((match = eventPattern.exec(text)) !== null) {
    const [, title, date, time] = match;
    if (title && date) {
      // Create HTML content for the event
      const contentHtml = `<div><h3>${title.trim()}</h3><p>Event on ${date.trim()} at ${time.trim()}</p></div>`;
      
      results.push({
        title: title.trim(),
        date: date.trim(),
        storyId: null,
        articleUrl: null,
        contentHtml,
        sourceUrl
      });
    }
  }

  return results;
}

// Helper to parse various date formats and check if within range
function isDateInRange(dateStr: string, dateFrom: string, dateTo: string): boolean {
  // If no date provided, EXCLUDE the article (strict filtering)
  if (!dateStr) {
    return false;
  }
  
  try {
    // Try to parse the date string
    const articleDate = new Date(dateStr);
    const fromDate = new Date(dateFrom);
    const toDate = new Date(dateTo);
    
    // Check if valid date and within range
    if (isNaN(articleDate.getTime())) {
      console.log(`  ⚠️ Invalid date format: ${dateStr}, EXCLUDING`);
      return false;
    }
    
    const inRange = articleDate >= fromDate && articleDate <= toDate;
    return inRange;
  } catch {
    console.log(`  ⚠️ Error parsing date: ${dateStr}, EXCLUDING`);
    return false; // Exclude on error
  }
}

// Helper to normalize URLs (convert relative to absolute)
function normalizeUrl(url: string, baseUrl: string): string {
  try {
    // If already absolute, return as-is
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    // Convert relative to absolute
    const base = new URL(baseUrl);
    const absoluteUrl = new URL(url, base.origin).toString();
    return absoluteUrl;
  } catch (error) {
    console.log(`  ⚠️ Failed to normalize URL: ${url}`);
    return url;
  }
}

// Extract date from background image timestamp (e.g., t=202511071254300)
function extractDateFromImageTimestamp(el: Element): string | null {
  try {
    const style = el.getAttribute('style') || '';
    const urlMatch = style.match(/background[^:]*:url\(['"]?([^'")]+)['"]?\)/);
    if (!urlMatch) return null;
    
    const url = urlMatch[1];
    const timestampMatch = url.match(/[?&]t=(\d{8,})/);
    if (!timestampMatch) return null;
    
    const timestamp = timestampMatch[1];
    // Parse YYYYMMDD[HHmmss]
    if (timestamp.length >= 8) {
      const year = timestamp.substring(0, 4);
      const month = timestamp.substring(4, 6);
      const day = timestamp.substring(6, 8);
      const hour = timestamp.length >= 10 ? timestamp.substring(8, 10) : '00';
      const minute = timestamp.length >= 12 ? timestamp.substring(10, 12) : '00';
      const second = timestamp.length >= 14 ? timestamp.substring(12, 14) : '00';
      
      const dateStr = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
      const date = new Date(dateStr);
      
      if (!isNaN(date.getTime())) {
        console.log(`   📅 Found date via image timestamp: ${date.toISOString()}`);
        return date.toISOString();
      }
    }
  } catch (error) {
    console.log(`   ⚠️ Error parsing image timestamp:`, error);
  }
  return null;
}

// Helper to parse common date formats from text
function parseDateFromText(text: string): string | null {
  // Pattern 1: Month Day, Year (e.g., "October 8, 2025")
  const monthDayYearPattern = /([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/;
  const monthMatch = text.match(monthDayYearPattern);
  if (monthMatch) {
    try {
      const parsed = new Date(monthMatch[1]);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
  
  // Pattern 2: MM/DD/YYYY
  const slashPattern = /(\d{1,2}\/\d{1,2}\/\d{4})/;
  const slashMatch = text.match(slashPattern);
  if (slashMatch) {
    try {
      const parsed = new Date(slashMatch[1]);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    } catch (e) {
      // Continue to next pattern
    }
  }
  
  // Pattern 3: YYYY-MM-DD
  const isoPattern = /(\d{4}-\d{2}-\d{2})/;
  const isoMatch = text.match(isoPattern);
  if (isoMatch) {
    try {
      const parsed = new Date(isoMatch[1]);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    } catch (e) {
      // Continue
    }
  }
  
  return null;
}

// Extract date from detail page HTML
async function extractDateFromDetailPage(articleUrl: string, config: any, sourceUrl: string): Promise<string | null> {
  try {
    console.log(`   📡 Fetching detail page for date: ${articleUrl}`);
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });
    
    if (!response.ok) {
      console.log(`   ⚠️ Failed to fetch detail page: ${response.status}`);
      return null;
    }
    
    // Fallback A: Try Last-Modified header
    const lastModified = response.headers.get('last-modified');
    if (lastModified) {
      try {
        const parsed = new Date(lastModified);
        if (!isNaN(parsed.getTime())) {
          console.log(`   📅 Found date via Last-Modified header: ${lastModified}`);
          return parsed.toISOString();
        }
      } catch (e) {
        // Continue to other methods
      }
    }
    
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) return null;
    
    // Try custom selector first if provided
    const customSelector = config?.detailPage?.date;
    if (customSelector) {
      const dateEl = doc.querySelector(customSelector);
      if (dateEl) {
        const dateText = dateEl.textContent?.trim() || dateEl.getAttribute('datetime') || dateEl.getAttribute('content') || '';
        if (dateText) {
          console.log(`   📅 Found detail page date via custom selector "${customSelector}": ${dateText}`);
          return dateText;
        }
      }
    }
    
    // Robust default selectors
    const defaultSelectors = [
      'time[datetime]',
      'meta[property*="published_time"]',
      'meta[property*="article:published"]',
      'meta[name*="publish"]',
      'meta[itemprop*="datePublished"]',
      '.date',
      '[class*="date"]',
      '[class*="published"]',
      '[itemprop*="datePublished"]'
    ];
    
    for (const selector of defaultSelectors) {
      const dateEl = doc.querySelector(selector);
      if (dateEl) {
        const dateText = dateEl.getAttribute('datetime') || 
                        dateEl.getAttribute('content') || 
                        dateEl.textContent?.trim() || '';
        if (dateText && dateText.length > 0 && dateText.length < 100) {
          console.log(`   📅 Found detail page date via "${selector}": ${dateText}`);
          return dateText;
        }
      }
    }
    
    // Fallback B: Try regex on visible text
    // Look for main content first
    const contentSelectors = ['main', '#main', '[id*="content"]', '[class*="content"]', 'article', '.article'];
    let textToSearch = '';
    
    for (const selector of contentSelectors) {
      const contentEl = doc.querySelector(selector);
      if (contentEl) {
        textToSearch = contentEl.textContent?.substring(0, 2000) || ''; // First 2000 chars
        break;
      }
    }
    
    // Fallback to body if no content container found
    if (!textToSearch) {
      textToSearch = doc.body?.textContent?.substring(0, 2000) || '';
    }
    
    if (textToSearch) {
      const dateFromText = parseDateFromText(textToSearch);
      if (dateFromText) {
        console.log(`   📅 Found date via body text regex`);
        return dateFromText;
      }
    }
    
    // Fallback C: Image timestamp heuristic from detail page
    const allElements = doc.querySelectorAll('[style*="background"]');
    for (const el of allElements) {
      const dateFromImage = extractDateFromImageTimestamp(el as Element);
      if (dateFromImage) {
        console.log(`   📅 Found date via image timestamp on detail page`);
        return dateFromImage;
      }
    }
    
    console.log(`   ⚠️ No date found after all strategies`);
    return null;
  } catch (error) {
    console.log(`   ⚠️ Error fetching detail page:`, error);
    return null;
  }
}

// Enrich articles with dates from detail pages
async function enrichArticleDatesByDetailPage(
  articles: any[], 
  config: any, 
  sourceUrl: string, 
  maxToEnrich: number,
  supabase: any,
  historyId?: string
): Promise<void> {
  const undatedArticles = articles.filter(a => !a.date);
  const toEnrich = undatedArticles.slice(0, Math.min(undatedArticles.length, maxToEnrich));
  
  if (toEnrich.length === 0) {
    console.log(`✅ All articles already have dates, no enrichment needed`);
    return;
  }
  
  console.log(`🔄 Enriching dates for ${toEnrich.length} articles (max: ${maxToEnrich})...`);
  
  for (let i = 0; i < toEnrich.length; i++) {
    const article = toEnrich[i];
    
    // Check cancellation
    if (historyId) {
      const { data: statusCheck } = await supabase
        .from('query_history')
        .select('status')
        .eq('id', historyId)
        .single();
      
      if (statusCheck?.status === 'failed') {
        console.log('⚠️ Query cancelled during date enrichment');
        return;
      }
    }
    
    // Try to fetch date from detail page
    if (article.articleUrl) {
      const detailDate = await extractDateFromDetailPage(article.articleUrl, config, sourceUrl);
      if (detailDate) {
        article.date = detailDate;
        console.log(`   ✅ Enriched date for "${article.title.substring(0, 40)}..."`);
      }
    }
    
    // Small delay between requests
    if (i < toEnrich.length - 1) {
      await sleep(Math.floor(Math.random() * 300) + 200); // 200-500ms
    }
  }
  
  const enrichedCount = toEnrich.filter(a => a.date).length;
  console.log(`✅ Date enrichment complete: ${enrichedCount}/${toEnrich.length} articles now have dates`);
}

// Parse with custom configuration
function parseWithConfig(html: string, sourceUrl: string, config: any) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return [];

  const { selectors } = config;
  const articles = doc.querySelectorAll(selectors.container);
  const results = [];

  console.log(`🔧 Using custom parser config with selector: ${selectors.container}`);
  if (selectors.date) console.log(`   Date selector: ${selectors.date}`);
  console.log(`   Found ${articles.length} container elements`);

  for (const article of articles) {
    const el = article as Element;
    const titleElement = el.querySelector(selectors.title);
    let dateElement = selectors.date ? el.querySelector(selectors.date) : null;
    const linkElement = selectors.link ? el.querySelector(selectors.link) : null;

    if (titleElement) {
      const title = titleElement.textContent?.trim() || '';
      let dateText = dateElement?.textContent?.trim() || '';
      
      // Try image timestamp heuristic if no date found
      if (!dateText) {
        dateText = extractDateFromImageTimestamp(el) || '';
      }
      
      // Fallback: Look for date patterns in direct children
      if (!dateText) {
        const directChildren = Array.from(el.children);
        for (const child of directChildren) {
          const text = (child as Element).textContent?.trim() || '';
          const datePattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$/i;
          if (datePattern.test(text) && text.length < 50) {
            dateText = text;
            console.log(`   📅 Found date pattern "${dateText}" for "${title.substring(0, 40)}..."`);
            break;
          }
        }
      }
      
      if (dateText) {
        console.log(`   📅 Found date "${dateText}" for "${title.substring(0, 40)}..."`);
      }
      
      // Link fallback: use container's href if no linkElement found
      let articleUrl = linkElement?.getAttribute('href') || null;
      if (!articleUrl && el.tagName.toLowerCase() === 'a') {
        articleUrl = el.getAttribute('href') || null;
        if (articleUrl) {
          console.log(`   🔗 Using container href as link for "${title.substring(0, 40)}..."`);
        }
      }
      
      if (articleUrl) {
        articleUrl = normalizeUrl(articleUrl, sourceUrl);
      }
      
      results.push({
        title,
        date: dateText,
        storyId: null,
        articleUrl,
        contentHtml: el.outerHTML,
        sourceUrl
      });
    }
  }

  console.log(`✅ Parsed ${results.length} articles using custom config`);
  return results;
}

// Main function to fetch and parse content from a source
async function fetchAndParseSource(source: any, dateFrom: string, dateTo: string, maxArticles: number | null, supabase: any, historyId?: string) {
  try {
    console.log(`\n🔍 Fetching content from: ${source.url}`);
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch ${source.url}: ${response.status}`);
      return [];
    }

    const html = await response.text();
    let parsedArticles = [];
    let parserUsed = 'unknown';

    // Phase 4: Check if source has parser_config first
    if (source.parser_config && source.parser_config.selectors) {
      console.log(`✅ Using custom parser config for ${source.name}`);
      parsedArticles = parseWithConfig(html, source.url, source.parser_config);
      parserUsed = 'custom';
    } else {
      // Fall back to URL-based detection (existing logic)
      if (source.url.includes('cherokeecountyga.gov')) {
        parsedArticles = parseCherokeeCountyNews(html, source.url);
        parserUsed = 'cherokee';
      } else if (source.url.includes('woodstockga.gov/newslist')) {
        parsedArticles = parseWoodstockNews(html, source.url);
        parserUsed = 'woodstock';
      } else if (source.url.includes('/events')) {
        parsedArticles = parseEvents(html, source.url);
        parserUsed = 'events';
      } else if (source.url.includes('cherokeecountyfire.org') || 
                 source.url.includes('cherokeek12.net') || 
                 source.url.includes('cherokeega.org')) {
        parsedArticles = parseGenericNews(html, source.url);
        parserUsed = 'generic';
      } else {
        parsedArticles = parseGenericNews(html, source.url);
        parserUsed = 'generic';
      }
    }

    console.log(`📊 Parser Results for ${source.name}:`);
    console.log(`   - Articles found: ${parsedArticles.length}`);
    console.log(`   - Parser used: ${parserUsed}`);
    
    // Phase 4: Diagnostic info for 0 articles
    if (parsedArticles.length === 0) {
      console.warn(`⚠️ No articles found for ${source.name}`);
      console.warn(`   Suggestion: Run source analysis to detect proper selectors`);
      console.log(`   HTML preview (first 500 chars): ${html.substring(0, 500)}...`);
    }

    console.log(`📋 Found ${parsedArticles.length} articles from ${source.name}`);
    
    // ⚡ NEW: Enrich dates from detail pages BEFORE date filtering
    const enrichCap = maxArticles || 15;
    await enrichArticleDatesByDetailPage(
      parsedArticles, 
      source.parser_config, 
      source.url, 
      enrichCap,
      supabase,
      historyId
    );
    
    // NOW apply date filtering after enrichment
    console.log(`🔍 Filtering articles by date range (${dateFrom} to ${dateTo})...`);
    const dateFilteredArticles = parsedArticles.filter(article => {
      if (!article.date) {
        console.log(`  ⏭️  Skipping "${article.title.substring(0, 40)}..." - no date found`);
        return false;
      }
      
      const inRange = isDateInRange(article.date, dateFrom, dateTo);
      if (!inRange) {
        console.log(`  ⏭️  Skipping "${article.title.substring(0, 40)}..." - outside date range (${article.date})`);
      }
      return inRange;
    });
    
    console.log(`✅ After date filter: ${dateFilteredArticles.length} articles (from ${parsedArticles.length} total)`);
    
    // Apply article limit if specified
    let articlesToProcess = dateFilteredArticles;
    if (maxArticles && maxArticles > 0 && dateFilteredArticles.length > maxArticles) {
      articlesToProcess = dateFilteredArticles.slice(0, maxArticles);
      console.log(`📊 Limited to first ${maxArticles} articles for testing`);
    }
    
    console.log(`🚀 Processing ${articlesToProcess.length} articles...`);
    
    // Process each article's content
    const fullArticles = [];
    for (let i = 0; i < articlesToProcess.length; i++) {
      const article = articlesToProcess[i];
      
      // Check if query was cancelled before processing each article
      if (historyId) {
        const { data: statusCheck } = await supabase
          .from('query_history')
          .select('status')
          .eq('id', historyId)
          .single();
        
        if (statusCheck?.status === 'failed') {
          console.log('⚠️ Query cancelled, stopping article processing');
          break;
        }
      }
      
      // Apply human delay between processing
      if (i > 0) {
        await randomDelay(500, 500);
      }
      
      console.log(`\n📰 Processing article ${i + 1}/${articlesToProcess.length}: ${article.title}`);
      
      let content = '';
      let images: string[] = [];
      
      // Try to fetch full article if we have an articleUrl
      if (article.articleUrl) {
        console.log(`  📡 Fetching full article from: ${article.articleUrl}`);
        try {
          const articleResponse = await fetch(article.articleUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
            }
          });
          
          if (articleResponse.ok) {
            const fullHtml = await articleResponse.text();
            const extracted = extractFullArticleContent(fullHtml, source.url);
            content = extracted.content;
            images = extracted.images;
            console.log(`  ✅ Fetched full article: ${content.length} chars`);
          } else {
            console.log(`  ⚠️ Failed to fetch article (${articleResponse.status}), using snippet`);
            const extracted = extractContentFromHtml(article.contentHtml);
            content = extracted.content;
            images = extracted.images;
          }
        } catch (fetchError) {
          console.log(`  ⚠️ Error fetching article, using snippet:`, fetchError);
          const extracted = extractContentFromHtml(article.contentHtml);
          content = extracted.content;
          images = extracted.images;
        }
      } else {
        // No URL found - fall back to snippet extraction
        console.log(`  ⚠️ No article URL found, using snippet`);
        const extracted = extractContentFromHtml(article.contentHtml);
        content = extracted.content;
        images = extracted.images;
      }
      
      if (content) {
        // Generate UUID for artifact GUID and readable name
        const artifactGuid = crypto.randomUUID();
        const artifactName = `${source.name.replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        console.log(`📄 Content length: ${content.length} chars, Images found: ${images.length}`);
        
        // Download and store images, replace URLs in content
        let finalContent = content;
        const imageMap = new Map();
        
        for (let imgIndex = 0; imgIndex < images.length && imgIndex < 10; imgIndex++) {
          await randomDelay(200, 500); // Minimal delay between image downloads
          const supabaseUrl = await downloadAndStoreImage(images[imgIndex], artifactGuid, imgIndex, supabase, source.url);
          if (supabaseUrl) {
            imageMap.set(images[imgIndex], supabaseUrl);
          }
        }
        
        console.log(`✅ Stored ${imageMap.size} images`);
        
        // Replace image URLs in markdown content
        for (const [originalUrl, supabaseUrl] of imageMap.entries()) {
          finalContent = finalContent.replace(new RegExp(originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), supabaseUrl);
        }
        
        fullArticles.push({
          artifactGuid,
          artifactName,
          title: article.title,
          content: finalContent,
          date: article.date,
          imageCount: imageMap.size,
          sourceUrl: article.sourceUrl,
          images: Array.from(imageMap.entries()).map(([original, stored]) => ({
            original_url: original,
            stored_url: stored
          }))
        });
      }
    }

    console.log(`\n✅ Successfully processed ${fullArticles.length} full articles from ${source.name}`);
    return fullArticles;
  } catch (error) {
    console.error(`❌ Error fetching/parsing ${source.url}:`, error);
    return [];
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages,
      historyId,
      maxArticles = null
    } = await req.json();

    console.log('Starting manual query run:', {
      dateFrom,
      dateTo,
      sourceIds,
      environment,
      promptVersionId,
      runStages,
      maxArticles
    });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const isTest = environment === 'test';
    let artifactsCount = 0;
    let storiesCount = 0;

    // Stage 1: Fetch sources and create artifacts
    console.log('Stage 1: Fetching sources and creating artifacts...');
    
    // Get source details
    const { data: sources, error: sourcesError } = await supabase
      .from('sources')
      .select('*')
      .in('id', sourceIds);

    if (sourcesError) throw sourcesError;

    // Fetch and parse real content from sources
    for (const source of sources) {
      // Check if query was cancelled before processing this source
      const { data: historyCheck } = await supabase
        .from('query_history')
        .select('status')
        .eq('id', historyId)
        .single();
      
      if (historyCheck?.status === 'failed') {
        console.log('⚠️ Query cancelled by user, stopping execution');
        return new Response(
          JSON.stringify({
            success: false,
            message: 'Query was cancelled by user',
            artifactsCount,
            storiesCount
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      const articles = await fetchAndParseSource(source, dateFrom, dateTo, maxArticles, supabase, historyId);
      
      console.log(`Total articles processed: ${articles.length} from ${source.name}`);
      
      if (articles.length === 0) {
        console.log(`No articles in date range for ${source.name}`);
        continue;
      }

      // Create artifacts from articles (already filtered)
      const artifactsToInsert = articles.map(article => ({
        guid: article.artifactGuid,
        name: article.artifactName,
        title: article.title,
        type: source.type,
        content: article.content,
        size_mb: new Blob([article.content]).size / (1024 * 1024),
        source_id: source.id,
        date: article.date ? new Date(article.date).toISOString() : new Date().toISOString(),
        is_test: isTest,
        images: article.images || []
      }));

      const { error: insertError } = await supabase
        .from('artifacts')
        .insert(artifactsToInsert);

      if (insertError) {
        console.error('Error inserting artifacts:', insertError);
      } else {
        artifactsCount += artifactsToInsert.length;
        console.log(`Created ${artifactsToInsert.length} artifacts from ${source.name}`);
      }

      // Update source's last_fetch_at
      await supabase
        .from('sources')
        .update({
          last_fetch_at: new Date().toISOString(),
          items_fetched: articles.length
        })
        .eq('id', source.id);
    }

    console.log(`Stage 1 complete: Created ${artifactsCount} artifacts`);

    // Stage 2: Generate stories using AI (if requested)
    if (runStages === 'both') {
      console.log('Stage 2: Generating stories with AI...');

      // Get prompt version
      const { data: promptVersion, error: promptError } = await supabase
        .from('prompt_versions')
        .select('*')
        .eq('id', promptVersionId)
        .single();

      if (promptError) throw promptError;

      // Get recent artifacts to generate stories from
      const { data: recentArtifacts, error: artifactsError } = await supabase
        .from('artifacts')
        .select('*')
        .in('source_id', sourceIds)
        .order('created_at', { ascending: false })
        .limit(10);

      if (artifactsError) throw artifactsError;

      // Generate stories from artifacts using AI
      for (const artifact of recentArtifacts) {
        const aiPrompt = `${promptVersion.content}\n\nSource material:\nTitle: ${artifact.title}\nContent: ${artifact.content}\n\nGenerate a news article based on this source material.`;

        try {
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: 'You are a professional news article writer.' },
                { role: 'user', content: aiPrompt }
              ],
            }),
          });

          if (!aiResponse.ok) {
            if (aiResponse.status === 429) {
              console.error('Rate limit exceeded');
              continue;
            }
            if (aiResponse.status === 402) {
              console.error('Payment required - out of credits');
              break;
            }
            throw new Error(`AI API error: ${aiResponse.status}`);
          }

          const aiData = await aiResponse.json();
          const generatedContent = aiData.choices[0].message.content;

          // Create story
          const { data: newStory, error: storyError } = await supabase
            .from('stories')
            .insert({
              title: artifact.title,
              content: generatedContent,
              status: 'pending',
              is_test: isTest,
              environment,
              article_type: 'full',
              prompt_version_id: promptVersion.version_name,
              source_id: artifact.source_id
            })
            .select()
            .single();

          if (storyError) {
            console.error('Error creating story:', storyError);
            continue;
          }

          // Link artifact to story
          await supabase
            .from('story_artifacts')
            .insert({
              story_id: newStory.id,
              artifact_id: artifact.id
            });

          storiesCount++;
          console.log(`Created story: ${newStory.title}`);
        } catch (aiError) {
          console.error('Error generating story with AI:', aiError);
        }
      }

      console.log(`Stage 2 complete: Generated ${storiesCount} stories`);
    }

    // Update query history
    const { error: historyError } = await supabase
      .from('query_history')
      .update({
        status: 'completed',
        artifacts_count: artifactsCount,
        stories_count: storiesCount,
        completed_at: new Date().toISOString()
      })
      .eq('id', historyId);

    if (historyError) {
      console.error('Error updating history:', historyError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        artifactsCount,
        storiesCount,
        message: `Successfully completed. Created ${artifactsCount} artifacts${runStages === 'both' ? ` and ${storiesCount} stories` : ''}.`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in run-manual-query:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
