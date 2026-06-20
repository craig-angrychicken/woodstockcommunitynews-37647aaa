import { XMLParser } from "fast-xml-parser";
import type { Env } from "../env";
import type { SourceRow } from "../_shared/types";
import { all, first, fromJson, run, toJson } from "../_shared/db";
import { putObject } from "../_shared/r2";
import { fetchPageHTML } from "../_shared/readability";

// UUID v5 namespace for generating deterministic UUIDs
const NAMESPACE_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

// If RSS content is below this threshold, attempt to fetch the full article from the URL
const CONTENT_ENRICHMENT_THRESHOLD = 500;

export interface FetchRssFeedsOptions {
  dateFrom: string;
  dateTo: string;
  sourceIds: string[];
  environment: "production" | "test";
  queryHistoryId?: string | null;
}

export interface FetchRssFeedsResult {
  success: boolean;
  artifactsCreated: number;
  errors: number;
  sourcesProcessed: number;
}

interface FieldMappings {
  titleField?: string;
  linkField?: string;
  dateField?: string;
  contentField?: string;
  imageFields?: string[];
}

interface ParserConfig {
  fieldMappings?: FieldMappings;
}

interface RSSItem {
  title?: unknown;
  link?: unknown;
  id?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  description?: unknown;
  content?: unknown;
  summary?: unknown;
  "content:encoded"?: unknown;
  "media:content"?: { url?: string } | { url?: string }[];
  "media:thumbnail"?: { url?: string } | { url?: string }[];
  "media:group"?: { urls?: string[] };
  enclosure?: { url?: string } | { url?: string }[];
  image?: { url?: string };
  guid?: unknown;
  [key: string]: unknown;
}

interface RSSFeed {
  items?: RSSItem[];
  entry?: RSSItem[]; // Atom feeds use 'entry' instead of 'items'
}

interface StoredImageEntry {
  original_url: string;
  stored_url: string;
  download_failed?: true;
}

/**
 * Normalizes any GUID format to a valid UUID string
 * - If already UUID format: returns as-is
 * - If 32-char hex string: formats as UUID (8-4-4-4-12)
 * - Otherwise (URLs, etc.): generates deterministic UUID v5
 */
