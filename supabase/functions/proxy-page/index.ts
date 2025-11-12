import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BROWSERLESS_URL = Deno.env.get('BROWSERLESS_URL') || 'https://production-sfo.browserless.io';
const BROWSERLESS_API_KEY = Deno.env.get('BROWSERLESS_API_KEY');

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
      console.error('❌ Browserless error:', errorText);
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
              
              console.log('Element clicked, selector:', selector);
              
              window.parent.postMessage({
                type: 'ELEMENT_SELECTED',
                selector: selector,
                tagName: target.tagName,
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
