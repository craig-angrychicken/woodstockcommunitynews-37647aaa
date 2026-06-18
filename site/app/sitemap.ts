import type { MetadataRoute } from "next";
import { all } from "@/lib/db";
import { getAllTopicSlugs } from "@/lib/topics";

// Generated at request time against live D1 (build has no DB).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stories = await all<{ slug: string; published_at: string }>(
    "select slug, published_at from stories where status = ? and environment = ? and slug is not null order by published_at desc",
    "published",
    "production"
  );

  const storyEntries: MetadataRoute.Sitemap = (stories || []).map((story) => ({
    url: `https://woodstockcommunity.news/${story.slug}`,
    lastModified: new Date(story.published_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const topicEntries: MetadataRoute.Sitemap = getAllTopicSlugs().map(
    (slug) => ({
      url: `https://woodstockcommunity.news/topic/${slug}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    })
  );

  return [
    {
      url: "https://woodstockcommunity.news",
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: "https://woodstockcommunity.news/about",
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: "https://woodstockcommunity.news/council",
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7,
    },
    ...topicEntries,
    ...storyEntries,
  ];
}
