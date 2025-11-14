import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";
import { scrapeWithBrowserless } from './browserless-service.ts';

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
  console.log(`\n📰 Scraping with Browserless live selector matching: ${url}`);
  console.log(`📍 Container Selector: ${config.containerSelector}`);
  console.log(`⏱️ Using Browserless /scrape API`);

  // Call Browserless scrape API to find containers in live browser context
  const browserlessConfig = {
    elements: [{ 
      selector: config.containerSelector, 
      timeout: 30000 
    }]
  };

  const scrapeResponse = await scrapeWithBrowserless(url, browserlessConfig);
  
  // Extract container results from Browserless response
  const containerData = scrapeResponse.data.find(d => d.selector === config.containerSelector);
  const containerResults = containerData?.results || [];
  
  console.log(`✅ Found ${containerResults.length} containers via Browserless live matching`);

  if (containerResults.length === 0) {
    console.log(`⚠️ No containers found with selector: ${config.containerSelector}`);
    return [];
  }

  // Extract articles from each container (max 20)
  const articles: Article[] = [];
  const containersToProcess = containerResults.slice(0, 20);
  const parser = new DOMParser();
  
  for (const container of containersToProcess) {
    // Parse each container's HTML snippet
    const fragDoc = parser.parseFromString(container.html, 'text/html');
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
