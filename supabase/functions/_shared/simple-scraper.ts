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
  console.log(`⏱️ Using /scrape endpoint with elements extraction`);

  let lastError: Error | null = null;
  let containerResults: any[] = [];

  // Try each URL until one succeeds
  for (let i = 0; i < urlsToTry.length; i++) {
    const browserlessUrl = urlsToTry[i];
    
    if (i > 0) {
      console.log(`🔄 Retrying with: ${browserlessUrl}`);
    }

    try {
      const requestBody = {
        url,
        elements: [{ selector: config.containerSelector, timeout: 30000 }],
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 60000
        }
      };

      const response = await fetch(`${browserlessUrl}/scrape?token=${browserlessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(requestBody),
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

      const result = await response.json();
      containerResults = result?.data?.[0]?.results || [];
      console.log(`✅ Found ${containerResults.length} article containers from ${browserlessUrl}`);
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

  if (containerResults.length === 0 && lastError) {
    throw lastError;
  }

  if (containerResults.length === 0) {
    console.log(`⚠️ No containers found with selector: ${config.containerSelector}`);
    return [];
  }

  // Extract articles from each container
  const parser = new DOMParser();
  const articles: Article[] = [];
  
  for (const containerResult of containerResults) {
    const fragDoc = parser.parseFromString(containerResult.html || '', 'text/html');
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
