// Shared PDF text extraction — fetches a PDF URL and returns plain text.
// Used by council meeting pipeline for agenda, packet, and minutes PDFs.
//
// Handles CID font PDFs with hex glyph IDs + ToUnicode CMaps (common in
// Granicus/government PDFs), plus simple literal-text PDFs as fallback.
//
// Granicus URLs (AgendaViewer, MinutesViewer) return 302 redirects to the
// actual PDF on S3 or Granicus CDN — Deno fetch follows these automatically.
// Packet PDFs on CloudFront can be 100MB+; we cap downloads at 10MB.

const MAX_TEXT_LENGTH = 20_000;
const FETCH_TIMEOUT = 60_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB cap

/**
 * Fetch a PDF from a URL and extract its text content.
 * Follows redirects. Returns extracted text truncated to MAX_TEXT_LENGTH chars.
 */
export async function extractPdfText(url: string): Promise<string> {
  const buffer = await fetchPdfBuffer(url);
  const text = await extractText(buffer);

  if (text.length < 50) {
    throw new Error(`PDF text extraction yielded only ${text.length} chars — may be scanned/image PDF`);
  }

  console.log(`✅ PDF extracted ${text.length} chars from ${url.substring(0, 80)}`);
  return text.slice(0, MAX_TEXT_LENGTH);
}

// ─── PDF Fetch ──────────────────────────────────────────────────────

async function fetchPdfBuffer(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/pdf,*/*",
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`PDF fetch failed: HTTP ${response.status} for ${url}`);
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    if (contentLength > MAX_PDF_BYTES) {
      console.warn(`⚠️ PDF is ${(contentLength / 1024 / 1024).toFixed(1)}MB, reading first ${MAX_PDF_BYTES / 1024 / 1024}MB only`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const chunks: Uint8Array[] = [];
      let totalRead = 0;
      while (totalRead < MAX_PDF_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalRead += value.length;
      }
      reader.cancel();

      const result = new Uint8Array(totalRead);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ─── Zlib Decompression ─────────────────────────────────────────────

/** Decompress zlib/deflate data using Deno's built-in DecompressionStream */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // PDF FlateDecode uses zlib (RFC 1950) which is "deflate" in Web Streams API
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write data and close
  writer.write(data);
  writer.close();

  // Read all output chunks
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }

  // Combine into single buffer
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// ─── Main Extraction ────────────────────────────────────────────────

async function extractText(buffer: Uint8Array): Promise<string> {
  const raw = new TextDecoder("latin1").decode(buffer);

  // Step 1: Build font→CMap lookup by following ToUnicode references
  const fontCMaps = await buildFontCMaps(raw, buffer);

  // Step 2: Extract text from content streams
  const text = await extractFromStreams(raw, buffer, fontCMaps);

  if (text.length > 0) return text;

  // Fallback: regex on raw bytes (uncompressed simple PDFs)
  return extractTextWithRegex(raw);
}

// ─── ToUnicode CMap Parsing ─────────────────────────────────────────

type CMapEntry = Map<number, string>;

function hexToString(hex: string): string {
  const chars: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    if (i + 4 <= hex.length) {
      chars.push(String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16)));
    } else {
      chars.push(String.fromCodePoint(parseInt(hex.slice(i), 16)));
    }
  }
  return chars.join("");
}

