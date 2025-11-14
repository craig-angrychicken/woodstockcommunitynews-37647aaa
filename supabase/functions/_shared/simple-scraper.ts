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
    return new URL(href, baseUrl).toString();
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
    
    // ONE call to /function - renders FIRST, searches across frames, THEN queries
    console.log(`🌐 Using Browserless /function: render page, wait across frames, then query DOM`);
    console.log(`⏳ Waiting for container selector: ${config.containerSelector}`);
    
    const functionCode = `export default async function({ page }) {
  // Step 1: Set realistic browser environment
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1366, height: 768 });
  
  const url = '${escapedUrl}';
  const selector = '${escapedSelector}';
  
  // Step 2: Render the page FULLY
  await page.goto(url, { 
    waitUntil: 'networkidle2',
    timeout: 45000 
  });
  
  // Helper to count matches in a frame without throwing
  async function countInFrame(frame) {
    try {
      return await frame.$$eval(selector, els => els.length);
    } catch {
      return 0;
    }
  }
  
  // Step 3: Frames-aware polling until selector appears (max ~15s)
  const deadline = Date.now() + 15000;
  let found = 0;
  while (Date.now() < deadline && found === 0) {
    // Top page
    found = await countInFrame(page.mainFrame());
    if (found > 0) break;
    
    // All frames
    const frames = page.frames();
    for (const f of frames) {
      const c = await countInFrame(f);
      if (c > 0) { found = c; break; }
    }
    
    if (found === 0) await page.waitForTimeout(300);
  }
  
  if (found === 0) {
    // No matches anywhere after polling
    return [];
  }
  
  // Step 4: Collect containers from top page + all frames
  function mapEls(els) {
    return els.map(el => ({
      html: el.outerHTML,
      text: el.textContent || ''
    }));
  }
  
  let containers = [];
  try {
    const top = await page.$$eval(selector, mapEls);
    containers = containers.concat(top);
  } catch {}
  
  const frames = page.frames();
  for (const f of frames) {
    try {
      const res = await f.$$eval(selector, mapEls);
      if (res && res.length) containers = containers.concat(res);
    } catch {}
  }
  
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
    
    console.log(`✅ Found ${containers.length} containers after frames-aware search`);

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
