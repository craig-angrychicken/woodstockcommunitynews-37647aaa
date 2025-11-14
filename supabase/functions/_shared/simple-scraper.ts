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

// Helper functions for extraction
function extractText(html: string, selector: string): string {
  const match = html.match(new RegExp(`<[^>]*class="[^"]*${selector.replace('.', '')}[^"]*"[^>]*>([^<]+)<`, 'i'));
  if (match) return match[1].trim();
  
  const tagMatch = html.match(new RegExp(`<${selector}>([^<]+)</${selector}>`, 'i'));
  return tagMatch ? tagMatch[1].trim() : '';
}

function extractHref(html: string): string | null {
  const match = html.match(/href="([^"]+)"/i);
  return match ? match[1] : null;
}

function extractSrc(html: string): string | null {
  const match = html.match(/src="([^"]+)"/i);
  return match ? match[1] : null;
}

function normalizeUrl(href: string, baseUrl: string): string {
  try {
    if (href.startsWith('http://') || href.startsWith('https://')) {
      return href;
    }
    const base = new URL(baseUrl);
    if (href.startsWith('/')) {
      return `${base.protocol}//${base.host}${href}`;
    }
    return `${base.protocol}//${base.host}${base.pathname}${href}`;
  } catch {
    return href;
  }
}

export async function scrapeArticlesSimple(
  url: string,
  config: ScrapeConfig,
  browserlessToken: string
): Promise<Article[]> {
  console.log(`\n📰 Scraping: ${url}`);
  console.log(`📍 Container Selector: ${config.containerSelector}`);

  try {
    const BROWSERLESS_URL = 'https://production-sfo.browserless.io';
    
    // Step 1: Use Browserless /scrape to match containers in REAL BROWSER
    console.log(`🌐 Finding containers with Browserless /scrape in real Chromium...`);
    console.log(`🔍 Container selector: ${config.containerSelector}`);
    
    const scrapeResponse = await fetch(`${BROWSERLESS_URL}/scrape?token=${browserlessToken}`, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        elements: [{
          selector: config.containerSelector,
          timeout: 30000
        }],
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000
        }
      })
    });

    if (!scrapeResponse.ok) {
      throw new Error(`Browserless /scrape failed: ${scrapeResponse.status} ${scrapeResponse.statusText}`);
    }

    const scrapeData = await scrapeResponse.json();
    const containers = scrapeData.data?.[0]?.results || [];
    
    console.log(`✅ Real browser matched ${containers.length} containers`);

    if (containers.length === 0) {
      console.log(`⚠️ 0 containers matched selector '${config.containerSelector}' in real Chromium browser`);
      return [];
    }

    // Step 2: Extract from each container HTML
    const articles: Article[] = [];
    
    for (let i = 0; i < containers.length; i++) {
      const containerHtml = containers[i].html || '';
      
      try {
        // Extract title
        const title = extractText(containerHtml, config.titleSelector) || 
                     containerHtml.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i)?.[1]?.trim() || '';
        
        // Extract link
        const href = extractHref(containerHtml);
        
        // Extract date
        const date = extractText(containerHtml, config.dateSelector) || 
                    containerHtml.match(/<time[^>]*>([^<]+)<\/time>/i)?.[1]?.trim() || '';
        
        // Extract content
        const content = extractText(containerHtml, config.contentSelector || 'p') ||
                       containerHtml.match(/<p[^>]*>([^<]+)<\/p>/i)?.[1]?.trim() || '';
        
        // Extract image
        const imageSrc = extractSrc(containerHtml);
        const imageUrl = imageSrc ? normalizeUrl(imageSrc, url) : undefined;
        
        if (title && title.length >= 5) {
          articles.push({
            title,
            url: href ? normalizeUrl(href, url) : url,
            date: date || '',
            imageUrl,
            content: content || ''
          });
        } else {
          console.log(`⚠️ Container ${i} skipped: title too short or missing ("${title}")`);
        }
      } catch (err) {
        console.log(`⚠️ Container ${i} extraction failed:`, err);
      }
    }

    console.log(`\n✅ Successfully extracted ${articles.length} articles from ${containers.length} containers`);
    return articles;
  } catch (error) {
    console.error(`❌ Error in scraping:`, error);
    throw error;
  }
}