function parseSingleCMap(content: string): CMapEntry {
  const cmap: CMapEntry = new Map();

  // beginbfchar: <srcGlyph> <unicodeValue>
  const bfcharRegex = /beginbfchar\s*\n([\s\S]*?)endbfchar/g;
  let section;
  while ((section = bfcharRegex.exec(content)) !== null) {
    const lineRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let line;
    while ((line = lineRegex.exec(section[1])) !== null) {
      cmap.set(parseInt(line[1], 16), hexToString(line[2]));
    }
  }

  // beginbfrange: <start> <end> <unicodeStart> OR <start> <end> [<u1> <u2> ...]
  const bfrangeRegex = /beginbfrange\s*\n([\s\S]*?)endbfrange/g;
  while ((section = bfrangeRegex.exec(content)) !== null) {
    for (const line of section[1].trim().split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Array form: <start> <end> [<u1> <u2> ...]
      const arrayMatch = trimmed.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.+)\]$/);
      if (arrayMatch) {
        const start = parseInt(arrayMatch[1], 16);
        const unicodes = arrayMatch[3].match(/<([0-9A-Fa-f]+)>/g) || [];
        for (let i = 0; i < unicodes.length; i++) {
          cmap.set(start + i, hexToString(unicodes[i].replace(/[<>]/g, "")));
        }
        continue;
      }

      // Simple form: <start> <end> <unicodeStart>
      const simpleMatch = trimmed.match(/^<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>$/);
      if (simpleMatch) {
        const start = parseInt(simpleMatch[1], 16);
        const end = parseInt(simpleMatch[2], 16);
        const unicodeStart = parseInt(simpleMatch[3], 16);
        for (let i = 0; i <= end - start; i++) {
          cmap.set(start + i, String.fromCodePoint(unicodeStart + i));
        }
      }
    }
  }

  return cmap;
}

// ─── Font → CMap Lookup ─────────────────────────────────────────────

/** Read the stream content of a specific PDF object by number */
async function readObjectStream(objNum: number, raw: string, buffer: Uint8Array): Promise<string | null> {
  const pattern = new RegExp(`(?:^|\\n)${objNum}\\s+0\\s+obj\\s*<<([^]*?)>>\\s*stream\\r?\\n`);
  const match = pattern.exec(raw);
  if (!match) return null;

  const streamStart = match.index + match[0].length;
  const endIdx = raw.indexOf("endstream", streamStart);
  if (endIdx < 0) return null;

  const dict = match[1];

  if (/\/FlateDecode/.test(dict)) {
    const streamBytes = buffer.slice(streamStart, endIdx);
    let len = streamBytes.length;
    while (len > 0 && (streamBytes[len - 1] === 0x0a || streamBytes[len - 1] === 0x0d)) len--;
    try {
      const decompressed = await inflate(streamBytes.slice(0, len));
      return new TextDecoder("latin1").decode(decompressed);
    } catch {
      return null;
    }
  } else if (!/\/Filter/.test(dict)) {
    return raw.slice(streamStart, endIdx);
  }

  return null;
}

/**
 * Build font resource name → CMap by following the reference chain:
 * /Font << /F6 M 0 R >> → obj M << /ToUnicode N 0 R >> → obj N stream (CMap)
 */
async function buildFontCMaps(raw: string, buffer: Uint8Array): Promise<Map<string, CMapEntry>> {
  const fontCMaps = new Map<string, CMapEntry>();

  // Find all /FN M 0 R references in font resource dictionaries
  const fontRefs = new Map<string, number>();
  for (const m of raw.matchAll(/\/([\w.+-]+)\s+(\d+)\s+0\s+R/g)) {
    if (!fontRefs.has(m[1])) fontRefs.set(m[1], parseInt(m[2], 10));
  }

  // For each font, find its ToUnicode CMap
  for (const [fontName, fontObjNum] of fontRefs) {
    const fontPattern = new RegExp(`(?:^|\\n)${fontObjNum}\\s+0\\s+obj\\s*<<([^]*?)>>`);
    const fontMatch = fontPattern.exec(raw);
    if (!fontMatch) continue;
    if (!/\/Type\s*\/Font/.test(fontMatch[1])) continue;

    const toUMatch = fontMatch[1].match(/\/ToUnicode\s+(\d+)\s+0\s+R/);
    if (!toUMatch) continue;

    const cmapObjNum = parseInt(toUMatch[1], 10);
    const cmapContent = await readObjectStream(cmapObjNum, raw, buffer);
    if (!cmapContent) continue;

    const cmap = parseSingleCMap(cmapContent);
    if (cmap.size > 0) fontCMaps.set(fontName, cmap);
  }

  return fontCMaps;
}

// ─── Content Stream Extraction ──────────────────────────────────────

