import { supabase } from "@/lib/supabase";
import { getExcerpt } from "@/lib/formatting";

export const revalidate = 3600;

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const { data: stories } = await supabase
    .from("stories")
    .select(
      "title, slug, content, published_at, structured_metadata, hero_image_url"
    )
    .eq("status", "published")
    .eq("environment", "production")
    .not("slug", "is", null)
    .order("published_at", { ascending: false })
    .limit(50);

  const items = (stories || [])
    .map((story) => {
      const metadata = story.structured_metadata as {
        subhead?: string;
      } | null;
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
