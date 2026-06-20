// Test-readability pipeline module — ported from supabase/functions/test-readability.
// Exposes testReadability(env, {url, link_selector?}) which fetches a page and runs
// the shared Readability helpers, returning a JSON-serializable diagnostic result.
// The orchestrator wires the HTTP route; this module just returns plain data.

import type { Env } from "../env";
import {
  fetchPageHTML,
  extractWithReadability,
  extractImages,
  extractImagesFromMeta,
  extractVideos,
  extractLinks,
  type ExtractedImage,
  type ExtractedVideo,
  type ExtractedLink,
} from "../_shared/readability";

export interface TestReadabilityInput {
  url: string;
  link_selector?: string;
}

export interface TestReadabilityResult {
  success: boolean;
  status: number;
  url?: string;
  error?: string;
  // index (link selector) mode
  mode?: "index";
  link_selector?: string;
  links_found?: number;
  links?: ExtractedLink[];
  // content mode
  title?: string | null;
  content_preview?: string;
  char_count?: number;
  images?: ExtractedImage[];
  meta_images?: ExtractedImage[];
  videos?: ExtractedVideo[];
}

export async function testReadability(
  env: Env,
  { url, link_selector }: TestReadabilityInput
): Promise<TestReadabilityResult> {
  try {
    if (!url || typeof url !== "string") {
      return {
        success: false,
        status: 400,
        error: "Missing or invalid 'url' parameter",
      };
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return {
        success: false,
        status: 400,
        error: "Invalid URL format",
      };
    }

    console.log(`🧪 Testing Readability on: ${url}`);

    // Fetch the page HTML
    const htmlResult = await fetchPageHTML(url);

    if ("error" in htmlResult) {
      return {
        success: false,
        status: 200,
        url,
        error: `Failed to fetch page: ${htmlResult.error}`,
      };
    }

    console.log(`   HTML fetched: ${htmlResult.html.length} chars`);

    // If link_selector is provided, extract and return links (index page test mode)
    if (link_selector && typeof link_selector === "string") {
      const links = extractLinks(htmlResult.html, url, link_selector);
      console.log(`   Link selector: "${link_selector}"`);
      console.log(`   Links found: ${links.length}`);

      return {
        success: links.length > 0,
        status: 200,
        url,
        mode: "index",
        link_selector,
        links_found: links.length,
        links: links.slice(0, 30),
        error: links.length === 0 ? "No links matched the selector" : undefined,
      };
    }

    // Extract content with Readability
    const readResult = extractWithReadability(htmlResult.html);

    if (!readResult.success) {
      return {
        success: false,
        status: 200,
        url,
        error: readResult.error || "Readability extraction failed",
        char_count: readResult.charCount,
        content_preview: readResult.textContent.substring(0, 500),
        title: readResult.title || null,
      };
    }

    // Extract media from the Readability HTML output
    let images = extractImages(readResult.content, url);
    const metaImages = images.length === 0 ? extractImagesFromMeta(htmlResult.html, url) : [];
    if (images.length === 0 && metaImages.length > 0) {
      images = metaImages;
    }
    const videos = extractVideos(readResult.content);

    console.log(`   Title: ${readResult.title}`);
    console.log(`   Content: ${readResult.charCount} chars`);
    console.log(
      `   Images: ${images.length}${metaImages.length > 0 ? ` (from meta/social tags)` : ""}`
    );
    console.log(`   Videos: ${videos.length}`);

    return {
      success: true,
      status: 200,
      url,
      title: readResult.title,
      content_preview: readResult.textContent.substring(0, 500),
      char_count: readResult.charCount,
      images,
      meta_images: metaImages,
      videos,
    };
  } catch (error) {
    console.error("Fatal error:", error);
    return {
      success: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
