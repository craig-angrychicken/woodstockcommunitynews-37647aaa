// Shared PDF text extraction — fetches a PDF URL and returns plain text.
// Used by council meeting pipeline for agenda, packet, and minutes PDFs.
//
// Uses `unpdf` (a serverless-friendly build of pdf.js) for text extraction.
//
// Granicus URLs (AgendaViewer, MinutesViewer) return 302 redirects to the
// actual PDF on S3 or Granicus CDN — fetch follows these automatically.
// Packet PDFs on CloudFront can be 100MB+; we cap downloads at 10MB.

import { extractText, getDocumentProxy } from "unpdf";

const MAX_TEXT_LENGTH = 20_000;
const FETCH_TIMEOUT = 60_000;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB cap

/**
 * Fetch a PDF from a URL and extract its text content.
 * Follows redirects. Returns extracted text truncated to MAX_TEXT_LENGTH chars.
 * Throws if the extracted text is shorter than 50 chars (likely a scanned/image PDF).
 */
export async function extractPdfText(url: string): Promise<string> {
  const buffer = await fetchPdfBuffer(url);

  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  const normalized = text.replace(/[ \t]+/g, " ").trim();

  if (normalized.length < 50) {
    throw new Error(
      `PDF text extraction yielded only ${normalized.length} chars — may be scanned/image PDF`,
    );
  }

  console.log(`✅ PDF extracted ${normalized.length} chars from ${url.substring(0, 80)}`);
  return normalized.slice(0, MAX_TEXT_LENGTH);
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
      console.warn(
        `⚠️ PDF is ${(contentLength / 1024 / 1024).toFixed(1)}MB, reading first ${MAX_PDF_BYTES / 1024 / 1024}MB only`,
      );
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