async function extractFromStreams(
  raw: string,
  buffer: Uint8Array,
  fontCMaps: Map<string, CMapEntry>,
): Promise<string> {
  const btChunks: string[] = [];
  const streamRegex = /(?:^|\n)(\d+)\s+0\s+obj\s*<<([^]*?)>>\s*stream\r?\n/g;
  let match;

  while ((match = streamRegex.exec(raw)) !== null) {
    const dict = match[2];
    const streamStart = match.index + match[0].length;
    const endIdx = raw.indexOf("endstream", streamStart);
    if (endIdx < 0) continue;

    let content: string | null = null;

    if (/\/FlateDecode/.test(dict)) {
      const streamBytes = buffer.slice(streamStart, endIdx);
      let len = streamBytes.length;
      while (len > 0 && (streamBytes[len - 1] === 0x0a || streamBytes[len - 1] === 0x0d)) len--;
      try {
        const decompressed = await inflate(streamBytes.slice(0, len));
        content = new TextDecoder("latin1").decode(decompressed);
      } catch {
        continue;
      }
    } else if (!/\/Filter/.test(dict)) {
      content = raw.slice(streamStart, endIdx);
    }

    if (!content || !content.includes("BT")) continue;

    const btBlocks = content.match(/BT[\s\S]*?ET/g);
    if (!btBlocks) continue;

    let currentFont = "";

    for (const block of btBlocks) {
      let blockText = "";
      for (const line of block.split("\n")) {
        const t = line.trim();

        // Track font changes: /F6 18 Tf
        const fontMatch = t.match(/\/([\w.+-]+)\s+[\d.]+\s+Tf/);
        if (fontMatch) currentFont = fontMatch[1];

        const cmap = fontCMaps.get(currentFont);

        // Decode hex glyph IDs: <0001> Tj
        for (const m of t.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
          blockText += decodeHexRun(m[1], cmap);
        }

        // Decode TJ arrays: [<hex> 123 <hex>] TJ
        const tjArray = t.match(/\[([^\]]*)\]\s*TJ/);
        if (tjArray) {
          for (const h of tjArray[1].matchAll(/<([0-9A-Fa-f]+)>/g)) {
            blockText += decodeHexRun(h[1], cmap);
          }
          // Also handle literal strings in TJ arrays
          for (const l of tjArray[1].matchAll(/\(([^)]*)\)/g)) {
            blockText += decodePdfString(l[1]);
          }
        }

        // Decode literal text: (text) Tj (simple PDFs without CID fonts)
        if (!tjArray) {
          const litTj = t.match(/\(([^)]*)\)\s*Tj/);
          if (litTj) blockText += decodePdfString(litTj[1]);
        }
      }

      if (blockText.trim()) btChunks.push(blockText.trim());
    }
  }

  return btChunks.join("\n").replace(/[ \t]+/g, " ").trim();
}

/** Decode a run of 4-digit hex glyph IDs using CMap or direct Unicode */
function decodeHexRun(hex: string, cmap: CMapEntry | undefined): string {
  let result = "";
  for (let i = 0; i < hex.length; i += 4) {
    const glyphId = parseInt(hex.slice(i, Math.min(i + 4, hex.length)), 16);
    if (glyphId === 0) continue;
    if (cmap) {
      const mapped = cmap.get(glyphId);
      if (mapped) result += mapped;
    } else {
      // No CMap — treat hex as direct Unicode code points
      result += String.fromCodePoint(glyphId);
    }
  }
  return result;
}

// ─── Fallback: Regex on raw (uncompressed) PDF ──────────────────────

function extractTextWithRegex(raw: string): string {
  const chunks: string[] = [];
  const seen = new Set<string>();

  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  let match;
  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const parts: string[] = [];
    for (const m of match[1].matchAll(/\(([^)]*)\)/g)) {
      const decoded = decodePdfString(m[1]);
      if (decoded) parts.push(decoded);
    }
    if (parts.length > 0) {
      const line = parts.join("");
      if (line.trim() && !seen.has(line.trim())) {
        seen.add(line.trim());
        chunks.push(line);
      }
    }
  }

  const textOpRegex = /\(([^)]*)\)\s*Tj/g;
  while ((match = textOpRegex.exec(raw)) !== null) {
    const decoded = decodePdfString(match[1]);
    if (decoded.trim() && !seen.has(decoded.trim())) {
      seen.add(decoded.trim());
      chunks.push(decoded);
    }
  }

  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function decodePdfString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{3})/g, (_m, oct) => String.fromCharCode(parseInt(oct, 8)));
}
