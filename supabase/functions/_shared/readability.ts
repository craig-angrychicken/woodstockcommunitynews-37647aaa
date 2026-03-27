// Shared Readability module — used by test-readability and fetch-web-pages

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Readability: any = null;
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parseHTML: any = null;
let _importError = "";

try {
  let linkedomMod;
  try {
    linkedomMod = await import("https://esm.sh/linkedom@0.18.5?external=canvas");
  } catch {
    linkedomMod = await import("https://cdn.jsdelivr.net/npm/linkedom@0.18.5/+esm");
  }
  parseHTML = linkedomMod.parseHTML;

  let readabilityMod;
  try {
    readabilityMod = await import("https://esm.sh/@mozilla/readability@0.5.0");
  } catch {
    readabilityMod = await import("https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/+esm");
  }
  Readability = readabilityMod.Readability ?? readabilityMod.default?.Readability ?? null;

  if (Readability && parseHTML) {
    console.log("✅ Readability + linkedom loaded successfully");
  } else {
    _importError = `Readability=${!!Readability}, parseHTML=${!!parseHTML}`;
    console.warn("⚠️ Partial load:", _importError);
  }
} catch (err) {
  _importError = err instanceof Error ? err.message : String(err);
  console.warn("⚠️ Could not load Readability/linkedom:", _importError);
}

const DEFAULT_FETCH_TIMEOUT = 15000;
const CONTENT_THRESHOLD = 500;

export function isReadabilityLoaded(): boolean {
  return !!Readability && !!parseHTML;
}

export function getImportError(): string {
  return _importError;
}

export async function fetchPageHTML(
  url: string,
  timeout = DEFAULT_FETCH_TIMEOUT
): Promise<{ html: string; status: number } | { error: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const ct = response.headers.get("content-type") || "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
      return { error: `Non-HTML content-type: ${ct.substring(0, 80)}` };
    }
    return { html: await response.text(), status: response.status };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ReadabilityResult {
  success: boolean;
  title: string;
  content: string;      // HTML content from Readability (for image/video extraction)
  textContent: string;  // Plain text content
  charCount: number;
  error?: string;
}

