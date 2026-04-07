// Shared PDF text extraction — fetches a PDF URL and returns plain text.
// Used by council meeting pipeline for agenda, packet, and minutes PDFs.

const MAX_TEXT_LENGTH = 20_000;
const FETCH_TIMEOUT = 30_000;

/**
 * Fetch a PDF from a URL and extract its text content.
 * Returns extracted text truncated to MAX_TEXT_LENGTH characters.
 */
export async function extractPdfText(url: string): Promise<string> {
  const buffer = await fetchPdfBuffer(url);
  const text = await extractTextFromBuffer(buffer);
  return text.slice(0, MAX_TEXT_LENGTH);
}

async function fetchPdfBuffer(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
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

    return new Uint8Array(await response.arrayBuffer());
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Extract text from a PDF buffer. Tries pdf-parse first, falls back to
 * a lightweight regex-based extractor for born-digital PDFs.
 */
async function extractTextFromBuffer(buffer: Uint8Array): Promise<string> {
  // Attempt 1: pdf-parse via esm.sh
  try {
    const pdfParseMod = await import("https://esm.sh/pdf-parse@1.1.1");
    const pdfParse = pdfParseMod.default ?? pdfParseMod;
    const result = await pdfParse(buffer);
    const text = (result.text || "").trim();
    if (text.length > 100) {
      console.log(`✅ pdf-parse extracted ${text.length} chars`);
      return text;
    }
    console.warn("⚠️ pdf-parse returned very little text, trying fallback");
  } catch (err) {
    console.warn("⚠️ pdf-parse failed, trying fallback:", err instanceof Error ? err.message : String(err));
  }

  // Attempt 2: lightweight regex extraction for born-digital PDFs
  try {
    const text = extractTextWithRegex(buffer);
    if (text.length > 100) {
      console.log(`✅ Regex extractor got ${text.length} chars`);
      return text;
    }
    console.warn("⚠️ Regex extractor returned very little text");
  } catch (err) {
    console.warn("⚠️ Regex extractor failed:", err instanceof Error ? err.message : String(err));
  }

  throw new Error("Could not extract text from PDF with any method");
}

/**
 * Lightweight PDF text extraction using regex to find text-showing operators
 * in the raw PDF byte stream. Works for born-digital (non-scanned) PDFs.
 *
 * Looks for:
 * - (text) Tj  — show text string
 * - [(text)] TJ — show text with positioning
 * - BT ... ET blocks containing text operators
 */
function extractTextWithRegex(buffer: Uint8Array): string {
  const raw = new TextDecoder("latin1").decode(buffer);
  const chunks: string[] = [];

  // Match text between parentheses followed by Tj or TJ operators
  const textOpRegex = /\(([^)]*)\)\s*T[jJ]/g;
  let match;
  while ((match = textOpRegex.exec(raw)) !== null) {
    const decoded = decodePdfString(match[1]);
    if (decoded.trim()) {
      chunks.push(decoded);
    }
  }

  // Also match TJ arrays: [(text) 123 (more text)] TJ
  const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjArrayRegex.exec(raw)) !== null) {
    const innerContent = match[1];
    const innerTextRegex = /\(([^)]*)\)/g;
    let innerMatch;
    const parts: string[] = [];
    while ((innerMatch = innerTextRegex.exec(innerContent)) !== null) {
      const decoded = decodePdfString(innerMatch[1]);
      if (decoded) parts.push(decoded);
    }
    if (parts.length > 0) {
      chunks.push(parts.join(""));
    }
  }

  // Join with spaces and clean up
  return chunks
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decode PDF escape sequences in text strings */
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
