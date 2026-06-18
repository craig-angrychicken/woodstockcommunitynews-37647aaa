// Post-processing utilities for LLM-generated story text.
//
// Em dashes (—) and en dashes (–) are a classic tell-tale sign of AI prose.
// Strip them on write, before text reaches the stories table.
// (Ported verbatim from supabase/functions/_shared/text-cleanup.ts.)

export function stripEmDashes(text: string): string;
export function stripEmDashes(text: string | null | undefined): string | null;
export function stripEmDashes(text: string | null | undefined): string | null {
  if (text == null) return null;
  if (typeof text !== "string") return text;

  return text
    .replace(/[ \t]*[—–][ \t]*/g, ", ")
    .replace(/[ \t]+--[ \t]+/g, ", ")
    .replace(/,\s*([.,!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}