async function normalizeToUUID(guid: string): Promise<string> {
  // Check if already valid UUID format (8-4-4-4-12 with hyphens)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(guid)) {
    return guid.toLowerCase();
  }

  // Check if 32-character hex string (no hyphens)
  const hexRegex = /^[0-9a-f]{32}$/i;
  if (hexRegex.test(guid)) {
    // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    return `${guid.slice(0, 8)}-${guid.slice(8, 12)}-${guid.slice(12, 16)}-${guid.slice(16, 20)}-${guid.slice(20)}`.toLowerCase();
  }

  // For anything else (URLs, etc.), generate deterministic UUID v5
  const encoder = new TextEncoder();
  const data = encoder.encode(NAMESPACE_UUID + guid);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // Format as UUID v5: set version (5) and variant bits
  const uuid = [
    hashHex.slice(0, 8),
    hashHex.slice(8, 12),
    "5" + hashHex.slice(13, 16), // Version 5
    ((parseInt(hashHex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + hashHex.slice(18, 20), // Variant bits
    hashHex.slice(20, 32),
  ].join("-");

  return uuid;
}

/**
 * Fetch RSS feeds for the given sources, download images to R2, and upsert
 * artifacts keyed on their (normalized) GUID.
 */
export async function fetchRssFeeds(
  env: Env,
  { dateFrom, dateTo, sourceIds, environment, queryHistoryId }: FetchRssFeedsOptions,
): Promise<FetchRssFeedsResult> {
  console.log("\n🚀 Starting RSS feed fetch");
  console.log("📊 Sources:", sourceIds.length);
  console.log("📅 Date range:", dateFrom, "to", dateTo);
  console.log("🎯 Environment:", environment);

  try {
    // Fetch RSS sources
    let sources: SourceRow[] = [];
    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => "?").join(", ");
      sources = await all<SourceRow>(
        env,
        `SELECT * FROM sources WHERE id IN (${placeholders}) AND type = ?`,
        ...sourceIds,
        "RSS Feed",
      );
    }

    if (!sources || sources.length === 0) {
      throw new Error("No RSS feed sources found");
    }

    console.log(`✅ Loaded ${sources.length} RSS feed sources`);

    const dateFromTime = new Date(dateFrom).getTime();
    const dateToTime = new Date(dateTo).getTime();
    let totalArtifacts = 0;
    let totalErrors = 0;

    for (const source of sources) {
      try {
        console.log(`\n📡 Fetching RSS feed: ${source.name}`);
        console.log(`   URL: ${source.url}`);

        // Get parser config for dynamic field mapping
        const parserConfig = fromJson<ParserConfig | null>(source.parser_config, null);
        console.log(`🔧 Using parser config:`, parserConfig ? "Custom" : "Default");

        // Fetch the RSS feed with retry logic
        let response: Response | undefined;
        let lastError: Error | undefined;
        const maxRetries = 3;
        const retryDelays = [2000, 4000, 8000]; // Exponential backoff

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            console.log(`   Attempt ${attempt + 1}/${maxRetries}...`);
            response = await fetch(source.url ?? "");

            if (response.ok) {
              break; // Success!
            }

            // Log HTTP error details
            const statusText = response.statusText;
            const responseBody = await response.text().catch(() => "Unable to read response body");
            lastError = new Error(`HTTP ${response.status}: ${statusText}\nResponse: ${responseBody.substring(0, 500)}`);
            console.error(`   ❌ Attempt ${attempt + 1} failed:`, lastError.message);

            // Don't retry on client errors (400-499), only server errors (500+) and network issues
            if (response.status < 500) {
              console.log(`   🚫 Not retrying client error ${response.status}`);
              throw lastError;
            }

            if (attempt < maxRetries - 1) {
              const delay = retryDelays[attempt];
              console.log(`   ⏳ Waiting ${delay}ms before retry...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          } catch (fetchError: unknown) {
            lastError = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
            console.error(`   ❌ Attempt ${attempt + 1} failed:`, lastError.message);

            if (attempt < maxRetries - 1) {
              const delay = retryDelays[attempt];
              console.log(`   ⏳ Waiting ${delay}ms before retry...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        if (!response || !response.ok) {
          throw lastError || new Error("Failed to fetch RSS feed after retries");
        }

        const xmlText = await response.text();
        console.log(`✅ Retrieved ${xmlText.length} characters`);

        // Parse RSS/Atom feed
        const feed = parseRSSFeed(xmlText);
        const items = feed.items || feed.entry || [];

        console.log(`📦 Found ${items.length} items in feed`);

        // Filter by date range
        console.log(`📅 Filtering items by date range...`);
        console.log(`   From: ${new Date(dateFromTime).toISOString()}`);
        console.log(`   To: ${new Date(dateToTime).toISOString()}`);

        const filteredItems = items.filter((item, idx) => {
          const dateStr = asString(item.pubDate) || asString(item.published);
          console.log(`   Item ${idx + 1}: pubDate="${dateStr}"`);

          const itemDate = parseDate(dateStr);
          if (!itemDate) {
            console.log(`     ❌ Date parse failed`);
            return false;
          }

          console.log(`     ✓ Parsed as: ${itemDate.toISOString()}`);
          const itemTime = itemDate.getTime();
          const inRange = itemTime >= dateFromTime && itemTime <= dateToTime;
          console.log(`     ${inRange ? "✅" : "❌"} In range: ${inRange}`);
          return inRange;
        });

        console.log(`✅ ${filteredItems.length} items in date range`);

        // Process each item
        let itemsProcessed = 0;
        for (const item of filteredItems) {
          try {
            // Extract data using dynamic field mappings
            const titleField = parserConfig?.fieldMappings?.titleField || "title";
            const linkField = parserConfig?.fieldMappings?.linkField || "link";
            const dateField = parserConfig?.fieldMappings?.dateField || "pubDate";
            const contentField = parserConfig?.fieldMappings?.contentField || "description";

            const title = asString(item[titleField]) || "Untitled";
            const link = asString(item[linkField]) || "";

            // Generate deterministic GUID from source + normalized title (content-based fingerprint)
            const normalizedTitle = title.toLowerCase().trim().replace(/\s+/g, " ");
            const fingerprint = `${source.id}:${normalizedTitle}`;
            const guid = await normalizeToUUID(fingerprint);

            const dateStr = asString(item[dateField]) || asString(item.pubDate) || asString(item.published);
            const pubDate = parseDate(dateStr) || new Date();

            // Extract ALL images using configured fields
            const allImages = extractAllImages(item, parserConfig);

            // Generate artifact GUID for storage path
            const artifactGuid = crypto.randomUUID();

            // Download and upload images to R2 with robust error handling
            const storageImages: StoredImageEntry[] = [];
            const problematicDomains = ["facebook.com", "instagram.com", "twitter.com", "x.com"];

            for (let i = 0; i < allImages.length; i++) {
              const imageUrl = allImages[i];

              // Validate URL format
              try {
                new URL(imageUrl);
              } catch {
                console.warn(`⚠️ Invalid image URL format, skipping: ${imageUrl}`);
                continue;
              }

              // Check for known problematic domains
              const isProblematic = problematicDomains.some((domain) => imageUrl.includes(domain));
              if (isProblematic) {
                console.warn(`⚠️ Protected social media URL detected, may fail: ${imageUrl}`);
              }

              try {
                console.log(`📥 Downloading image ${i + 1}/${allImages.length}: ${imageUrl}`);

                // Retry logic with exponential backoff (max 3 attempts)
                let imgResponse: Response | null = null;
                let imgLastError: Error | null = null;

                for (let attempt = 1; attempt <= 3; attempt++) {
                  try {
                    const imgController = new AbortController();
                    const imgTimeoutId = setTimeout(() => imgController.abort(), 30000); // 30s timeout

                    imgResponse = await fetch(imageUrl, {
                      signal: imgController.signal,
                      headers: {
                        "User-Agent":
                          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                        "Referer": "https://www.facebook.com/",
                        "Accept-Language": "en-US,en;q=0.9",
                      },
                    });
                    clearTimeout(imgTimeoutId);

                    if (imgResponse.ok) {
                      break; // Success
                    }

                    // Handle 403 Forbidden (protected URLs) — try weserv.nl proxy first
                    if (imgResponse.status === 403) {
                      console.warn(`🔒 Image returned 403. Attempting weserv.nl proxy for: ${imageUrl}`);

                      let proxied = false;
                      try {
                        const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&output=jpg&n=-1`;
                        const proxyController = new AbortController();
                        const proxyTimeoutId = setTimeout(() => proxyController.abort(), 20000);

                        const proxyResponse = await fetch(proxyUrl, { signal: proxyController.signal });
                        clearTimeout(proxyTimeoutId);

                        if (proxyResponse.ok) {
                          const proxyBuffer = await proxyResponse.arrayBuffer();
                          const proxyContentType = proxyResponse.headers.get("content-type") || "image/jpeg";

                          // Reject weserv.nl error placeholder (~1 KB red PNG)
                          const MIN_VALID_IMAGE_BYTES = 5000;
                          if (!proxyContentType.startsWith("image/") || proxyBuffer.byteLength < MIN_VALID_IMAGE_BYTES) {
                            console.warn(
                              `⚠️ weserv.nl returned suspiciously small response (${proxyBuffer.byteLength} bytes), treating as failure`,
                            );
                          } else {
                            const proxyExt = proxyContentType.split("/")[1]?.split(";")[0] || "jpg";
                            const storagePath = `${artifactGuid}/image-${i}.${proxyExt}`;

                            try {
                              await putObject(env, storagePath, proxyBuffer, proxyContentType);
                              const storedUrl = `/images/${storagePath}`;
                              storageImages.push({ original_url: imageUrl, stored_url: storedUrl });
                              console.log(`✅ Proxied image stored: ${storedUrl}`);
                              proxied = true;
                            } catch (proxyUploadError) {
                              console.error(`❌ Proxy image upload failed:`, proxyUploadError);
                            }
                          }
                        } else {
                          console.warn(`⚠️ weserv.nl returned ${proxyResponse.status} for: ${imageUrl}`);
                        }
                      } catch (proxyErr) {
                        console.warn(
                          `⚠️ weserv.nl fetch failed:`,
                          proxyErr instanceof Error ? proxyErr.message : proxyErr,
                        );
                      }

                      if (!proxied) {
                        console.warn(`🔒 Proxy also failed, storing as download_failed fallback: ${imageUrl}`);
                        storageImages.push({ original_url: imageUrl, stored_url: imageUrl, download_failed: true });
                      }

                      break; // Don't retry 403s
                    }

                    // Log non-OK responses
                    console.warn(`⚠️ Image fetch returned ${imgResponse.status} on attempt ${attempt}/3`);
                    imgLastError = new Error(`HTTP ${imgResponse.status}: ${imgResponse.statusText}`);
                  } catch (err) {
                    imgLastError = err instanceof Error ? err : new Error("Unknown error");
                    console.warn(`⚠️ Image fetch failed on attempt ${attempt}/3:`, imgLastError.message);
                  }

                  // Exponential backoff before retry (1s, 2s)
                  if (attempt < 3) {
                    const delayMs = 1000 * attempt;
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                  }
                }

                // Check if we got a successful response
                if (!imgResponse || !imgResponse.ok) {
                  console.error(`❌ Failed to download image after 3 attempts:`, {
                    url: imageUrl,
                    status: imgResponse?.status,
                    statusText: imgResponse?.statusText,
                    error: imgLastError?.message,
                  });
                  continue;
                }

                // Get image data and content type
                const imageBuffer = await imgResponse.arrayBuffer();
                const contentType = imgResponse.headers.get("content-type") || "image/jpeg";

                // Validate content type
                if (!contentType.startsWith("image/")) {
                  console.error(`❌ Invalid content type (${contentType}), expected image: ${imageUrl}`);
                  continue;
                }

                const ext = contentType.split("/")[1]?.split(";")[0] || "jpg";

                // Upload to R2
                const storagePath = `${artifactGuid}/image-${i}.${ext}`;
                console.log(`⬆️ Uploading to R2: ${storagePath}`);

                try {
                  await putObject(env, storagePath, imageBuffer, contentType);
                  const storedUrl = `/images/${storagePath}`;
                  storageImages.push({ original_url: imageUrl, stored_url: storedUrl });
                  console.log(`✅ Stored image ${i + 1}: ${storedUrl}`);
                } catch (uploadError) {
                  console.error(`❌ R2 upload error:`, uploadError);
                  continue;
                }
              } catch (error) {
                console.error(`❌ Error processing image ${i + 1}:`, {
                  url: imageUrl,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            }

            // Pick first image that successfully downloaded to R2 storage —
            // never use a download_failed entry as the hero (its stored_url is
            // still the original external URL, which may be ephemeral, e.g.
            // Facebook/Instagram CDN links that expire).
            const heroImage = storageImages.find((img) => !img.download_failed)?.stored_url || null;
            console.log(`📸 Successfully stored ${storageImages.length}/${allImages.length} images`);

            // Get content using configured field
            let content =
              asString(item[contentField]) ||
              asString(item["content:encoded"]) ||
              asString(item.content) ||
              asString(item.description) ||
              asString(item.summary) ||
              "";

            content = cleanText(content);

            // Enrich thin RSS content by fetching the full article from the URL
            if (content.length < CONTENT_ENRICHMENT_THRESHOLD && link) {
              console.log(`📝 RSS content is thin (${content.length} chars), attempting enrichment from: ${link}`);
              const enrichedText = await fetchArticleText(link);
              if (enrichedText) {
                console.log(`✅ Enriched content: ${content.length} → ${enrichedText.length} chars`);
                content = enrichedText;
              } else {
                console.log(`⚠️ Enrichment failed or returned insufficient content, keeping original`);
              }
            }

            // Upsert into artifacts table with R2-hosted images (updates if GUID exists)
            try {
              await run(
                env,
                `INSERT INTO artifacts (
                   id, name, title, url, guid, content, hero_image_url, images, date, type, source_id, is_test
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(guid) DO UPDATE SET
                   name = excluded.name,
                   title = excluded.title,
                   url = excluded.url,
                   content = excluded.content,
                   hero_image_url = excluded.hero_image_url,
                   images = excluded.images,
                   date = excluded.date,
                   type = excluded.type,
                   source_id = excluded.source_id,
                   is_test = excluded.is_test`,
                artifactGuid,
                title,
                title,
                link,
                guid,
                content,
                heroImage,
                toJson(storageImages),
                pubDate.toISOString(),
                "RSS Article",
                source.id,
                environment === "test" ? 1 : 0,
              );

              console.log(`✅ Upserted: ${title}`);
              totalArtifacts++;
              itemsProcessed++;
            } catch (upsertError) {
              console.error("❌ Upsert error:", upsertError);
              totalErrors++;
            }
          } catch (itemError) {
            console.error(`❌ Error processing item:`, itemError);
            totalErrors++;
          }
        }

        // Log summary for this source
        if (itemsProcessed === 0 && filteredItems.length > 0) {
          console.log(
            `   ⚠️ No new artifacts created - all ${filteredItems.length} items already exist (duplicate GUIDs)`,
          );
        } else {
          console.log(`   ✅ Created ${itemsProcessed} new artifacts from ${filteredItems.length} items in range`);
        }

        // Update source last_fetch_at
        await run(
          env,
          `UPDATE sources SET last_fetch_at = ?, items_fetched = ?, updated_at = ? WHERE id = ?`,
          new Date().toISOString(),
          (source.items_fetched || 0) + filteredItems.length,
          new Date().toISOString(),
          source.id,
        );

        // Update query history with progress
        if (queryHistoryId) {
          const currentProcessed = sources.indexOf(source) + 1;
          await run(
            env,
            `UPDATE query_history SET
               sources_total = ?,
               sources_processed = ?,
               current_source_id = ?,
               current_source_name = ?,
               artifacts_count = ?
             WHERE id = ?`,
            sources.length,
            currentProcessed,
            source.id,
            source.name,
            totalArtifacts,
            queryHistoryId,
          );
        }
      } catch (error) {
        console.error(`❌ Error processing ${source.name}:`, error);
        totalErrors++;

        // Update query history with failed count
        if (queryHistoryId) {
          const currentHistory = await first<{ sources_failed: number | null }>(
            env,
            `SELECT sources_failed FROM query_history WHERE id = ?`,
            queryHistoryId,
          );

          await run(
            env,
            `UPDATE query_history SET sources_failed = ? WHERE id = ?`,
            (currentHistory?.sources_failed || 0) + 1,
            queryHistoryId,
          );
        }
      }
    }

    console.log("\n✅ RSS fetch complete!");
    console.log(`  Artifacts created: ${totalArtifacts}`);
    console.log(`  Errors: ${totalErrors}`);

    // Update query history with final status
    if (queryHistoryId) {
      await run(
        env,
        `UPDATE query_history SET
           status = 'completed',
           completed_at = ?,
           artifacts_count = ?,
           sources_processed = ?,
           current_source_id = NULL,
           current_source_name = NULL
         WHERE id = ?`,
        new Date().toISOString(),
        totalArtifacts,
        sources.length,
        queryHistoryId,
      );
    }

    return {
      success: true,
      artifactsCreated: totalArtifacts,
      errors: totalErrors,
      sourcesProcessed: sources.length,
    };
  } catch (error) {
    console.error("❌ Fatal error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";

    // Try to update query history with error status
    try {
      if (queryHistoryId) {
        await run(
          env,
          `UPDATE query_history SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`,
          message,
          new Date().toISOString(),
          queryHistoryId,
        );
      }
    } catch (updateError) {
      console.error("Failed to update query history:", updateError);
    }

    throw error instanceof Error ? error : new Error(message);
  }
}

/** Normalize a parsed XML node value to a trimmed string (or empty string). */
function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // fast-xml-parser may yield objects for tags with attributes/CDATA — pull text.
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const text = obj["#text"];
    if (typeof text === "string" || typeof text === "number") return String(text);
  }
  return "";
}

// RSS/Atom parser backed by fast-xml-parser. Normalizes RSS <channel><item>
// and Atom <feed><entry> into a uniform list of items, preserving Atom's
// link/@href convention.
function parseRSSFeed(xmlText: string): RSSFeed {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    cdataPropName: "#cdata",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xmlText) as Record<string, unknown>;
  } catch (error) {
    console.error("❌ XML parse failed:", error instanceof Error ? error.message : error);
    return { items: [] };
  }

  const rawItems = collectFeedItems(parsed);
  const items: RSSItem[] = rawItems.map((raw) => normalizeItem(raw));
  return { items };
}

/** Locate the array of <item>/<entry> nodes regardless of RSS vs Atom shape. */
function collectFeedItems(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const rss = parsed["rss"] as Record<string, unknown> | undefined;
  const rdf = parsed["rdf:RDF"] as Record<string, unknown> | undefined;
  const feed = parsed["feed"] as Record<string, unknown> | undefined;

  // RSS 2.0: rss > channel > item
  if (rss) {
    const channel = rss["channel"] as Record<string, unknown> | undefined;
    if (channel && channel["item"] != null) return asArray(channel["item"]);
  }

  // RSS 1.0 / RDF: rdf:RDF > item
  if (rdf && rdf["item"] != null) {
    return asArray(rdf["item"]);
  }

  // Atom: feed > entry
  if (feed && feed["entry"] != null) {
    return asArray(feed["entry"]);
  }

  // Fallbacks: bare <channel> or top-level item/entry arrays
  const channel = parsed["channel"] as Record<string, unknown> | undefined;
  if (channel && channel["item"] != null) return asArray(channel["item"]);
  if (parsed["item"] != null) return asArray(parsed["item"]);
  if (parsed["entry"] != null) return asArray(parsed["entry"]);

  return [];
}

function asArray<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}

/** Read the text content of a parsed node (handles #text, #cdata, attribute objects). */
function nodeText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (Array.isArray(node)) {
    for (const entry of node) {
      const text = nodeText(entry);
      if (text) return text;
    }
    return "";
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["#cdata"] === "string") return obj["#cdata"].trim();
    if (Array.isArray(obj["#cdata"])) return nodeText(obj["#cdata"]);
    if (typeof obj["#text"] === "string") return (obj["#text"] as string).trim();
    if (typeof obj["#text"] === "number") return String(obj["#text"]);
  }
  return "";
}

/** Read a `url`-style attribute from a node that may be an array of nodes. */
function nodeUrl(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const url = nodeUrl(entry);
      if (url) return url;
    }
    return undefined;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const url = obj["@_url"];
    if (typeof url === "string") return url;
  }
  return undefined;
}

/** Read an Atom <link> (prefers @_href, falls back to text). */
function linkValue(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (Array.isArray(node)) {
    // Prefer rel="alternate" or the first href.
    let fallback = "";
    for (const entry of node) {
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const rel = obj["@_rel"];
        const href = obj["@_href"];
        if (typeof href === "string") {
          if (rel === "alternate" || rel === undefined) return href;
          if (!fallback) fallback = href;
        }
      } else {
        const text = nodeText(entry);
        if (text && !fallback) fallback = text;
      }
    }
    return fallback;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj["@_href"] === "string") return obj["@_href"] as string;
    return nodeText(node);
  }
  return "";
}

/**
 * Normalize a parsed item/entry node into the flat RSSItem shape the rest of
 * the pipeline expects. Keeps all raw keys too (for dynamic field mappings),
 * but adds string-normalized common fields.
 */
function normalizeItem(raw: Record<string, unknown>): RSSItem {
  const item: RSSItem = { ...raw };

  item.title = nodeText(raw["title"]);
  item.link = linkValue(raw["link"]);
  item.id = nodeText(raw["id"]);
  item.pubDate = nodeText(raw["pubDate"]) || nodeText(raw["dc:date"]);
  item.published = nodeText(raw["published"]);
  item.updated = nodeText(raw["updated"]);
  item.description = nodeText(raw["description"]);
  item.content = nodeText(raw["content"]);
  item.summary = nodeText(raw["summary"]);
  item["content:encoded"] = nodeText(raw["content:encoded"]);

  const guidText = nodeText(raw["guid"]);
  if (guidText) item.guid = guidText;

  // Media/enclosure structures — preserve { url } shape used by extractAllImages.
  const enclosureUrl = nodeUrl(raw["enclosure"]);
  if (enclosureUrl) item.enclosure = { url: enclosureUrl };

  const mediaContentUrl = nodeUrl(raw["media:content"]);
  if (mediaContentUrl) item["media:content"] = { url: mediaContentUrl };

  const mediaThumbUrl = nodeUrl(raw["media:thumbnail"]);
  if (mediaThumbUrl) item["media:thumbnail"] = { url: mediaThumbUrl };

  const imageUrl = nodeUrl(raw["image"]);
  if (imageUrl) item.image = { url: imageUrl };

  return item;
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function extractAllImages(item: RSSItem, config?: ParserConfig | null): string[] {
  const images: string[] = [];

  // Get image fields from config or use defaults
  const imageFields = config?.fieldMappings?.imageFields || [
    "enclosure.url",
    "media:content.url",
    "media:thumbnail.url",
    "image.url",
  ];

  // Extract images from configured fields
  for (const field of imageFields) {
    const parts = field.split(".");
    let value: unknown = item;

    for (const part of parts) {
      value = value != null && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
    }

    if (typeof value === "string" && value) {
      console.log(`  🖼️ Found image in ${field}: ${value.substring(0, 80)}...`);
      images.push(value);
    } else if (Array.isArray(value)) {
      images.push(...value.filter((v): v is string => typeof v === "string"));
    }
  }

  // Handle media:group special case
  const mediaGroup = item["media:group"];
  if (mediaGroup?.urls && Array.isArray(mediaGroup.urls)) {
    images.push(...mediaGroup.urls);
  }

  // CRITICAL: Extract images from description/content/summary fields
  // FetchRSS and rss.app embed images as markdown or HTML in these fields
  const textFields = [
    asString(item.description),
    asString(item.content),
    asString(item.summary),
    asString(item["content:encoded"]),
  ]
    .filter(Boolean)
    .join("\n");

  if (textFields) {
    console.log(`  📝 Scanning ${textFields.length} chars of text content for images...`);

    // Extract markdown images: ![alt](url) or ![](url)
    const markdownImageRegex = /!\[(?:[^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = markdownImageRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found markdown image: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }

    // Extract HTML images: <img src="url" ... > or <img src='url' ...>
    const htmlImageRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    while ((match = htmlImageRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found HTML img tag: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }

    // Extract media:content URLs embedded in text (some feeds do this)
    const mediaContentRegex = /<media:content[^>]+url=["']([^"']+)["']/gi;
    while ((match = mediaContentRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found media:content: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }

    // Extract enclosure URLs embedded in text
    const enclosureRegex = /<enclosure[^>]+url=["']([^"']+)["']/gi;
    while ((match = enclosureRegex.exec(textFields)) !== null) {
      console.log(`  🖼️ Found enclosure: ${match[1].substring(0, 80)}...`);
      images.push(match[1]);
    }
  }

  // Encode and validate all URLs
  const validImages: string[] = [];
  for (const rawUrl of images) {
    try {
      // Skip tiny/tracking pixels and non-image URLs
      if (rawUrl.includes("pixel") || rawUrl.includes("tracking") || rawUrl.includes("spacer")) {
        console.log(`  ⏭️ Skipping tracking pixel: ${rawUrl.substring(0, 50)}...`);
        continue;
      }

      const url = new URL(rawUrl);
      // Ensure the URL looks like an image
      const path = url.pathname.toLowerCase();
      const hasImageExt = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(path);
      const hasImageInUrl =
        rawUrl.includes("image") ||
        rawUrl.includes("photo") ||
        rawUrl.includes("media") ||
        rawUrl.includes("cdn") ||
        rawUrl.includes("fbcdn");

      // Allow URLs that either have image extension or contain image-related keywords
      if (hasImageExt || hasImageInUrl || rawUrl.includes("scontent")) {
        const encodedUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
        validImages.push(encodedUrl);
      } else {
        console.log(`  ⏭️ Skipping non-image URL: ${rawUrl.substring(0, 80)}...`);
      }
    } catch (error) {
      console.error(`  ❌ Invalid image URL: ${rawUrl}`, error);
    }
  }

  // Remove duplicates and return
  const uniqueImages = [...new Set(validImages)];
  console.log(`  📸 Total extracted: ${uniqueImages.length} unique image(s)`);
  return uniqueImages;
}

/**
 * Fetch the full article text from a URL when RSS content is thin.
 * Extracts main content from <article>, <main>, or largest content block.
 */
async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const result = await fetchPageHTML(url, 15000); // 15s timeout

    if ("error" in result) {
      console.warn(`⚠️ Enrichment fetch failed for ${url}: ${result.error}`);
      return null;
    }

    const html = result.html;

    // Try to extract content from semantic elements in priority order
    let extracted = "";
    const contentSelectors = ["article", "main", '[role="main"]'];

    for (const selector of contentSelectors) {
      const regex = new RegExp(`<${selector}[^>]*>([\\s\\S]*?)<\\/${selector}>`, "i");
      const match = html.match(regex);
      if (match && match[1]) {
        extracted = match[1];
        break;
      }
    }

    // Fallback: find the largest <div> with substantial paragraph content
    if (!extracted) {
      const paragraphs: string[] = [];
      const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
      let pMatch: RegExpExecArray | null;
      while ((pMatch = pRegex.exec(html)) !== null) {
        const text = pMatch[1].replace(/<[^>]+>/g, "").trim();
        if (text.length > 40) {
          paragraphs.push(text);
        }
      }
      if (paragraphs.length >= 2) {
        extracted = paragraphs.join("\n\n");
      }
    }

    if (!extracted) return null;

    // Strip HTML tags and clean up
    const text = extracted
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    // Only return if substantially more content than what we had
    if (text.length < CONTENT_ENRICHMENT_THRESHOLD) return null;

    return text;
  } catch (err) {
    console.warn(`⚠️ Content enrichment failed for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}
