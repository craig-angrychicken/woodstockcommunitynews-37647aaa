import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Analyze HTML structure to find article patterns
function analyzeHtmlStructure(html: string, sourceUrl: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc) return null;

  console.log('🔍 Starting HTML structure analysis...');

  // Step 1: Find repeating elements (likely article containers)
  const allElements = doc.querySelectorAll('*');
  const classMap = new Map<string, Element[]>();
  const idPatternMap = new Map<string, Element[]>();

  for (const el of allElements) {
    const element = el as Element;
    const className = element.getAttribute('class');
    const id = element.getAttribute('id');

    // Track by class name
    if (className) {
      const classes = className.split(' ').filter(c => c.trim());
      for (const cls of classes) {
        if (!classMap.has(cls)) classMap.set(cls, []);
        classMap.get(cls)!.push(element);
      }
    }

    // Track by ID pattern (e.g., article-1, article-2)
    if (id) {
      const pattern = id.replace(/\d+/g, 'N');
      if (!idPatternMap.has(pattern)) idPatternMap.set(pattern, []);
      idPatternMap.get(pattern)!.push(element);
    }
  }

  // Find classes that appear 3+ times (likely article containers)
  const containerCandidates: Array<{ selector: string; count: number; elements: Element[] }> = [];
  
  for (const [className, elements] of classMap) {
    if (elements.length >= 3 && className.length > 2) {
      containerCandidates.push({
        selector: `.${className}`,
        count: elements.length,
        elements
      });
    }
  }

  // Also check for semantic HTML elements
  const semanticContainers = ['article', 'section', '[itemtype*="Article"]'];
  for (const selector of semanticContainers) {
    const elements = doc.querySelectorAll(selector);
    if (elements.length >= 2) {
      containerCandidates.push({
        selector,
        count: elements.length,
        elements: Array.from(elements) as Element[]
      });
    }
  }

  // Sort by count descending
  containerCandidates.sort((a, b) => b.count - a.count);

  console.log(`📦 Found ${containerCandidates.length} container candidates`);

  // Step 2: For each container candidate, analyze its structure
  const analysisResults = [];

  for (const candidate of containerCandidates.slice(0, 5)) { // Analyze top 5 candidates
    console.log(`\n🔬 Analyzing container: ${candidate.selector} (${candidate.count} instances)`);

    // Sample the first 3 elements
    const sampleElements = candidate.elements.slice(0, 3);
    
    // Find common child patterns
    const titleSelectors: string[] = [];
    const dateSelectors: string[] = [];
    const linkSelectors: string[] = [];
    const sampleArticles = [];

    for (const element of sampleElements) {
      // Find title-like elements
      const titleCandidates = element.querySelectorAll('h1, h2, h3, h4, [class*="title"], [class*="headline"]');
      for (const titleEl of titleCandidates) {
        const el = titleEl as Element;
        const text = el.textContent?.trim() || '';
        if (text.length > 10 && text.length < 200) {
          const classes = el.getAttribute('class');
          if (classes) {
            titleSelectors.push(`.${classes.split(' ')[0]}`);
          } else {
            titleSelectors.push(el.tagName.toLowerCase());
          }
        }
      }

      // Find date-like elements
      const dateCandidates = element.querySelectorAll('time, [class*="date"], [class*="time"], [datetime]');
      for (const dateEl of dateCandidates) {
        const el = dateEl as Element;
        const classes = el.getAttribute('class');
        if (classes) {
          dateSelectors.push(`.${classes.split(' ')[0]}`);
        } else if (el.tagName.toLowerCase() === 'time') {
          dateSelectors.push('time');
        }
      }

      // Find links
      const links = element.querySelectorAll('a[href]');
      for (const linkEl of links) {
        const el = linkEl as Element;
        const href = el.getAttribute('href');
        if (href && !href.startsWith('#')) {
          const classes = el.getAttribute('class');
          if (classes) {
            linkSelectors.push(`.${classes.split(' ')[0]}`);
          }
        }
      }

      // Extract sample data
      const titleEl = element.querySelector('h1, h2, h3, h4, [class*="title"]');
      const dateEl = element.querySelector('time, [class*="date"]');
      
      if (titleEl) {
        sampleArticles.push({
          title: (titleEl as Element).textContent?.trim() || '',
          date: dateEl ? (dateEl as Element).textContent?.trim() : '',
          excerpt: element.textContent?.trim().substring(0, 150) || '',
        });
      }
    }

    // Calculate confidence
    const hasTitle = titleSelectors.length > 0;
    const hasDate = dateSelectors.length > 0;
    const hasMultipleInstances = candidate.count >= 3;
    const hasReasonableCount = candidate.count <= 50; // Not too many (likely not articles)

    let confidence = 0;
    if (hasTitle) confidence += 40;
    if (hasDate) confidence += 30;
    if (hasMultipleInstances) confidence += 20;
    if (hasReasonableCount) confidence += 10;

    // Determine recommended parser type
    let recommendedParser = 'custom';
    if (sourceUrl.includes('cherokeecountyga.gov')) {
      recommendedParser = 'cherokee';
      confidence += 10;
    } else if (sourceUrl.includes('woodstockga.gov')) {
      recommendedParser = 'woodstock';
      confidence += 10;
    } else if (candidate.count >= 5 && hasTitle) {
      recommendedParser = 'generic';
    }

    analysisResults.push({
      containerSelector: candidate.selector,
      containerCount: candidate.count,
      titleSelectors: [...new Set(titleSelectors)],
      dateSelectors: [...new Set(dateSelectors)],
      linkSelectors: [...new Set(linkSelectors)],
      sampleArticles,
      confidence,
      recommendedParser
    });
  }

  // Sort by confidence
  analysisResults.sort((a, b) => b.confidence - a.confidence);

  const bestResult = analysisResults[0];

  if (!bestResult) {
    return {
      success: false,
      error: 'Could not find any article-like patterns in the HTML'
    };
  }

  console.log(`\n✅ Best match: ${bestResult.containerSelector} (confidence: ${bestResult.confidence}%)`);

  return {
    success: true,
    analysis: {
      containerSelectors: analysisResults.map(r => r.containerSelector).slice(0, 3),
      titleSelectors: bestResult.titleSelectors.slice(0, 3),
      dateSelectors: bestResult.dateSelectors.slice(0, 3),
      linkSelectors: bestResult.linkSelectors.slice(0, 3),
      sampleArticles: bestResult.sampleArticles,
      recommendedParser: bestResult.recommendedParser,
      confidence: bestResult.confidence,
      totalElements: allElements.length,
      htmlStructure: `Found ${containerCandidates.length} container candidates, ${bestResult.containerCount} instances of best match`
    }
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl } = await req.json();

    if (!sourceUrl) {
      return new Response(
        JSON.stringify({ error: 'sourceUrl is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`\n🌐 Analyzing source: ${sourceUrl}`);

    // Fetch HTML
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
      }
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: `Failed to fetch URL: ${response.status} ${response.statusText}` 
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const html = await response.text();
    const result = analyzeHtmlStructure(html, sourceUrl);

    return new Response(
      JSON.stringify(result),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in analyze-source:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