export function extractWithReadability(html: string): ReadabilityResult {
  if (!Readability || !parseHTML) {
    return {
      success: false,
      title: "",
      content: "",
      textContent: "",
      charCount: 0,
      error: `Readability/linkedom not loaded: ${_importError}`,
    };
  }
  try {
    const { document } = parseHTML(html);
    const reader = new Readability(document, { charThreshold: 200 });
    const result = reader.parse();
    if (!result || !result.textContent) {
      return {
        success: false,
        title: "",
        content: "",
        textContent: "",
        charCount: 0,
        error: "Readability returned no content",
      };
    }

    const plainText = result.textContent.replace(/\s+/g, " ").trim();

    if (plainText.length < CONTENT_THRESHOLD) {
      return {
        success: false,
        title: result.title || "",
        content: result.content || "",
        textContent: plainText,
        charCount: plainText.length,
        error: `Below ${CONTENT_THRESHOLD} char threshold`,
      };
    }

    return {
      success: true,
      title: result.title || "",
      content: result.content || "",
      textContent: plainText,
      charCount: plainText.length,
    };
  } catch (err) {
    return {
      success: false,
      title: "",
      content: "",
      textContent: "",
      charCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ExtractedImage {
  url: string;
  alt: string;
}

export function extractImages(html: string, baseUrl: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();

  // Extract <img> tags from Readability HTML output
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1];

    // Skip malformed URLs: Finalsite CMS embeds JSON arrays in src attributes
    // e.g. src="[{&quot;url&quot;:&quot;https://...&quot;}]" or literal [{...}]
    if (/[[{]|%5B|%7B|&quot;/i.test(src)) continue;

    // Decode HTML entities in src (e.g. &amp; → &) so URLs with query params resolve correctly
    src = src.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

    // Skip excessively long src values (likely encoded data, not real URLs)
    if (src.length > 500) continue;

    // Resolve relative URLs
    try {
      src = new URL(src, baseUrl).href;
    } catch {
      continue;
    }

    // Skip data URIs, tracking pixels, tiny spacers
    if (src.startsWith("data:")) continue;
    if (/pixel|tracking|spacer|beacon/i.test(src)) continue;

    // Double-check resolved URL isn't too long (catches resolved relative paths)
    if (src.length > 600) continue;

    if (seen.has(src)) continue;
    seen.add(src);

    // Extract alt text
    const altMatch = match[0].match(/alt=["']([^"']*?)["']/i);
    images.push({ url: src, alt: altMatch?.[1] || "" });
  }

  return images;
}

/**
 * Fallback image extraction from raw page HTML (not Readability output).
 * Looks for images in meta tags and social sharing buttons when <img> tags
 * are absent (e.g. Finalsite CMS which renders images via JavaScript).
 */
export function extractImagesFromMeta(rawHtml: string, baseUrl: string): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  const seen = new Set<string>();

  function addImage(rawUrl: string) {
    // Decode HTML entities
    let url = rawUrl
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');

    // Resolve relative URLs
    try {
      url = new URL(url, baseUrl).href;
    } catch {
      return;
    }

    if (url.startsWith("data:")) return;
    if (/pixel|tracking|spacer|beacon|favicon|logo|icon/i.test(url)) return;
    if (url.length > 600) return;
    if (seen.has(url)) return;
    seen.add(url);

    images.push({ url, alt: "" });
  }

  // 1. og:image — property before content
  const ogRegex1 = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = ogRegex1.exec(rawHtml)) !== null) {
    addImage(match[1]);
  }
  // og:image — content before property
  const ogRegex2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/gi;
  while ((match = ogRegex2.exec(rawHtml)) !== null) {
    addImage(match[1]);
  }

  // 2. twitter:image — name before content
  const twRegex1 = /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  while ((match = twRegex1.exec(rawHtml)) !== null) {
    addImage(match[1]);
  }
  // twitter:image — content before name
  const twRegex2 = /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/gi;
  while ((match = twRegex2.exec(rawHtml)) !== null) {
    addImage(match[1]);
  }

  // 3. Pinterest share button media= parameter
  const pinterestRegex = /pinterest\.com\/pin\/create\/button\/[^"']*?media=([^&"']+)/gi;
  while ((match = pinterestRegex.exec(rawHtml)) !== null) {
    try {
      addImage(decodeURIComponent(match[1]));
    } catch {
      addImage(match[1]);
    }
  }

  // 4. link rel="image_src"
  const linkRegex = /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/gi;
  while ((match = linkRegex.exec(rawHtml)) !== null) {
    addImage(match[1]);
  }

  // 5. Finalsite CDN images — reliable fallback for Finalsite CMS pages where
  //    images are rendered via JavaScript and only appear in Pinterest/share URLs
  if (images.length === 0) {
    const finalsiteRegex = /https?:\/\/resources\.finalsite\.net\/images\/[^"'\s\)>;,]+\.(?:jpg|jpeg|png|gif|webp)/gi;
    while ((match = finalsiteRegex.exec(rawHtml)) !== null) {
      addImage(match[0]);
    }
  }

  return images;
}

export interface ExtractedVideo {
  type: string; // "youtube", "vimeo", "iframe", "video"
  url: string;
  embedUrl?: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export function extractLinks(
  html: string,
  baseUrl: string,
  selector: string
): ExtractedLink[] {
  if (!parseHTML) {
    console.warn("linkedom not loaded, cannot extract links");
    return [];
  }

  const { document } = parseHTML(html);
  const anchors = document.querySelectorAll(selector);
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(href, baseUrl).href;
    } catch {
      continue;
    }

    // Normalize for dedup: strip fragments and trailing slashes
    const normalized = absoluteUrl.split("#")[0].replace(/\/+$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (!normalized.startsWith("http")) continue;

    links.push({
      url: absoluteUrl,
      text: (anchor.textContent || "").trim(),
    });
  }

  return links;
}

export function extractVideos(html: string): ExtractedVideo[] {
  const videos: ExtractedVideo[] = [];
  const seen = new Set<string>();

  // Extract <iframe> embeds (YouTube, Vimeo, etc.)
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = iframeRegex.exec(html)) !== null) {
    const src = match[1];
    if (seen.has(src)) continue;
    seen.add(src);

    let type = "iframe";
    if (/youtube\.com|youtu\.be/i.test(src)) type = "youtube";
    else if (/vimeo\.com/i.test(src)) type = "vimeo";
    else if (/facebook\.com.*video/i.test(src)) type = "facebook";

    videos.push({ type, url: src, embedUrl: src });
  }

  // Extract <video> tags
  const videoRegex = /<video[^>]*>[\s\S]*?<\/video>/gi;
  while ((match = videoRegex.exec(html)) !== null) {
    const videoBlock = match[0];

    // Check for src on <video> tag itself
    const videoSrcMatch = videoBlock.match(/<video[^>]+src=["']([^"']+)["']/i);
    if (videoSrcMatch) {
      const src = videoSrcMatch[1];
      if (!seen.has(src)) {
        seen.add(src);
        videos.push({ type: "video", url: src });
      }
    }

    // Check for <source> tags inside <video>
    const sourceRegex = /<source[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(videoBlock)) !== null) {
      const src = sourceMatch[1];
      if (!seen.has(src)) {
        seen.add(src);
        videos.push({ type: "video", url: src });
      }
    }
  }

  return videos;
}
