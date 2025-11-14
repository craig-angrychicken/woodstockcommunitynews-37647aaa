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
    
    // Escape the URL and selector for safe injection into the function code
    const escapedUrl = url.replace(/'/g, "\\'");
    const escapedSelector = config.containerSelector.replace(/'/g, "\\'");
    
    // ONE call to /function - renders FIRST, WAITS for selector, THEN queries
    console.log(`🌐 Using Browserless /function: render page, wait for selector, then query DOM`);
    console.log(`⏳ Waiting for container selector: ${config.containerSelector}`);
    
    const functionCode = `export default async function({ page }) {
  // Step 1: Set realistic browser environment
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });
  
  // Step 2: Render the page FULLY
  await page.goto('${escapedUrl}', { 
    waitUntil: 'networkidle2',
    timeout: 45000 
  });
  
  // Step 3: WAIT for the container selector to actually exist and be visible
  try {
    await page.waitForSelector('${escapedSelector}', { 
      timeout: 15000, 
      visible: true 
    });
    // Small stabilization delay after selector appears
    await page.waitForTimeout(300);
  } catch (e) {
    console.log('Selector not found after waiting:', e.message);
    return [];
  }
  
  // Step 4: Query the rendered DOM (only after selector exists)
  const containers = await page.$$eval('${escapedSelector}', elements => {
    return elements.map(el => ({
      html: el.outerHTML,
      text: el.textContent || ''
    }));
  });
  
  return containers;
}`;
    
    const response = await fetch(`${BROWSERLESS_URL}/function?token=${browserlessToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'no-cache'
      },
      body: functionCode
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Browserless /function failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    const containers = result.data || [];
    
    console.log(`✅ Real browser found ${containers.length} containers after full render`);

    if (containers.length === 0) {
      console.log(`⚠️ 0 containers matched selector '${config.containerSelector}' in rendered page`);
      return [];
    }

    // Step 3: Extract from each container HTML
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
