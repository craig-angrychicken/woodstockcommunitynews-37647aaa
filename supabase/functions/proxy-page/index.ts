import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      throw new Error('URL is required');
    }

    console.log('🌐 Proxying URL:', url);

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    let html = await response.text();

    // Inject our selector script
    const selectorScript = `
      <script>
        window.addEventListener('message', (event) => {
          if (event.data.type === 'REQUEST_CLICK_HANDLER') {
            document.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              const target = e.target;
              const selector = generateSelector(target);
              
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
              * { cursor: pointer !important; }
              *:hover { outline: 3px solid #3b82f6 !important; outline-offset: 2px; }
            \`;
            document.head.appendChild(style);

            window.parent.postMessage({ type: 'HANDLER_READY' }, '*');
          }
        });

        function generateSelector(element) {
          if (element.id) return '#' + element.id;
          
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\\s+/).filter(c => c);
            if (classes.length > 0) {
              const selector = '.' + classes.join('.');
              const matches = document.querySelectorAll(selector);
              if (matches.length > 0 && matches.length < 50) {
                return selector;
              }
            }
          }
          
          return element.tagName.toLowerCase();
        }
      </script>
    `;

    // Inject before </body> or at the end
    if (html.includes('</body>')) {
      html = html.replace('</body>', selectorScript + '</body>');
    } else {
      html += selectorScript;
    }

    // Make all links relative to prevent navigation
    html = html.replace(/href="([^"]+)"/g, 'href="#"');

    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Error proxying page:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
