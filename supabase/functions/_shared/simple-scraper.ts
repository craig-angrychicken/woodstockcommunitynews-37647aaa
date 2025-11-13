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
  console.log(`📍 Selector: ${config.containerSelector}`);
  console.log(`⏱️ Timeouts: waitForSelector=30s, gotoOptions=60s`);

  let lastError: Error | null = null;
  let html = '';

  // Try each URL until one succeeds
  for (let i = 0; i < urlsToTry.length; i++) {
    const browserlessUrl = urlsToTry[i];
    
    if (i > 0) {
      console.log(`🔄 Retrying with: ${browserlessUrl}`);
    }

    // Attempt A: Try with waitForSelector
    try {
      const requestBody = {
        url,
        waitForSelector: {
          selector: config.containerSelector,
          timeout: 30000
        },
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 60000
        }
      };

      const response = await fetch(`${browserlessUrl}/content?token=${browserlessToken}`, {
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
        console.error(`   Selector: ${config.containerSelector}`);
        console.error(`   Response: ${errorPreview}`);
        
        // Check if this is a selector timeout error
        const isSelectorTimeout = errorPreview.includes('Waiting for selector') || 
                                  errorPreview.includes('TimeoutError');
        
        if (isSelectorTimeout) {
          // Attempt B: Retry same URL without waitForSelector
          console.log(`⚠️ Selector timeout detected, retrying without waitForSelector on ${browserlessUrl}`);
          
          try {
            const fallbackBody = {
              url,
              gotoOptions: {
                waitUntil: 'networkidle2',
                timeout: 60000
              }
            };

            const fallbackResponse = await fetch(`${browserlessUrl}/content?token=${browserlessToken}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
              },
              body: JSON.stringify(fallbackBody),
            });

            if (!fallbackResponse.ok) {
              const fallbackError = await fallbackResponse.text();
              console.error(`❌ Fallback also failed: ${fallbackResponse.status} ${fallbackError.substring(0, 150)}`);
              
              // If we have more URLs to try, continue to next URL
              if (i < urlsToTry.length - 1) {
                lastError = new Error(`Browserless ${fallbackResponse.status}: ${fallbackError.substring(0, 150)}`);
                continue;
              }
              
              throw new Error(`Browserless fallback failed: ${fallbackResponse.status} ${fallbackError.substring(0, 150)}`);
            }

            html = await fallbackResponse.text();
            console.log(`✅ Retrieved ${html.length} characters of HTML from ${browserlessUrl} (without selector wait)`);
            break; // Success with fallback, exit retry loop
            
          } catch (fallbackError) {
            console.error(`❌ Fallback attempt error:`, fallbackError);
            lastError = fallbackError as Error;
            
            // If we have more URLs to try, continue
            if (i < urlsToTry.length - 1) {
              continue;
            }
            
            throw fallbackError;
          }
        }
        
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
