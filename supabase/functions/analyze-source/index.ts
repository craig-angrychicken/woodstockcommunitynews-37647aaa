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

  // Step 1.5: Filter out navigation and UI elements
  const filteredCandidates = containerCandidates.filter(candidate => {
    const selector = candidate.selector.toLowerCase();
    
    // Exclude common navigation/UI patterns
    const excludePatterns = [
      'menu', 'nav', 'sidebar', 'header', 'footer', 'widget',
      'social', 'share', 'button', 'search', 'filter', 'dropdown',
      'tab', 'accordion', 'breadcrumb', 'pagination', 'toolbar',
      'banner', 'ad', 'popup', 'modal', 'overlay'
    ];
    
    // Check if selector contains any exclude pattern
    for (const pattern of excludePatterns) {
      if (selector.includes(pattern)) {
        console.log(`⏭️  Skipping ${candidate.selector} - matches exclude pattern: ${pattern}`);
        return false;
      }
    }
    
    return true;
  });

  console.log(`✅ After filtering: ${filteredCandidates.length} viable candidates`);

  // Step 2: For each container candidate, analyze its structure
  const analysisResults = [];

  for (const candidate of filteredCandidates.slice(0, 5)) { // Analyze top 5 candidates
    console.log(`\n🔬 Analyzing container: ${candidate.selector} (${candidate.count} instances)`);

    // Sample the first 3 elements
    const sampleElements = candidate.elements.slice(0, 3);
    
    // NAVIGATION CONTENT ANALYSIS - detect if this looks like navigation
    const navigationPatterns = {
      shortText: sampleElements.every(el => {
        const text = el.textContent?.trim() || '';
        return text.length < 50; // Navigation items are usually < 50 chars
      }),
      genericTerms: sampleElements.some(el => {
        const text = (el.textContent?.trim() || '').toLowerCase();
        const navTerms = ['about', 'services', 'home', 'contact', 'government', 'business', 'calendar', 'departments', 'residents', 'doing business'];
        return navTerms.some(term => text === term || text === `${term} \u00bb`);
      }),
      noSubstantialContent: sampleElements.every(el => {
        const paragraphs = el.querySelectorAll('p');
        return paragraphs.length === 0;
      })
    };
    
    // Analyze content richness
    const firstElement = candidate.elements[0];
    const paragraphs = firstElement.querySelectorAll('p');
    const totalTextLength = firstElement.textContent?.trim().length || 0;
    const hasParagraphs = paragraphs.length >= 1;
    const hasSubstantialContent = totalTextLength > 100;
    
    // Check for article-specific patterns
    const hasImages = firstElement.querySelectorAll('img').length > 0;
    const hasLinks = firstElement.querySelectorAll('a[href]').length > 0;
    const textContent = firstElement.textContent || '';
    const hasDateKeywords = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}\/\d{2,4}|posted|published|updated)\b/i.test(textContent);
    
    console.log(`  📊 Content analysis: paragraphs=${paragraphs.length}, textLength=${totalTextLength}, images=${hasImages}, dateKeywords=${hasDateKeywords}`);
    
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
      
      // Fallback: If no titles found, look for links with substantial text (common in simple sites)
      if (titleCandidates.length === 0) {
        const linkCandidates = element.querySelectorAll('a[href]');
        for (const linkEl of linkCandidates) {
          const el = linkEl as Element;
          const text = el.textContent?.trim() || '';
          const href = el.getAttribute('href') || '';
          
          // Check if link text looks like a title
          const isSubstantialText = text.length >= 15 && text.length <= 200;
          const startsWithCapital = /^[A-Z]/.test(text);
          const notNavigationText = !/^(read more|click here|view|more|next|previous|home|back)$/i.test(text);
          const hasActualHref = href && !href.startsWith('#') && href !== 'javascript:void(0)';
          
          if (isSubstantialText && startsWithCapital && notNavigationText && hasActualHref) {
            const classes = el.getAttribute('class');
            if (classes) {
              titleSelectors.push(`.${classes.split(' ')[0]}`);
            } else {
              titleSelectors.push('a');
            }
            console.log(`  🔗 Found title in link text: "${text.substring(0, 50)}..."`);
          }
        }
      }

      // Find date-like elements (semantic first, then pattern-based)
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
      
      // Fallback: Look for date patterns in direct children (not nested deep)
      if (dateCandidates.length === 0) {
        // First try direct children of the container
        const directChildren = Array.from(element.children);
        for (const child of directChildren) {
          const el = child as Element;
          const text = el.textContent?.trim() || '';
          
          // Match date-only patterns (not mixed with other content)
          const pureeDatePattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$/i;
          const slashDatePattern = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
          
          if ((pureeDatePattern.test(text) || slashDatePattern.test(text)) && text.length < 50) {
            const classes = el.getAttribute('class');
            const tag = el.tagName.toLowerCase();
            
            if (classes) {
              dateSelectors.push(`.${classes.split(' ')[0]}`);
              console.log(`  📅 Found date in: .${classes.split(' ')[0]} - "${text}"`);
            } else {
              dateSelectors.push(tag);
              console.log(`  📅 Found date in: ${tag} - "${text}"`);
            }
            break;
          }
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
      let titleEl = element.querySelector('h1, h2, h3, h4, [class*="title"]') as Element | null;
      
      // Fallback: Use link text as title if no heading found
      if (!titleEl) {
        const links = element.querySelectorAll('a[href]');
        for (const link of links) {
          const linkText = (link as Element).textContent?.trim() || '';
          const href = (link as Element).getAttribute('href') || '';
          
          // Use link as title if it has substantial text
          const isValidTitle = linkText.length >= 15 && linkText.length <= 200;
          const hasActualHref = href && !href.startsWith('#');
          const notNavText = !/^(read more|click here|view|more)$/i.test(linkText);
          
          if (isValidTitle && hasActualHref && notNavText) {
            titleEl = link as Element;
            break;
          }
        }
      }
      
      // Try to find date element - check all direct children for date patterns
      let dateEl = element.querySelector('time, [class*="date"]') as Element | null;
      
      if (!dateEl) {
        const directChildren = Array.from(element.children);
        for (const child of directChildren) {
          const text = (child as Element).textContent?.trim() || '';
          const pureeDatePattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$/i;
          const slashDatePattern = /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/;
          
          if ((pureeDatePattern.test(text) || slashDatePattern.test(text)) && text.length < 50) {
            dateEl = child as Element;
            break;
          }
        }
      }
      
      if (titleEl) {
        const extractedDate = dateEl ? dateEl.textContent?.trim() : '';
        sampleArticles.push({
          title: titleEl.textContent?.trim() || '',
          date: extractedDate || '',
          excerpt: element.textContent?.trim().substring(0, 150) || '',
        });
      }
    }

    // Calculate confidence
    const hasTitle = titleSelectors.length > 0;
    const hasDate = dateSelectors.length > 0;
    const hasMultipleInstances = candidate.count >= 3;
    
    // Improved count-based scoring - articles typically appear in specific ranges
    const isLikelyArticleCount = candidate.count >= 3 && candidate.count <= 30;
    const isPerfectArticleCount = candidate.count >= 5 && candidate.count <= 20;

    let confidence = 0;
    
    // Core indicators - check if titles came from fallback (link text)
    const titlesFromFallback = titleSelectors.some(sel => sel === 'a' || sel.includes('menuA'));
    if (hasTitle) {
      confidence += titlesFromFallback ? 30 : 40; // Slightly lower confidence for fallback titles
      if (titlesFromFallback) console.log(`  🔗 Using link text as titles (fallback)`);
    }
    if (hasDate) confidence += 30;
    
    // Count-based scoring
    if (isPerfectArticleCount) confidence += 20;
    else if (isLikelyArticleCount) confidence += 10;
    else if (candidate.count > 50) confidence -= 15; // Too many, likely not articles
    
    // Content richness scoring
    if (hasParagraphs) confidence += 15;
    if (hasSubstantialContent) confidence += 15;
    
    // Article pattern scoring
    if (hasImages) confidence += 5;
    if (hasLinks) confidence += 5;
    if (hasDateKeywords) confidence += 10;
    
    // Selector specificity check - penalize very short class names and navigation-like patterns
    const selectorName = candidate.selector.replace(/^\./, '').toLowerCase();
    if (selectorName.length <= 3 && !['li', 'div', 'article'].includes(selectorName)) {
      confidence -= 15;
      console.log(`  ⚠️ Penalized short class name: ${candidate.selector}`);
    }
    
    // Check for navigation-like naming patterns
    const navLikePatterns = ['level', 'tier', 'layer', 'depth', 'menu'];
    if (navLikePatterns.some(pattern => selectorName.includes(pattern))) {
      confidence -= 30;
      console.log(`  ⚠️ Selector contains navigation-like pattern: ${selectorName}`);
    }
    
    // NAVIGATION PATTERN PENALTIES
    if (navigationPatterns.shortText) {
      confidence -= 40;
      console.log(`  ⚠️ All samples have short text (< 50 chars) - likely navigation`);
    }
    if (navigationPatterns.genericTerms) {
      confidence -= 35;
      console.log(`  ⚠️ Contains generic navigation terms`);
    }
    if (navigationPatterns.noSubstantialContent) {
      confidence -= 25;
      console.log(`  ⚠️ No paragraphs or substantial content found`);
    }
    
    // ARTICLE QUALITY SCORE
    let articleQualityScore = 0;
    
    // Check for article-like features in samples
    const hasLongTitles = sampleElements.some(el => {
      const titleEl = el.querySelector('h1, h2, h3, h4, a');
      const titleText = titleEl?.textContent?.trim() || '';
      return titleText.length > 30; // Real article titles are usually > 30 chars
    });
    
    const hasVisibleDates = sampleElements.some(el => {
      const text = el.textContent || '';
      return /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+\d{4}\b/i.test(text);
    });
    
    const hasThumbnails = sampleElements.some(el => {
      return el.querySelectorAll('img').length > 0;
    });
    
    if (hasLongTitles) articleQualityScore += 25;
    if (hasVisibleDates) articleQualityScore += 25;
    if (hasThumbnails) articleQualityScore += 15;
    
    confidence += articleQualityScore;
    if (articleQualityScore > 0) {
      console.log(`  📰 Article quality score: +${articleQualityScore}`);
    }
    
    // Validate sample articles
    const validSamples = sampleArticles.filter(article => {
      const hasValidTitle = article.title.length >= 15 && article.title.length <= 200;
      const hasContent = article.excerpt.length >= 50;
      return hasValidTitle && hasContent;
    });
    
    if (validSamples.length === 0 && sampleArticles.length > 0) {
      confidence -= 30;
      console.log(`  ⚠️ No valid article samples found (samples had too short titles/content)`);
    } else if (validSamples.length >= 2) {
      confidence += 10;
      console.log(`  ✅ Found ${validSamples.length} valid article samples`);
    }

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

  // Filter out candidates that are clearly navigation (very low confidence)
  const contentRichCandidates = analysisResults.filter(result => {
    if (result.confidence < 30) {
      console.log(`⏭️  Filtering out ${result.containerSelector} - too low confidence after content analysis (${result.confidence}%)`);
      return false;
    }
    return true;
  });

  const bestResult = contentRichCandidates[0] || analysisResults[0];

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
