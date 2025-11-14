import { testConfiguration, ScrapeConfig as BLConfig } from './browserless-scraper.ts';

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
  console.log(`\n📰 Scraping: ${url}`);
  console.log(`📍 Container Selector: ${config.containerSelector}`);

  // Map to browserless-scraper config format
  const blConfig: BLConfig = {
    containerSelector: config.containerSelector,
    titleSelector: config.titleSelector,
    linkSelector: config.linkSelector,
    dateSelector: config.dateSelector,
    contentSelector: config.contentSelector || 'p',
    imageSelector: config.imageSelector || 'img[src]',
    timeout: 30000
  };

  try {
    // Step 1: Render HTML via Browserless /content (same as proxy-page)
    const BROWSERLESS_URL = 'https://production-sfo.browserless.io';
    console.log(`🌐 Rendering page with Browserless /content API...`);
    
    const response = await fetch(`${BROWSERLESS_URL}/content?token=${browserlessToken}`, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        gotoOptions: {
          waitUntil: 'networkidle2',
          timeout: 30000
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Browserless /content failed: ${response.status} ${response.statusText}`);
    }

    const renderedHtml = await response.text();
    console.log(`✅ Rendered HTML length: ${renderedHtml.length}`);

    // Step 2: Extract articles from rendered HTML using strict selectors
    console.log(`🔍 Extracting with strict selector: ${config.containerSelector}`);
    const { articles, diagnostics } = await testConfiguration(url, blConfig, renderedHtml);
    
    console.log(`✅ Strict match found ${articles.length} articles`);
    
    if (diagnostics) {
      console.log(`📊 Diagnostics:`, JSON.stringify(diagnostics, null, 2));
    }

    if (articles.length === 0) {
      console.log(`⚠️ 0 containers matched selector '${config.containerSelector}' in rendered HTML`);
      return [];
    }

    // Step 3: Map to expected format
    const mappedArticles: Article[] = articles.map(a => ({
      title: a.title,
      url: a.url,
      date: a.date || '',
      imageUrl: a.images?.[0] || undefined,
      content: a.excerpt || a.content || undefined,
    }));

    console.log(`\n✅ Successfully extracted ${mappedArticles.length} articles`);
    return mappedArticles;
  } catch (error) {
    console.error(`❌ Error in scraping:`, error);
    throw error;
  }
}
