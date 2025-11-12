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

    // Inject our container selector script at the end of the body
    const selectorScript = `
      <script>
        console.log('Container selector script loaded');
        
        let detectedContainers = [];
        let selectedContainers = [];
        
        window.addEventListener('message', (event) => {
          if (event.data.type === 'REQUEST_CLICK_HANDLER') {
            console.log('Detecting article containers...');
            
            // Auto-detect repeating containers on page load
            detectContainers();
            
            // Add click handlers to detected containers
            detectedContainers.forEach(container => {
              container.element.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const isSelected = selectedContainers.includes(container.element);
                
                if (isSelected) {
                  // Deselect
                  selectedContainers = selectedContainers.filter(c => c !== container.element);
                  container.element.classList.remove('selected-container');
                } else {
                  // Select
                  selectedContainers.push(container.element);
                  container.element.classList.add('selected-container');
                }
                
                // Send selection to parent
                window.parent.postMessage({
                  type: 'CONTAINER_SELECTED',
                  selector: container.selector,
                  html: container.element.innerHTML,
                  isSelected: !isSelected,
                  totalSelected: selectedContainers.length
                }, '*');
              }, true);
            });
            
            console.log(\`✅ Detected \${detectedContainers.length} containers\`);
            window.parent.postMessage({ 
              type: 'HANDLER_READY',
              containersFound: detectedContainers.length
            }, '*');
          }
        });
        
        function detectContainers() {
          const containerPatterns = /news-list-item|news-item|article-card|article-item|post-item|post-card|entry|story-card|story-item|content-item|feed-item/i;
          const allElements = document.querySelectorAll('*');
          const candidateMap = new Map();
          
          allElements.forEach(element => {
            const className = element.className || '';
            if (typeof className === 'string' && className.trim() && containerPatterns.test(className)) {
              const selector = generateSelector(element);
              if (!candidateMap.has(selector)) {
                candidateMap.set(selector, []);
              }
              candidateMap.get(selector).push(element);
            }
          });
          
          // Filter to only repeating containers (2+ matches)
          candidateMap.forEach((elements, selector) => {
            if (elements.length >= 2) {
              elements.forEach(element => {
                detectedContainers.push({ element, selector });
                element.classList.add('detected-container');
              });
              console.log(\`Found \${elements.length} containers with selector: \${selector}\`);
            }
          });
          
          // Add styles for detected containers
          const style = document.createElement('style');
          style.textContent = \`
            .detected-container {
              outline: 2px dashed #3b82f6 !important;
              outline-offset: 4px !important;
              background: rgba(59, 130, 246, 0.05) !important;
              cursor: pointer !important;
              user-select: none !important;
              transition: all 0.2s ease !important;
            }
            .detected-container:hover {
              outline: 3px solid #3b82f6 !important;
              background: rgba(59, 130, 246, 0.1) !important;
            }
            .selected-container {
              outline: 3px solid #10b981 !important;
              background: rgba(16, 185, 129, 0.15) !important;
            }
            .selected-container:hover {
              outline: 3px solid #10b981 !important;
              background: rgba(16, 185, 129, 0.2) !important;
            }
          \`;
          document.head.appendChild(style);
        }
        
        function generateSelector(element) {
          // Try ID first
          if (element.id) {
            return '#' + element.id;
          }
          
          // Try class combination
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => 
              c && !c.match(/^(hover|focus|active|detected-container|selected-container)/)
            );
            if (classes.length > 0) {
              const selector = '.' + classes.join('.');
              const matches = document.querySelectorAll(selector);
              if (matches.length > 0 && matches.length < 100) {
                return selector;
              }
            }
          }
          
          // Fallback to tag + nth-child
          let path = [];
          let current = element;
          
          while (current.parentElement && path.length < 3) {
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
            
            if (current.tagName.toLowerCase() === 'body') {
              break;
            }
          }
          
          return path.join(' > ');
        }
        
        console.log('Container selector initialized');
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
