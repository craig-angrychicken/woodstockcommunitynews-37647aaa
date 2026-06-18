import { all, fromJson } from "@/lib/db";
import { getExcerpt } from "@/lib/formatting";

export const dynamic = "force-dynamic";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const stories = await all<{
    title: string;
    slug: string;
    content: string;
    published_at: string;
    structured_metadata: string | null;
    hero_image_url: string | null;
  }>(
    "select title, slug, content, published_at, structured_metadata, hero_image_url from stories where status = ? and environment = ? and slug is not null order by published_at desc limit ?",
    "published",
    "production",
    50
  );

  const items = (stories || [])
    .map((story) => {
      const metadata = fromJson<{
        subhead?: string;
      } | null>(story.structured_metadata, null);
      const description = getExcerpt(story.content, metadata?.subhead);
      const url = `https://woodstockcommunity.news/${story.slug}`;

      return `    <item>
      <title>${escapeXml(story.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${escapeXml(description)}</description>
      <pubDate>${new Date(story.published_at).toUTCString()}</pubDate>
    </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Woodstock Community News</title>
    <link>https://woodstockcommunity.news</link>
    <description>Local news for Woodstock, Georgia. Community journalism powered by AI, guided by AP standards.</description>
    <language>en-us</language>
    <atom:link href="https://woodstockcommunity.news/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
