import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

interface ScrapeConfig {
  containerSelector: string;
  titleSelector: string;
  linkSelector: string;
  dateSelector: string;
  imageSelector?: string;
  contentSelector?: string;
}

interface Article {
  title: string;
  url: string;
  date: string;
  imageUrl?: string;
  content?: string;
}

export async function scrapeArticlesSimple(
  url: string,
  config: ScrapeConfig,
  browserlessToken: string
): Promise<Article[]> {
  console.log(`\n📰 Fetching fully-rendered HTML from: ${url}`);

  // Determine Browserless URLs to try (production-sfo preferred for stability)
  const envUrl = Deno.env.get('BROWSERLESS_URL');
  const DEFAULT_URLS = [
    'https://production-sfo.browserless.io',
    'https://chrome.browserless.io'
  ];
  
  const urlsToTry = envUrl ? [envUrl, ...DEFAULT_URLS] : DEFAULT_URLS;
  
  console.log(`🔗 Will try Browserless URL: ${urlsToTry[0]}`);
  console.log(`📍 Container Selector: ${config.containerSelector}`);
  console.log(`⏱️ Using /content endpoint to fetch fully-rendered HTML`);

  let lastError: Error | null = null;
  let html = '';

  // Try each URL until one succeeds
  for (let i = 0; i < urlsToTry.length; i++) {
    const browserlessUrl = urlsToTry[i];
    
    if (i > 0) {
      console.log(`🔄 Retrying with: ${browserlessUrl}`);
    }

    try {
      const response = await fetch(`${browserlessUrl}/content?token=${browserlessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          url,
          gotoOptions: {
            waitUntil: 'networkidle2',
            timeout: 90000
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorPreview = errorText.substring(0, 300);
        console.error(`❌ Browserless ${response.status} from ${browserlessUrl}:`);
        console.error(`   Response: ${errorPreview}`);
        
        // If this is retriable error and we have more URLs, continue to next
        if (i < urlsToTry.length - 1 && [400, 401, 403, 500, 502, 503, 504].includes(response.status)) {
          lastError = new Error(`Browserless ${response.status}: ${errorPreview}`);
          continue;
        }
        
        throw new Error(`Browserless request failed: ${response.status} ${errorPreview}`);
      }

      html = await response.text();
      console.log(`✅ Retrieved HTML: ${html.length} characters from ${browserlessUrl}`);
      
      // Diagnostic: Check if selector appears in raw HTML
      const selectorInHtml = html.includes(config.containerSelector.replace('.', '').replace('#', ''));
      console.log(`🔍 Selector pattern "${config.containerSelector}" found in HTML: ${selectorInHtml}`);
      
      // Show snippet around where we expect containers
      const snippetStart = Math.max(0, html.indexOf('news') - 200);
      const snippetEnd = Math.min(html.length, snippetStart + 600);
      console.log(`📄 HTML snippet:\n${html.substring(snippetStart, snippetEnd)}`);
      
      break; // Success, exit retry loop
      
    } catch (error) {
      lastError = error as Error;
      
      // If we have more URLs to try, continue
      if (i < urlsToTry.length - 1) {
        console.log(`⚠️ Attempt failed: ${lastError.message}`);
        continue;
      }
      
      // No more URLs to try, throw the error
      throw error;
    }
  }

  if (!html && lastError) {
    throw lastError;
  }

  if (!html) {
    console.log(`⚠️ No HTML retrieved`);
    return [];
  }

  // Parse the full HTML locally with deno-dom
  console.log(`\n🔍 Parsing HTML with deno-dom...`);
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  if (!doc) {
    console.log(`❌ DOMParser failed to parse HTML`);
    return [];
  }

  // Find containers using querySelectorAll
  const containerElements = doc.querySelectorAll(config.containerSelector);
  console.log(`✅ Found ${containerElements.length} containers matching "${config.containerSelector}"`);

  if (containerElements.length === 0) {
    console.log(`⚠️ No containers found with selector: ${config.containerSelector}`);
    return [];
  }

  // Extract articles from each container (max 20)
  const articles: Article[] = [];
  const containersToProcess = Array.from(containerElements).slice(0, 20);
  
  for (const containerEl of containersToProcess) {
    const containerHtml = (containerEl as Element).outerHTML;
    const fragDoc = parser.parseFromString(containerHtml, 'text/html');
    if (!fragDoc) continue;
    
    try {
      // Extract title
      const titleEl = fragDoc.querySelector(config.titleSelector);
      const title = titleEl?.textContent?.trim() || '';
      
      if (!title) {
        console.log(`⚠️ Skipping container - no title found`);
        continue;
      }

      // Extract link
      const linkEl = fragDoc.querySelector(config.linkSelector) as Element;
      let articleUrl = linkEl?.getAttribute('href') || '';
      
      if (!articleUrl) {
        console.log(`⚠️ Skipping container - no link found`);
        continue;
      }
      
      // Make relative URLs absolute
      if (!articleUrl.startsWith('http')) {
        const baseUrl = new URL(url);
        articleUrl = new URL(articleUrl, baseUrl.origin).href;
      }

      // Extract date
      const dateEl = fragDoc.querySelector(config.dateSelector);
      const date = dateEl?.textContent?.trim() || '';

      // Extract image (from img tag or background-image style)
      let imageUrl = '';
      if (config.imageSelector) {
        const imgEl = fragDoc.querySelector(config.imageSelector) as Element;
        imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
        
        // Also check for background-image in style attribute
        if (!imageUrl) {
          const styleAttr = imgEl?.getAttribute('style') || '';
          const bgMatch = styleAttr.match(/url\(['"]?([^'"]+)['"]?\)/);
          if (bgMatch) imageUrl = bgMatch[1];
        }
        
        // Make relative URLs absolute
        if (imageUrl && !imageUrl.startsWith('http')) {
          const baseUrl = new URL(url);
          imageUrl = new URL(imageUrl, baseUrl.origin).href;
        }
      }

      // Extract content (optional)
      let content = '';
      if (config.contentSelector) {
        const contentEl = fragDoc.querySelector(config.contentSelector);
        content = contentEl?.textContent?.trim() || '';
      }

      articles.push({
        title,
        url: articleUrl,
        date,
        imageUrl: imageUrl || undefined,
        content: content || undefined,
      });

      console.log(`  ✅ Extracted: "${title}" (${date})`);
    } catch (error) {
      console.error(`  ❌ Error extracting article:`, error);
    }
  }

  console.log(`\n✅ Successfully extracted ${articles.length} articles`);
  return articles;
}
