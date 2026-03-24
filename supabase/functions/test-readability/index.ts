import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import {
  isReadabilityLoaded,
  getImportError,
  fetchPageHTML,
  extractWithReadability,
  extractImages,
  extractVideos,
  extractLinks,
} from "../_shared/readability.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { url, link_selector } = await req.json();

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Missing or invalid 'url' parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid URL format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`🧪 Testing Readability on: ${url}`);
    console.log(`   Readability loaded: ${isReadabilityLoaded()}`);

    // Fetch the page HTML
    const htmlResult = await fetchPageHTML(url);

    if ("error" in htmlResult) {
      return new Response(
        JSON.stringify({
          success: false,
          url,
          error: `Failed to fetch page: ${htmlResult.error}`,
          readability_loaded: isReadabilityLoaded(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`   HTML fetched: ${htmlResult.html.length} chars`);

    // If link_selector is provided, extract and return links (index page test mode)
    if (link_selector && typeof link_selector === "string") {
      const links = extractLinks(htmlResult.html, url, link_selector);
      console.log(`   Link selector: "${link_selector}"`);
      console.log(`   Links found: ${links.length}`);

      return new Response(
        JSON.stringify({
          success: links.length > 0,
          url,
          mode: "index",
          link_selector,
          links_found: links.length,
          links: links.slice(0, 30),
          error: links.length === 0 ? "No links matched the selector" : undefined,
          readability_loaded: isReadabilityLoaded(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract content with Readability
    const readResult = extractWithReadability(htmlResult.html);

    if (!readResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          url,
          error: readResult.error || "Readability extraction failed",
          char_count: readResult.charCount,
          content_preview: readResult.textContent.substring(0, 500),
          title: readResult.title || null,
          readability_loaded: isReadabilityLoaded(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract media from the Readability HTML output
    const images = extractImages(readResult.content, url);
    const videos = extractVideos(readResult.content);

    console.log(`   Title: ${readResult.title}`);
    console.log(`   Content: ${readResult.charCount} chars`);
    console.log(`   Images: ${images.length}`);
    console.log(`   Videos: ${videos.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        url,
        title: readResult.title,
        content_preview: readResult.textContent.substring(0, 500),
        char_count: readResult.charCount,
        images,
        videos,
        readability_loaded: isReadabilityLoaded(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Fatal error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        readability_loaded: isReadabilityLoaded(),
        import_error: getImportError() || null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
