import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');

// Simple in-memory cache to avoid hitting rate limits
const pageCache = new Map<string, { html: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      throw new Error('URL is required');
    }

    if (!BROWSERLESS_API_KEY) {
      throw new Error('BROWSERLESS_API_KEY is not configured');
    }

    // Check cache first
    const cached = pageCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      console.log('✅ Returning cached page for:', url);
      return new Response(cached.html, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'SAMEORIGIN',
        },
      });
    }

    console.log('🌐 Proxying and rendering URL with JavaScript:', url);

    // Use Browserless to render the page with JavaScript
    const response = await fetch(
      `${BROWSERLESS_URL}/content?token=${BROWSERLESS_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          gotoOptions: {
            waitUntil: 'networkidle2',
            timeout: 30000
          }
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Browserless error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ 
            error: 'Rate limit exceeded. Please wait a moment and try again.',
            details: 'Browserless API rate limit reached. Try again in a few seconds.'
          }),
          {
            status: 429,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      
      throw new Error(`Failed to render page: ${response.status}`);
    }

    let html = await response.text();
    console.log('✅ Page rendered with JavaScript, HTML length:', html.length);

    // Inject our selector script at the end of the body
    const selectorScript = `
      <script>
        console.log('Selector script loaded');
        
        window.addEventListener('message', (event) => {
          console.log('Message received:', event.data);
          
          if (event.data.type === 'REQUEST_CLICK_HANDLER') {
            console.log('Setting up click handler');
            
            document.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              const target = e.target;
              const selector = generateSelector(target);
              
              // Walk up to find the container
              let container = findContainer(target);
              const containerSelector = container ? generateSelector(container) : null;
              
              // Get element information
              const tagName = target.tagName;
              const text = target.textContent?.trim() || '';
              const src = getElementSrc(target);
              
              console.log('Element clicked:', {
                selector,
                containerSelector,
                tagName
              });
              
              window.parent.postMessage({
                type: 'ELEMENT_SELECTED',
                selector: selector,
                containerSelector: containerSelector,
                tagName: tagName,
                text: text,
                src: src,
                className: target.className,
                id: target.id
              }, '*');
            }, true);

            // Add hover styles
            const style = document.createElement('style');
            style.textContent = \`
              * { 
                cursor: pointer !important; 
                user-select: none !important;
              }
              *:hover { 
                outline: 3px solid #3b82f6 !important; 
                outline-offset: 2px !important;
                background-color: rgba(59, 130, 246, 0.1) !important;
              }
            \`;
            document.head.appendChild(style);

            console.log('Click handler ready');
            window.parent.postMessage({ type: 'HANDLER_READY' }, '*');
          }
        });

        function findContainer(element) {
          let current = element;
          const containerPatterns = /news|list|item|card|post|entry|article|story|content-item|feed-item/i;
          
          // Walk up max 10 levels
          for (let i = 0; i < 10 && current.parentElement; i++) {
            current = current.parentElement;
            
            // Check if this element looks like a repeating container
            const className = current.className || '';
            if (typeof className === 'string' && containerPatterns.test(className)) {
              // Check if there are multiple siblings with same class
              const selector = generateSelector(current);
              const matches = document.querySelectorAll(selector);
              if (matches.length >= 2) {
                console.log('Found container:', selector, 'with', matches.length, 'matches');
                return current;
              }
            }
            
            // Stop at body
            if (current.tagName.toLowerCase() === 'body') {
              break;
            }
          }
          
          return null;
        }
        
        function getElementSrc(element) {
          // Check img src
          if (element.src) return element.src;
          if (element.getAttribute('src')) return element.getAttribute('src');
          
          // Check inline background styles
          const style = element.getAttribute('style') || '';
          const bgMatch = style.match(/background(?:-image)?:\s*url\(['"]?([^'")]+)['"]?\)/);
          if (bgMatch) return bgMatch[1];
          
          return '';
        }
        
        function generateSelector(element) {
          // Try ID first
          if (element.id) {
            return '#' + element.id;
          }
          
          // Try class combination
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => c && !c.match(/^(hover|focus|active)/));
            if (classes.length > 0) {
              const selector = '.' + classes.join('.');
              const matches = document.querySelectorAll(selector);
              if (matches.length > 0 && matches.length < 100) {
                return selector;
              }
            }
          }
          
          // Try nth-child approach
          let path = [];
          let current = element;
          
          while (current.parentElement) {
            const parent = current.parentElement;
            const siblings = Array.from(parent.children);
            const index = siblings.indexOf(current) + 1;
            const tag = current.tagName.toLowerCase();
            
            if (siblings.length > 1) {
              path.unshift(\`\${tag}:nth-child(\${index})\`);
            } else {
              path.unshift(tag);
            }
            
            current = parent;
            
            // Stop at body or after 4 levels
            if (current.tagName.toLowerCase() === 'body' || path.length >= 4) {
              break;
            }
          }
          
          return path.join(' > ');
        }
        
        console.log('Selector script initialized');
      </script>
    `;

    // Inject before </body> or at the end
    if (html.includes('</body>')) {
      html = html.replace('</body>', selectorScript + '</body>');
    } else {
      html += selectorScript;
    }

    // Prevent navigation by making links point to #
    html = html.replace(/(<a[^>]+href=["'])(?!#|javascript:)/gi, '$1#" data-original-href="');

    // Cache the result
    pageCache.set(url, { html, timestamp: Date.now() });
    
    // Clean old cache entries (keep last 10 URLs)
    if (pageCache.size > 10) {
      const oldestKey = Array.from(pageCache.keys())[0];
      pageCache.delete(oldestKey);
    }

    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    console.error('Error proxying page:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Failed to render page. Make sure BROWSERLESS_API_KEY is configured.'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
