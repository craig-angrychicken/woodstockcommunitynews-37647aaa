// Post-processing utilities for LLM-generated story text.
//
// Em dashes (—) and en dashes (–) are a classic tell-tale sign of AI prose.
// The model loves them, and they make our stories read like every other
// LLM-generated article on the internet. Strip them on write, before text
// reaches the stories table.

/**
 * Remove em dashes, en dashes, and ASCII "--" em-dash stand-ins from a
 * text blob. Dashes get rewritten as comma-space in most cases, then any
 * resulting punctuation pile-ups (", ." / ", ,") are tidied.
 *
 * Preserves newlines so multi-paragraph story bodies stay intact.
 */
export function stripEmDashes(text: string): string;
export function stripEmDashes(text: string | null | undefined): string | null;
export function stripEmDashes(text: string | null | undefined): string | null {
  if (text == null) return null;
  if (typeof text !== "string") return text;

  return text
    // Em dash (U+2014) or en dash (U+2013) with any surrounding spaces → ", "
    .replace(/[ \t]*[\u2014\u2013][ \t]*/g, ", ")
    // ASCII em-dash stand-in ("--" with spaces) → ", "
    .replace(/[ \t]+--[ \t]+/g, ", ")
    // Clean up ", ." / ", ," / ", !" etc. that the replacement can produce
    .replace(/,\s*([.,!?;:])/g, "$1")
    // Collapse runs of spaces/tabs (not newlines) to a single space
    .replace(/[ \t]{2,}/g, " ")
    // Trim trailing space before a newline that the replacement may have left
    .replace(/[ \t]+\n/g, "\n");
}
