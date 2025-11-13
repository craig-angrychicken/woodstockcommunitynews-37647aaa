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

  // Determine Browserless URLs to try
  const envUrl = Deno.env.get('BROWSERLESS_URL');
  const DEFAULT_URLS = [
    'https://chrome.browserless.io',
    'https://production-sfo.browserless.io'
  ];
  
  const urlsToTry = envUrl ? [envUrl, ...DEFAULT_URLS] : DEFAULT_URLS;
  
  console.log(`🔗 Will try Browserless URL: ${urlsToTry[0]}`);
  console.log(`📍 Selector: ${config.containerSelector}`);

  let lastError: Error | null = null;
  let html = '';

  // Try each URL until one succeeds
  for (let i = 0; i < urlsToTry.length; i++) {
    const browserlessUrl = urlsToTry[i];
    
    if (i > 0) {
      console.log(`🔄 Retrying with: ${browserlessUrl}`);
    }

    try {
      // Fetch fully-rendered HTML using Browserless /content endpoint
      // Token must be passed as query parameter per Browserless documentation
      const response = await fetch(`${browserlessUrl}/content?token=${browserlessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({
          url,
          waitForSelector: {
            selector: config.containerSelector,
            timeout: 10000
          },
          gotoOptions: {
            waitUntil: 'networkidle2',
            timeout: 30000
          }
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorPreview = errorText.substring(0, 300);
        console.error(`❌ Browserless ${response.status} from ${browserlessUrl}:`);
        console.error(`   Selector: ${config.containerSelector}`);
        console.error(`   Response: ${errorPreview}`);
        
        // If this is retriable error and we have more URLs, continue to next
        if (i < urlsToTry.length - 1 && [400, 401, 403, 500, 502, 503, 504].includes(response.status)) {
          lastError = new Error(`Browserless ${response.status}: ${errorPreview}`);
          continue;
        }
        
        throw new Error(`Browserless request failed: ${response.status} ${errorPreview}`);
      }

      html = await response.text();
      console.log(`✅ Retrieved ${html.length} characters of HTML from ${browserlessUrl}`);
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
  console.log(`✅ Retrieved ${html.length} characters of HTML`);

  // Parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  if (!doc) {
    throw new Error('Failed to parse HTML document');
  }

  // Find all article containers using the configured selector
  const containers = doc.querySelectorAll(config.containerSelector);
  console.log(`✅ Found ${containers.length} article containers`);

  if (containers.length === 0) {
    console.log(`⚠️ No containers found with selector: ${config.containerSelector}`);
    return [];
  }

  // Extract article data from each container
  const articles: Article[] = [];
  
  for (const container of Array.from(containers) as Element[]) {
    try {
      // Extract title
      const titleEl = container.querySelector(config.titleSelector);
      const title = titleEl?.textContent?.trim() || '';
      
      if (!title) {
        console.log(`⚠️ Skipping container - no title found`);
        continue;
      }

      // Extract link
      const linkEl = container.querySelector(config.linkSelector) as Element;
      let articleUrl = linkEl?.getAttribute('href') || '';
      
      // Make relative URLs absolute
      if (articleUrl && !articleUrl.startsWith('http')) {
        const baseUrl = new URL(url);
        articleUrl = new URL(articleUrl, baseUrl.origin).href;
      }

      // Extract date
      const dateEl = container.querySelector(config.dateSelector);
      const date = dateEl?.textContent?.trim() || '';

      // Extract image (optional)
      let imageUrl = '';
      if (config.imageSelector) {
        const imgEl = container.querySelector(config.imageSelector) as Element;
        imageUrl = imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || '';
        
        // Make relative URLs absolute
        if (imageUrl && !imageUrl.startsWith('http')) {
          const baseUrl = new URL(url);
          imageUrl = new URL(imageUrl, baseUrl.origin).href;
        }
      }

      // Extract content (optional)
      let content = '';
      if (config.contentSelector) {
        const contentEl = container.querySelector(config.contentSelector);
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
