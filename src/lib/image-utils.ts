/**
 * Sanitizes an image URL by decoding HTML entities and double-encoded characters.
 */
export const sanitizeImageUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    // Decode HTML entities (e.g., &amp; -> &)
    let decoded = url
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    // Decode any double-encoded URLs (%2520 -> %20)
    decoded = decoded.replace(/%25([0-9A-F]{2})/gi, '%$1');

    return decoded;
  } catch {
    return url;
  }
};
