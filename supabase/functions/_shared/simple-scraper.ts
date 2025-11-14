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
  console.log(`\n📰 Scraping with proven testConfiguration: ${url}`);
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

  console.log(`🔧 Using testConfiguration with /content API (networkidle2)`);

  try {
    // Use the proven testConfiguration that works in Selector Check
    const { articles, diagnostics } = await testConfiguration(url, blConfig);
    
    console.log(`✅ testConfiguration found ${articles.length} articles`);
    
    if (diagnostics) {
      console.log(`📊 Diagnostics:`, JSON.stringify(diagnostics, null, 2));
    }

    if (articles.length === 0) {
      console.log(`⚠️ No articles found. Check diagnostics above.`);
      return [];
    }

    // Map to expected format
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
    console.error(`❌ Error in testConfiguration:`, error);
    throw error;
  }
}
