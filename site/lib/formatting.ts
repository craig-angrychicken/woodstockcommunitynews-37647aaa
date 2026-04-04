export function estimateReadTime(content: string | null): number {
  if (!content) return 1;
  const words = content.split(/\s+/).length;
  return Math.max(1, Math.round(words / 250));
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function getExcerpt(
  content: string | null,
  subhead?: string | null,
  maxLength = 160
): string {
  if (subhead) return subhead;
  if (!content) return "";
  const plain = content.replace(/\n+/g, " ").trim();
  if (plain.length <= maxLength) return plain;
  return plain.substring(0, maxLength).replace(/\s+\S*$/, "") + "...";
}
