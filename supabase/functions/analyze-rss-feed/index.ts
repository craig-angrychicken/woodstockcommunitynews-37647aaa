import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RSSItem {
  title?: string;
  link?: string;
  id?: string;
  guid?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  description?: string;
  content?: string;
  summary?: string;
  'content:encoded'?: string;
  'media:content'?: any;
  'media:thumbnail'?: any;
  'media:group'?: any;
  enclosure?: any;
  image?: any;
  [key: string]: any;
}

interface RSSFeed {
  items?: RSSItem[];
  entry?: RSSItem[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl } = await req.json();

    if (!sourceUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'sourceUrl is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`🔍 Analyzing RSS feed: ${sourceUrl}`);

    // Fetch the RSS feed
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xmlText = await response.text();
    console.log(`✅ Retrieved ${xmlText.length} characters`);

    // Parse RSS/Atom feed
    const feed = parseRSSFeed(xmlText);
    const items = feed.items || feed.entry || [];

    if (items.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No items found in RSS feed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📦 Found ${items.length} items in feed`);

    // Determine feed type
    const feedType = feed.entry ? 'atom' : 'rss';

    // Analyze first 10 items to detect field mappings
    const sampleSize = Math.min(10, items.length);
    const sampleItems = items.slice(0, sampleSize);

    // Detect field mappings
    const fieldMappings = detectFieldMappings(sampleItems, feedType);
    const imageFields = detectImageFields(sampleItems);
    const diagnostics = generateDiagnostics(sampleItems, fieldMappings, imageFields);

    // Generate sample articles for preview
    const sampleArticles = sampleItems.slice(0, 5).map(item => ({
      title: extractField(item, fieldMappings.titleField) || 'No title',
      link: extractField(item, fieldMappings.linkField) || '',
      date: extractField(item, fieldMappings.dateField) || '',
      content: extractField(item, fieldMappings.contentField) || '',
      images: extractAllImagesFromItem(item, imageFields)
    }));

    // Calculate confidence score
    const confidence = calculateConfidence(diagnostics);

    const analysis = {
      feedType,
      suggestedConfig: {
        feedType,
        fieldMappings: {
          ...fieldMappings,
          imageFields
        }
      },
      sampleArticles,
      confidence,
      diagnostics
    };

    console.log(`✅ Analysis complete with ${confidence}% confidence`);
    console.log(`📸 Found ${imageFields.length} image field(s)`);

    return new Response(
      JSON.stringify({
        success: true,
        analysis
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('❌ Error analyzing RSS feed:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function parseRSSFeed(xmlText: string): RSSFeed {
  const items: RSSItem[] = [];
  const itemPattern = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;

  while ((match = itemPattern.exec(xmlText)) !== null) {
    const itemXml = match[1];
    const item: RSSItem = {};

    // Extract all possible fields
    const fields = [
      'title', 'link', 'id', 'guid', 'pubDate', 'published', 'updated',
      'description', 'content', 'summary', 'content:encoded'
    ];

    fields.forEach(field => {
      const value = extractTag(itemXml, field);
      if (value) item[field] = value;
    });

    // Extract media fields
    item['media:content'] = extractMediaContent(itemXml);
    item['media:thumbnail'] = extractMediaThumbnail(itemXml);
    item['media:group'] = extractMediaGroup(itemXml);
    item.enclosure = extractEnclosure(itemXml);
    item.image = extractImageTag(itemXml);

    items.push(item);
  }

  // Detect if it's an Atom feed
  const isAtom = xmlText.includes('<feed') && xmlText.includes('xmlns="http://www.w3.org/2005/Atom"');
  
  return isAtom ? { entry: items } : { items };
}

function extractTag(xml: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = pattern.exec(xml);
  if (match) {
    let content = match[1].trim();
    content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return content;
  }
  return undefined;
}

function extractMediaContent(xml: string): any {
  const pattern = /<media:content[^>]*url="([^"]+)"[^>]*>/i;
  const match = pattern.exec(xml);
  return match ? { url: match[1] } : undefined;
}

function extractMediaThumbnail(xml: string): any {
  const pattern = /<media:thumbnail[^>]*url="([^"]+)"[^>]*>/i;
  const match = pattern.exec(xml);
  return match ? { url: match[1] } : undefined;
}

function extractMediaGroup(xml: string): any {
  const groupPattern = /<media:group>([\s\S]*?)<\/media:group>/i;
  const match = groupPattern.exec(xml);
  if (match) {
    const urls: string[] = [];
    const urlPattern = /url="([^"]+)"/gi;
    let urlMatch;
    while ((urlMatch = urlPattern.exec(match[1])) !== null) {
      urls.push(urlMatch[1]);
    }
    return urls.length > 0 ? { urls } : undefined;
  }
  return undefined;
}

function extractEnclosure(xml: string): any {
  const pattern = /<enclosure[^>]*url="([^"]+)"[^>]*>/i;
  const match = pattern.exec(xml);
  return match ? { url: match[1] } : undefined;
}

function extractImageTag(xml: string): any {
  const pattern = /<image[^>]*>[\s\S]*?<url>([^<]+)<\/url>[\s\S]*?<\/image>/i;
  const match = pattern.exec(xml);
  return match ? { url: match[1] } : undefined;
}

function detectFieldMappings(items: RSSItem[], feedType: string) {
  // Detect best field for each attribute based on presence and content quality
  const titleField = detectBestField(items, ['title'], (val) => val && val.length > 0);
  const linkField = detectBestField(items, ['link', 'id', 'guid'], (val) => val && (val.startsWith('http') || val.includes('/')));
  const dateField = detectBestField(items, ['pubDate', 'published', 'updated'], (val) => val && !isNaN(Date.parse(val)));
  const contentField = detectBestField(items, ['content:encoded', 'description', 'content', 'summary'], (val) => val && val.length > 50);

  return {
    titleField: titleField || 'title',
    linkField: linkField || 'link',
    dateField: dateField || (feedType === 'atom' ? 'published' : 'pubDate'),
    contentField: contentField || 'description'
  };
}

function detectBestField(items: RSSItem[], candidates: string[], validator: (val: any) => boolean): string | null {
  for (const field of candidates) {
    const validCount = items.filter(item => validator(item[field])).length;
    if (validCount > items.length * 0.8) { // 80% threshold
      return field;
    }
  }
  return null;
}

function detectImageFields(items: RSSItem[]): string[] {
  const imageFields: string[] = [];
  const candidates = [
    { field: 'enclosure.url', accessor: (item: RSSItem) => item.enclosure?.url },
    { field: 'media:content.url', accessor: (item: RSSItem) => item['media:content']?.url },
    { field: 'media:thumbnail.url', accessor: (item: RSSItem) => item['media:thumbnail']?.url },
    { field: 'media:group.urls', accessor: (item: RSSItem) => item['media:group']?.urls },
    { field: 'image.url', accessor: (item: RSSItem) => item.image?.url }
  ];

  for (const { field, accessor } of candidates) {
    const hasImages = items.some(item => {
      const value = accessor(item);
      return value && (typeof value === 'string' || (Array.isArray(value) && value.length > 0));
    });
    
    if (hasImages) {
      imageFields.push(field);
    }
  }

  return imageFields;
}

function extractField(item: RSSItem, field: string): string | undefined {
  return item[field];
}

function extractAllImagesFromItem(item: RSSItem, imageFields: string[]): string[] {
  const images: string[] = [];
  
  for (const field of imageFields) {
    const parts = field.split('.');
    let value: any = item;
    
    for (const part of parts) {
      value = value?.[part];
    }
    
    if (typeof value === 'string' && value) {
      images.push(value);
    } else if (Array.isArray(value)) {
      images.push(...value.filter(v => typeof v === 'string'));
    }
  }
  
  return [...new Set(images)]; // Remove duplicates
}

function generateDiagnostics(items: RSSItem[], fieldMappings: any, imageFields: string[]) {
  return {
    itemsAnalyzed: items.length,
    hasValidTitles: items.filter(item => item[fieldMappings.titleField]).length > items.length * 0.9,
    hasValidLinks: items.filter(item => item[fieldMappings.linkField]).length > items.length * 0.9,
    hasValidDates: items.filter(item => item[fieldMappings.dateField]).length > items.length * 0.8,
    hasImages: imageFields.length > 0,
    imageFieldsFound: imageFields,
    issues: []
  };
}

function calculateConfidence(diagnostics: any): number {
  let score = 0;
  
  if (diagnostics.hasValidTitles) score += 30;
  if (diagnostics.hasValidLinks) score += 30;
  if (diagnostics.hasValidDates) score += 20;
  if (diagnostics.hasImages) score += 20;
  
  return score;
}
